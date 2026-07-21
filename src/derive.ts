// Derives incident/estimate/cause history from the foundation CSVs (decision #8).
// Pure: parsed foundation snapshots in, rendered CSV file contents out. No I/O -- disk
// and month enumeration belong to scripts/derive.ts.
//
// Incident identity is (sector, pt_name, service); cause is not part of the key, so a
// service change closes the old incident and opens a new one. Lifecycle tolerance is
// strict (0): only "ok"/"empty" snapshots are evidence of presence or absence. An
// "error"/"parse_error" snapshot can't testify to absence, so open incidents run straight
// across it. An "empty" snapshot (zero rows) closes every open incident.

import { type ScrapeStatus } from "./parser.ts";
import {
  type CsvValue,
  formatRow,
  monthPath,
  OBSERVATION_HEADER,
  parseRows,
  SNAPSHOT_LOG_HEADER,
} from "./csv.ts";
import {
  ACTIVE_EPISODE_HEADER,
  ACTIVE_EPISODES_PATH,
  aggregateRates,
  currentSlipCount,
  type EpisodeHistory,
  ESTIMATE_SCORE_HEADER,
  ESTIMATE_SCORES_DIR,
  type EstimateScore,
  RATE_HEADER,
  RATES_PATH,
  scoreEpisode,
} from "./on_time.ts";

export const INCIDENTS_DIR = "data/derived/incidents";
export const ESTIMATES_DIR = "data/derived/estimates";
export const CAUSES_DIR = "data/derived/causes";
export const EPISODES_DIR = "data/derived/episodes";
export const EPISODE_INCIDENTS_DIR = "data/derived/episode_incidents";

export const INCIDENT_HEADER = [
  "incident_id",
  "sector",
  "pt_name",
  "service",
  "first_seen_ts",
  "last_seen_ts",
  "first_absent_ts",
  "snapshots_present",
];

export const ESTIMATE_HEADER = [
  "incident_id",
  "estimated_restore",
  "first_seen_ts",
  "last_seen_ts",
];
export const CAUSE_HEADER = ["incident_id", "cause", "first_seen_ts", "last_seen_ts"];

export const EPISODE_HEADER = [
  "episode_id",
  "sector",
  "pt_name",
  "utility",
  "first_seen_ts",
  "last_seen_ts",
  "first_absent_ts",
  "n_incidents",
  "n_bridged_gaps",
  "bridged_seconds",
];
export const EPISODE_INCIDENT_HEADER = ["episode_id", "incident_id"];

// Raw CSV strings only -- blocks/zone_raw/snapshot_ts play no part in incident identity
// or history and are dropped at the seam so the sweep below can't accidentally depend on
// them.
export interface KeyObservation {
  sector: string;
  pt_name: string;
  service: string;
  estimated_restore: string;
  cause: string;
}

export interface FoundationSnapshot {
  ts: string;
  status: ScrapeStatus;
  observations: KeyObservation[];
}

export interface MonthContent {
  month: string;
  log: string;
  observations: string;
}

function sameHeader(actual: string[] | undefined, expected: string[]): boolean {
  return actual !== undefined && actual.length === expected.length &&
    actual.every((v, i) => v === expected[i]);
}

// Walks a month's scrape log in order and consumes exactly as many observation rows as
// each log row claims, verifying the two files agree at every step. This is a gate: a
// derived dataset built over misaligned foundation files would be silently wrong, so any
// disagreement throws rather than producing output.
export function* foundationSnapshots(
  months: Iterable<MonthContent>,
): Generator<FoundationSnapshot> {
  for (const { month, log, observations } of months) {
    const logRows = parseRows(log);
    const obsRows = parseRows(observations);

    if (!sameHeader(logRows[0], SNAPSHOT_LOG_HEADER)) {
      throw new Error(
        `${month}: snapshot log header does not match the expected foundation header`,
      );
    }
    if (!sameHeader(obsRows[0], OBSERVATION_HEADER)) {
      throw new Error(
        `${month}: observations header does not match the expected foundation header`,
      );
    }

    let obsIndex = 1; // row 0 is the header
    for (let i = 1; i < logRows.length; i++) {
      const [ts, status, countField] = logRows[i];
      const count = Number(countField);
      const rows: KeyObservation[] = [];
      for (let n = 0; n < count; n++) {
        const row = obsRows[obsIndex];
        if (row === undefined) {
          throw new Error(
            `${month}: scrape log at ${ts} claims ${count} observation rows but the ` +
              `observations file ran out`,
          );
        }
        if (row[0] !== ts) {
          throw new Error(
            `${month}: observation row ts ${row[0]} does not match its log row's ts ${ts}`,
          );
        }
        rows.push({
          sector: row[1],
          pt_name: row[2],
          service: row[4],
          cause: row[5],
          estimated_restore: row[6],
        });
        obsIndex++;
      }
      yield { ts, status: status as ScrapeStatus, observations: rows };
    }

    if (obsIndex !== obsRows.length) {
      throw new Error(
        `${month}: observations file has ${obsRows.length - obsIndex} leftover row(s) the ` +
          `scrape log never claimed`,
      );
    }
  }
}

export interface DeriveStats {
  snapshots: number;
  incidents: number;
  openIncidents: number;
  estimateRuns: number;
  causeRuns: number;
  months: number;
  episodes: number;
  openEpisodes: number;
  bridgedGaps: number;
  scoredEstimates: number;
}

// One derived episode's utility and span, structurally identical to episode_heatmap.ts's
// own EpisodeSpan on purpose -- the two modules are opposite sides of the seam and
// deliberately don't import each other.
export interface EpisodeSpan {
  utility: string;
  first_seen_ts: string;
  last_seen_ts: string;
}

export interface Derived {
  files: Map<string, string>;
  stats: DeriveStats;
  episodeSpans: EpisodeSpan[];
  usableDays: Set<string>;
}

// One contiguous run of a distinct estimate/cause value across an incident's parseable
// snapshots. `runs` on an Incident stays in run-opening order because it's only ever
// pushed to, never reordered; `last_seen_ts` is mutated in place while a run is open.
interface Run {
  value: string;
  first_seen_ts: string;
  last_seen_ts: string;
}

interface Incident {
  incident_id: string; // filled in after the sweep -- hashing is the only async part
  sector: string;
  pt_name: string;
  service: string;
  first_seen_ts: string;
  last_seen_ts: string;
  first_absent_ts: string | null; // null = still open at end of input (censored)
  snapshots_present: number;
  estimateRuns: Run[];
  causeRuns: Run[];
  openEstimateRuns: Map<string, Run>;
  openCauseRuns: Map<string, Run>;
}

// Values Set preserves this snapshot's first-appearance order for the key's rows, which
// is what gives run-opening order "for free" per the implementation sketch.
interface KeyGroup {
  sector: string;
  pt_name: string;
  service: string;
  estimates: Set<string>;
  causes: Set<string>;
}

// U+0001 is not a character CMTEB's HTML can produce, so joining with it can't
// false-collide two distinct (sector, pt_name, service) triples the way plain
// concatenation could (e.g. sector "1"/pt_name "2 Test" vs sector "12"/pt_name " Test").
function keyOf(sector: string, pt_name: string, service: string): string {
  return `${sector}${pt_name}${service}`;
}

// Advances one value-history (estimates or causes) for one incident by one snapshot's
// distinct value set. Runs not present in `values` close silently (their last_seen_ts
// already holds the correct bracket from the snapshot they were last seen in); runs
// present either extend or open, in `values`' iteration order.
function advanceRuns(runs: Run[], open: Map<string, Run>, values: Set<string>, ts: string): void {
  for (const value of open.keys()) {
    if (!values.has(value)) open.delete(value);
  }
  for (const value of values) {
    const existing = open.get(value);
    if (existing === undefined) {
      const run: Run = { value, first_seen_ts: ts, last_seen_ts: ts };
      runs.push(run);
      open.set(value, run);
    } else {
      existing.last_seen_ts = ts;
    }
  }
}

interface Episode {
  episode_id: string; // filled in after building -- hashing is the only async part
  sector: string;
  pt_name: string;
  utility: string;
  members: Incident[]; // opening order
  first_seen_ts: string;
  last_seen_ts: string;
  first_absent_ts: string | null; // null = still open at end of input (censored)
  n_bridged_gaps: number;
  bridged_seconds: number;
}

// severity is a fixed two-value prefix ("Oprire" = full stop, "Deficienta" = degraded);
// the suffix names the utility, where "ACC/INC" means the incident affects both and so
// belongs to two utility episodes. Anything else is a service string this derivation
// doesn't know how to interpret -- a gate, not a guess, so it throws rather than drop or
// misclassify the incident.
function unpackService(service: string): { isOprire: boolean; utilities: string[] } {
  const [severity, util] = service.split(" ");
  if (severity !== "Oprire" && severity !== "Deficienta") {
    throw new Error(`unrecognized service: "${service}"`);
  }
  if (util !== "ACC" && util !== "INC" && util !== "ACC/INC") {
    throw new Error(`unrecognized service: "${service}"`);
  }
  return {
    isOprire: severity === "Oprire",
    utilities: util === "ACC/INC" ? ["ACC", "INC"] : [util],
  };
}

// An incident plus its already-parsed isOprire fact -- parsed once, by unpackService in
// the grouping loop below, so buildEpisodes never re-splits the service string.
interface UtilityMember {
  incident: Incident;
  isOprire: boolean;
}

// One (sector, pt_name, utility) key's incidents, in first-seen order -- the order they
// arrive in from the finished `incidents` array, which is itself opening order.
interface UtilityGroup {
  sector: string;
  pt_name: string;
  utility: string;
  members: UtilityMember[];
}

// One current episode's in-progress span while sweeping a key's incidents.
interface EpisodeBuilder {
  members: Incident[];
  first_seen_ts: string;
  last_seen_ts: string;
  spanEndTs: string | null; // max first_absent_ts over the CURRENT span; null = infinity
  spanHasOprire: boolean; // whether the CURRENT span contains an Oprire-severity incident
  n_bridged_gaps: number;
  bridged_seconds: number;
}

function startEpisode(member: UtilityMember): EpisodeBuilder {
  const { incident } = member;
  return {
    members: [incident],
    first_seen_ts: incident.first_seen_ts,
    last_seen_ts: incident.last_seen_ts,
    spanEndTs: incident.first_absent_ts,
    spanHasOprire: member.isOprire,
    n_bridged_gaps: 0,
    bridged_seconds: 0,
  };
}

function finishEpisode(group: UtilityGroup, b: EpisodeBuilder): Episode {
  return {
    episode_id: "",
    sector: group.sector,
    pt_name: group.pt_name,
    utility: group.utility,
    members: b.members,
    first_seen_ts: b.first_seen_ts,
    last_seen_ts: b.last_seen_ts,
    first_absent_ts: b.spanEndTs,
    n_bridged_gaps: b.n_bridged_gaps,
    bridged_seconds: b.bridged_seconds,
  };
}

// null stands for infinity (an open span or incident); concrete timestamps compare as
// plain strings since ISO timestamps are fixed-width.
function maxOpenEndedTs(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  return a >= b ? a : b;
}

// Builds one key's finished episodes from its incidents, already in first_seen order.
// Overlapping/contiguous incidents share a span outright; a gap either bridges (span so
// far contains an Oprire, and the gap is <= 24h) or closes the episode.
function buildEpisodes(group: UtilityGroup): Episode[] {
  const episodes: Episode[] = [];
  let current: EpisodeBuilder | undefined;

  for (const member of group.members) {
    const { incident: inc, isOprire } = member;

    if (current === undefined) {
      current = startEpisode(member);
      continue;
    }

    if (current.spanEndTs === null || inc.first_seen_ts <= current.spanEndTs) {
      current.members.push(inc);
      current.spanEndTs = maxOpenEndedTs(current.spanEndTs, inc.first_absent_ts);
      current.spanHasOprire ||= isOprire;
      if (inc.last_seen_ts > current.last_seen_ts) current.last_seen_ts = inc.last_seen_ts;
      continue;
    }

    // Append "Z" so naive local timestamps are treated as a fixed offset -- deterministic
    // (DST-edge wall-clock skew is an accepted caveat).
    const gapSeconds = (Date.parse(`${inc.first_seen_ts}Z`) - Date.parse(`${current.spanEndTs}Z`)) /
      1000;

    if (gapSeconds <= 86400 && current.spanHasOprire) {
      current.n_bridged_gaps++;
      current.bridged_seconds += gapSeconds;
      current.members.push(inc);
      current.spanEndTs = inc.first_absent_ts;
      // Resets to the new span: this is the recovery-tail rule -- Oprire -> gap ->
      // Deficienta bridges, but that Deficienta must not itself re-bridge the next gap.
      current.spanHasOprire = isOprire;
      if (inc.last_seen_ts > current.last_seen_ts) current.last_seen_ts = inc.last_seen_ts;
      continue;
    }

    episodes.push(finishEpisode(group, current));
    current = startEpisode(member);
  }

  if (current !== undefined) episodes.push(finishEpisode(group, current));
  return episodes;
}

// Shared by incident and episode identity: both are "first 12 hex of SHA-1 over a
// pipe-joined natural key" -- the digest itself is the only async step either needs.
async function shortSha1(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
    .slice(0, 12);
}

function incidentId(incident: Incident): Promise<string> {
  return shortSha1(
    `${incident.first_seen_ts}|${incident.sector}|${incident.pt_name}|${incident.service}`,
  );
}

function episodeId(episode: Episode): Promise<string> {
  return shortSha1(
    `${episode.first_seen_ts}|${episode.sector}|${episode.pt_name}|${episode.utility}`,
  );
}

// Flattens an episode's members into the estimate/cause history the scoring seam wants.
// Members are in opening order but concurrent incidents interleave in time, so the merged
// runs are re-sorted by first_seen_ts (stable, preserving member order on ties).
function episodeHistory(episode: Episode): EpisodeHistory {
  const byStart = (a: { first_seen_ts: string }, b: { first_seen_ts: string }) =>
    a.first_seen_ts < b.first_seen_ts ? -1 : a.first_seen_ts > b.first_seen_ts ? 1 : 0;
  return {
    episode_id: episode.episode_id,
    sector: episode.sector,
    pt_name: episode.pt_name,
    utility: episode.utility,
    first_absent_ts: episode.first_absent_ts,
    estimates: episode.members.flatMap((m) => m.estimateRuns).sort(byStart),
    causes: episode.members.flatMap((m) => m.causeRuns).sort(byStart),
  };
}

export async function deriveDatasets(snapshots: Iterable<FoundationSnapshot>): Promise<Derived> {
  const open = new Map<string, Incident>();
  const incidents: Incident[] = [];
  const usableDays = new Set<string>();
  let snapshotCount = 0;

  // Plain sync sweep -- the only async work (hashing incident ids) happens after, over
  // the finished `incidents` array.
  for (const snap of snapshots) {
    snapshotCount++;
    // error/parse_error: the page had content we couldn't read, so it can't testify to
    // absence. Open incidents run straight across it -- skip entirely, evidence or not.
    if (snap.status === "error" || snap.status === "parse_error") continue;

    usableDays.add(snap.ts.slice(0, 10));

    const groups = new Map<string, KeyGroup>();
    for (const obs of snap.observations) {
      const key = keyOf(obs.sector, obs.pt_name, obs.service);
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          sector: obs.sector,
          pt_name: obs.pt_name,
          service: obs.service,
          estimates: new Set(),
          causes: new Set(),
        };
        groups.set(key, group);
      }
      group.estimates.add(obs.estimated_restore);
      group.causes.add(obs.cause);
    }

    // Absent this (parseable) snapshot = closed. An "empty" snapshot has no groups at
    // all, so this closes every open incident -- exactly decision #8's rule.
    for (const [key, incident] of open) {
      if (!groups.has(key)) {
        incident.first_absent_ts = snap.ts;
        open.delete(key);
      }
    }

    for (const [key, group] of groups) {
      let incident = open.get(key);
      if (incident === undefined) {
        incident = {
          incident_id: "",
          sector: group.sector,
          pt_name: group.pt_name,
          service: group.service,
          first_seen_ts: snap.ts,
          last_seen_ts: snap.ts,
          first_absent_ts: null,
          snapshots_present: 0,
          estimateRuns: [],
          causeRuns: [],
          openEstimateRuns: new Map(),
          openCauseRuns: new Map(),
        };
        open.set(key, incident);
        incidents.push(incident); // push order = incident opening order = output order
      } else {
        incident.last_seen_ts = snap.ts;
      }
      // Collision merge: presence counts once per key per snapshot no matter how many
      // rows shared the key; the Sets above already merged their distinct estimate/cause
      // values.
      incident.snapshots_present++;
      advanceRuns(incident.estimateRuns, incident.openEstimateRuns, group.estimates, snap.ts);
      advanceRuns(incident.causeRuns, incident.openCauseRuns, group.causes, snap.ts);
    }
  }

  const ids = await Promise.all(incidents.map(incidentId));
  incidents.forEach((incident, i) => (incident.incident_id = ids[i]));

  const files = new Map<string, string>();
  let estimateRuns = 0;
  let causeRuns = 0;
  let openIncidents = 0;

  // Partitioned by the INCIDENT's first_seen_ts month: an incident and all of its runs
  // land in one file even if a run extends into a later month. Buckets are created (and
  // thus files emitted) only for months that actually opened an incident.
  interface MonthBucket {
    incidents: CsvValue[][];
    estimates: CsvValue[][];
    causes: CsvValue[][];
    episodes: CsvValue[][];
    episodeIncidents: CsvValue[][];
    estimateScores: CsvValue[][];
  }
  const byMonth = new Map<string, MonthBucket>();

  for (const incident of incidents) {
    if (incident.first_absent_ts === null) openIncidents++;
    estimateRuns += incident.estimateRuns.length;
    causeRuns += incident.causeRuns.length;

    const month = incident.first_seen_ts.slice(0, 7);
    let bucket = byMonth.get(month);
    if (bucket === undefined) {
      bucket = {
        incidents: [],
        estimates: [],
        causes: [],
        episodes: [],
        episodeIncidents: [],
        estimateScores: [],
      };
      byMonth.set(month, bucket);
    }

    bucket.incidents.push([
      incident.incident_id,
      incident.sector,
      incident.pt_name,
      incident.service,
      incident.first_seen_ts,
      incident.last_seen_ts,
      incident.first_absent_ts ?? "",
      incident.snapshots_present,
    ]);
    for (const run of incident.estimateRuns) {
      bucket.estimates.push([incident.incident_id, run.value, run.first_seen_ts, run.last_seen_ts]);
    }
    for (const run of incident.causeRuns) {
      bucket.causes.push([incident.incident_id, run.value, run.first_seen_ts, run.last_seen_ts]);
    }
  }

  // Episode grouping: key = (sector, pt_name, utility), the U+0001-joined trick again
  // (over the utility rather than the raw service) -- a Map preserves first-appearance
  // order per key, and an ACC/INC incident lands in two groups. This is also the single
  // call site for unpackService per incident: isOprire travels with each member from here
  // on, so buildEpisodes/startEpisode never re-parse the service string.
  const episodeGroups = new Map<string, UtilityGroup>();
  for (const incident of incidents) {
    const { isOprire, utilities } = unpackService(incident.service);
    for (const utility of utilities) {
      const key = `${incident.sector}${incident.pt_name}${utility}`;
      let group = episodeGroups.get(key);
      if (group === undefined) {
        group = { sector: incident.sector, pt_name: incident.pt_name, utility, members: [] };
        episodeGroups.set(key, group);
      }
      group.members.push({ incident, isOprire });
    }
  }

  const episodes: Episode[] = [];
  for (const group of episodeGroups.values()) episodes.push(...buildEpisodes(group));

  const episodeIds = await Promise.all(episodes.map(episodeId));
  episodes.forEach((episode, i) => (episode.episode_id = episodeIds[i]));

  // Output ordering: (first_seen_ts, sector, pt_name, utility), all lexicographic --
  // U+0001 again, this time as a sort-key joiner rather than a Map key.
  episodes.sort((a, b) => {
    const ka = `${a.first_seen_ts}${a.sector}${a.pt_name}${a.utility}`;
    const kb = `${b.first_seen_ts}${b.sector}${b.pt_name}${b.utility}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  let openEpisodes = 0;
  let bridgedGaps = 0;
  const allScores: EstimateScore[] = [];
  const activeRows: CsvValue[][] = [];

  // An episode and all its link rows land in the month of the EPISODE's first_seen_ts,
  // which always belongs to some member incident -- so that month's bucket already exists
  // from the incidents loop above, even when every one of this month's incidents joined
  // episodes begun in an earlier month (a header-only episodes/episode_incidents file).
  for (const episode of episodes) {
    if (episode.first_absent_ts === null) openEpisodes++;
    bridgedGaps += episode.n_bridged_gaps;

    const month = episode.first_seen_ts.slice(0, 7);
    const bucket = byMonth.get(month);
    if (bucket === undefined) {
      throw new Error(`episode ${episode.episode_id}: no bucket for month ${month}`);
    }

    bucket.episodes.push([
      episode.episode_id,
      episode.sector,
      episode.pt_name,
      episode.utility,
      episode.first_seen_ts,
      episode.last_seen_ts,
      episode.first_absent_ts ?? "",
      episode.members.length,
      episode.n_bridged_gaps,
      episode.bridged_seconds,
    ]);
    for (const member of episode.members) {
      bucket.episodeIncidents.push([episode.episode_id, member.incident_id]);
    }

    // Ended episodes score their estimates (into the opening month's bucket, like the
    // episode row itself); open ones join the active index the scrape pass joins against.
    const history = episodeHistory(episode);
    if (episode.first_absent_ts === null) {
      activeRows.push([
        episode.episode_id,
        episode.sector,
        episode.pt_name,
        episode.utility,
        currentSlipCount(history),
      ]);
    } else {
      for (const score of scoreEpisode(history)) {
        allScores.push(score);
        bucket.estimateScores.push([
          score.episode_id,
          score.sector,
          score.pt_name,
          score.utility,
          score.cause_class,
          score.slip_count,
          score.estimated_restore,
          score.posted_ts,
          score.restored_ts,
          score.hit ? 1 : 0,
        ]);
      }
    }
  }

  const render = (header: string[], rows: CsvValue[][]) =>
    formatRow(header) + rows.map(formatRow).join("");
  for (const [month, bucket] of byMonth) {
    files.set(monthPath(INCIDENTS_DIR, month), render(INCIDENT_HEADER, bucket.incidents));
    files.set(monthPath(ESTIMATES_DIR, month), render(ESTIMATE_HEADER, bucket.estimates));
    files.set(monthPath(CAUSES_DIR, month), render(CAUSE_HEADER, bucket.causes));
    files.set(monthPath(EPISODES_DIR, month), render(EPISODE_HEADER, bucket.episodes));
    files.set(
      monthPath(EPISODE_INCIDENTS_DIR, month),
      render(EPISODE_INCIDENT_HEADER, bucket.episodeIncidents),
    );
    files.set(
      monthPath(ESTIMATE_SCORES_DIR, month),
      render(ESTIMATE_SCORE_HEADER, bucket.estimateScores),
    );
  }
  files.set(RATES_PATH, render(RATE_HEADER, aggregateRates(allScores)));
  files.set(ACTIVE_EPISODES_PATH, render(ACTIVE_EPISODE_HEADER, activeRows));

  const episodeSpans: EpisodeSpan[] = episodes.map((episode) => ({
    utility: episode.utility,
    first_seen_ts: episode.first_seen_ts,
    last_seen_ts: episode.last_seen_ts,
  }));

  return {
    files,
    stats: {
      snapshots: snapshotCount,
      incidents: incidents.length,
      openIncidents,
      estimateRuns,
      causeRuns,
      months: byMonth.size,
      episodes: episodes.length,
      openEpisodes,
      bridgedGaps,
      scoredEstimates: allScores.length,
    },
    episodeSpans,
    usableDays,
  };
}
