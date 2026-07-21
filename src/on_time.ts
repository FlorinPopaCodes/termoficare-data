// On-time estimate scoring and rate aggregation (ADR 0001: strict scoring).
// Pure: episode histories in, score/rate/index rows out. The derive pass scores every
// posted estimate of every ended episode; keeping the cause classifier here, in the one
// module both passes import, is what guarantees derive-time buckets and scrape-time
// lookups agree.

import { type CsvValue } from "./csv.ts";

export const ESTIMATE_SCORES_DIR = "data/derived/estimate_scores";
export const RATES_PATH = "data/derived/on_time_rates.csv";
export const ACTIVE_EPISODES_PATH = "data/derived/active_episodes.csv";

export const ESTIMATE_SCORE_HEADER = [
  "episode_id",
  "sector",
  "pt_name",
  "utility",
  "cause_class",
  "slip_count",
  "estimated_restore",
  "posted_ts",
  "restored_ts",
  "hit",
];
export const RATE_HEADER = [
  "level",
  "sector",
  "pt_name",
  "cause_class",
  "slip_bucket",
  "hits",
  "n",
];
export const ACTIVE_EPISODE_HEADER = ["episode_id", "sector", "pt_name", "utility", "slip_count"];

// Matching runs over diacritic-folded lowercase text, so "Lipsă"/"Lipsa"/"LIPSA" are one
// word. First match wins: a breakdown mentioned anywhere outranks the softer families
// ("Lucrari de remediere avarie" is a breakdown, not planned works). Unmatched text is
// "other". Over the 2021-12..2026-07 history this map classes ~96% of cause rows.
const CAUSE_CLASSES: [string, RegExp][] = [
  ["breakdown", /avari/],
  ["missing_params", /lipsa (furnizare )?parametri|parametrii? insuficien|debit insuficient/],
  ["balancing", /echilibrar/],
  ["planned_works", /moderniz|mentenant|revizi|lucrari/],
  ["maneuvers", /probe|umplere|golire|manevr/],
];

function causeClass(cause: string): string {
  const folded = cause.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  for (const [cls, re] of CAUSE_CLASSES) {
    if (re.test(folded)) return cls;
  }
  return "other";
}

// Conditioning buckets for slip count; the tail past 3 is too thin to keep apart.
function slipBucket(slipCount: number): string {
  return slipCount >= 3 ? "3+" : String(slipCount);
}

// Estimates are minute-precision; widen to seconds so they compare against snapshot
// timestamps as fixed-width strings.
function deadline(estimate: string): string {
  return estimate.length === 16 ? `${estimate}:00` : estimate;
}

export interface ValueRun {
  value: string;
  first_seen_ts: string;
  last_seen_ts: string;
}

// One episode's estimate and cause history, runs in chronological (first_seen_ts) order.
export interface EpisodeHistory {
  episode_id: string;
  sector: string;
  pt_name: string;
  utility: string;
  first_absent_ts: string | null;
  estimates: ValueRun[];
  causes: ValueRun[];
}

interface Posting {
  value: string;
  posted_ts: string;
  slip_count: number;
  cause_class: string;
}

// The newest cause on the page when the estimate appeared -- the same pairing a reader
// of the status page saw next to it.
function causeAt(causes: ValueRun[], ts: string): string {
  let current = causes[0]?.value ?? "";
  for (const run of causes) {
    if (run.first_seen_ts > ts) break;
    current = run.value;
  }
  return current;
}

// The episode's distinct posted estimates in first-posting order: re-posting an earlier
// value is the same claim again, and a blank value (Nedefinit) is no claim at all. Slip
// count is how many estimates preceded this one.
function postings(episode: EpisodeHistory): Posting[] {
  const seen = new Set<string>();
  const out: Posting[] = [];
  for (const run of episode.estimates) {
    if (run.value === "" || seen.has(run.value)) continue;
    seen.add(run.value);
    out.push({
      value: run.value,
      posted_ts: run.first_seen_ts,
      slip_count: out.length,
      cause_class: causeClass(causeAt(episode.causes, run.first_seen_ts)),
    });
  }
  return out;
}

export interface EstimateScore {
  episode_id: string;
  sector: string;
  pt_name: string;
  utility: string;
  cause_class: string;
  slip_count: number;
  estimated_restore: string;
  posted_ts: string;
  restored_ts: string;
  hit: boolean;
}

// ADR 0001: a hit requires the episode observed restored (its first_absent_ts) at or
// before the estimated time -- no grace window, superseded estimates included. Episodes
// whose end was never observed score nothing: their outcomes are unknowable.
export function scoreEpisode(episode: EpisodeHistory): EstimateScore[] {
  const restored = episode.first_absent_ts;
  if (restored === null) return [];
  return postings(episode).map((p) => ({
    episode_id: episode.episode_id,
    sector: episode.sector,
    pt_name: episode.pt_name,
    utility: episode.utility,
    cause_class: p.cause_class,
    slip_count: p.slip_count,
    estimated_restore: p.value,
    posted_ts: p.posted_ts,
    restored_ts: restored,
    hit: restored <= deadline(p.value),
  }));
}

// Slip count an open episode's current estimate carries into the active-episode index.
export function currentSlipCount(episode: EpisodeHistory): number {
  return Math.max(0, postings(episode).length - 1);
}

const RATE_LEVELS = ["pt_cause_slip", "sector_cause_slip", "cause_slip", "slip"] as const;
type RateLevel = (typeof RATE_LEVELS)[number];

// (level, sector, pt_name, cause_class, slip_bucket) -- unused key fields blanked, so
// one tuple both keys the aggregation map and renders as a rates-file row.
type RateTuple = [RateLevel, string, string, string, string];

// The backoff chain, most to least specific.
function rateTuples(
  sector: string,
  pt_name: string,
  cause_class: string,
  slip_bucket: string,
): RateTuple[] {
  return [
    ["pt_cause_slip", sector, pt_name, cause_class, slip_bucket],
    ["sector_cause_slip", sector, "", cause_class, slip_bucket],
    ["cause_slip", "", "", cause_class, slip_bucket],
    ["slip", "", "", "", slip_bucket],
  ];
}

// Same non-HTML-producible joiner as derive.ts's keyOf, for the same reason.
const KEY_JOIN = "";

export function aggregateRates(scores: EstimateScore[]): CsvValue[][] {
  const acc = new Map<string, { tuple: RateTuple; hits: number; n: number }>();
  for (const score of scores) {
    for (
      const tuple of rateTuples(
        score.sector,
        score.pt_name,
        score.cause_class,
        slipBucket(score.slip_count),
      )
    ) {
      const key = tuple.join(KEY_JOIN);
      let rate = acc.get(key);
      if (rate === undefined) {
        rate = { tuple, hits: 0, n: 0 };
        acc.set(key, rate);
      }
      rate.n++;
      if (score.hit) rate.hits++;
    }
  }

  const sortKey = (t: RateTuple) =>
    `${RATE_LEVELS.indexOf(t[0])}${KEY_JOIN}${t.slice(1).join(KEY_JOIN)}`;
  return [...acc.values()]
    .sort((a, b) => {
      const ka = sortKey(a.tuple);
      const kb = sortKey(b.tuple);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map(({ tuple, hits, n }) => [...tuple, hits, n]);
}
