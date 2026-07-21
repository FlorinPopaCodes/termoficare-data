// On-time estimate scoring, rate aggregation, and scrape-time lookup (ADR 0001: strict
// scoring). Pure: episode histories in, score/rate/index rows out; rate/index CSVs in,
// per-outage predictions out. The derive pass scores every posted estimate of every
// ended episode; keeping the cause classifier here, in the one module both passes
// import, is what guarantees derive-time buckets and scrape-time lookups agree.

import { type CsvValue, parseRows } from "./csv.ts";

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

// --- scrape-time lookup ---

export interface PredictionContext {
  rates: Map<string, { hits: number; n: number }>;
  slips: Map<string, number>; // sector + pt_name + utility -> the open episode's slip count
}

function assertHeader(actual: string[] | undefined, expected: string[], path: string): void {
  const matches = actual !== undefined && actual.length === expected.length &&
    actual.every((v, i) => v === expected[i]);
  if (!matches) throw new Error(`${path}: header does not match the expected shape`);
}

// Header-gated like derive's foundation reader: a file whose shape drifted from this
// module's writer (deploy skew) must throw, not silently publish wrong probabilities.
// The orchestrator treats a throw like a missing file and omits the fields.
export function parsePredictionContext(ratesCsv: string, activeCsv: string): PredictionContext {
  const rateRows = parseRows(ratesCsv);
  const activeRows = parseRows(activeCsv);
  assertHeader(rateRows[0], RATE_HEADER, RATES_PATH);
  assertHeader(activeRows[0], ACTIVE_EPISODE_HEADER, ACTIVE_EPISODES_PATH);

  const rates = new Map<string, { hits: number; n: number }>();
  for (let i = 1; i < rateRows.length; i++) {
    const [level, sector, pt_name, cause_class, slip_bucket, hits, n] = rateRows[i];
    rates.set(
      [level, sector, pt_name, cause_class, slip_bucket].join(KEY_JOIN),
      { hits: Number(hits), n: Number(n) },
    );
  }
  const slips = new Map<string, number>();
  for (let i = 1; i < activeRows.length; i++) {
    const [, sector, pt_name, utility, slip_count] = activeRows[i];
    slips.set([sector, pt_name, utility].join(KEY_JOIN), Number(slip_count));
  }
  return { rates, slips };
}

// The scrape-side mirror of derive.ts's unpackService, but lenient: an unrecognized
// service degrades to "no episode match", it must never break current.json.
function serviceUtilities(service: string): string[] {
  const util = service.split(" ")[1];
  if (util === "ACC" || util === "INC") return [util];
  if (util === "ACC/INC") return ["ACC", "INC"];
  return [];
}

// An ACC/INC row joins both utilities' episodes; the worse (higher) slip count wins so
// an escalated outage can't reset trust. Outages not yet in the index (fresh, or the
// index is a day stale) condition on slip 0.
function slipFor(
  o: { sector: number; pt_name: string; service: string },
  slips: Map<string, number>,
): number {
  let slip = 0;
  for (const utility of serviceUtilities(o.service)) {
    const found = slips.get([String(o.sector), o.pt_name, utility].join(KEY_JOIN));
    if (found !== undefined && found > slip) slip = found;
  }
  return slip;
}

// Fewest scored estimates a bucket may publish from before backing off to a coarser one.
const MIN_BASIS = 20;

export interface OutagePrediction {
  on_time_probability: number;
  basis_n: number;
  basis_bucket: string;
}

// P(the currently posted estimate is hit). A deadline already earlier than scraped_at is
// a settled miss (probability 0, basis_bucket "overdue") no matter how stale the derived
// data is. Otherwise: the empirical rate from the most specific bucket holding at least
// MIN_BASIS scored estimates, backing off stepwise; the coarsest level (slip alone)
// publishes at any size. Null when even that bucket has no history.
export function predictOutage(
  o: { sector: number; pt_name: string; service: string; cause: string },
  estimatedRestore: string,
  scrapedAt: string,
  context: PredictionContext,
): OutagePrediction | null {
  if (deadline(estimatedRestore) < scrapedAt) {
    return { on_time_probability: 0, basis_n: 0, basis_bucket: "overdue" };
  }
  const bucket = slipBucket(slipFor(o, context.slips));
  for (const tuple of rateTuples(String(o.sector), o.pt_name, causeClass(o.cause), bucket)) {
    const rate = context.rates.get(tuple.join(KEY_JOIN));
    if (rate === undefined) continue;
    if (rate.n >= MIN_BASIS || tuple[0] === "slip") {
      return {
        on_time_probability: Math.round(rate.hits / rate.n * 1000) / 1000,
        basis_n: rate.n,
        basis_bucket: tuple[0],
      };
    }
  }
  return null;
}
