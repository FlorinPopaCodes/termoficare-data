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

export const INCIDENTS_DIR = "data/derived/incidents";
export const ESTIMATES_DIR = "data/derived/estimates";
export const CAUSES_DIR = "data/derived/causes";

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
}

export interface Derived {
  files: Map<string, string>;
  stats: DeriveStats;
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

async function incidentId(incident: Incident): Promise<string> {
  const input =
    `${incident.first_seen_ts}|${incident.sector}|${incident.pt_name}|${incident.service}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
    .slice(0, 12);
}

export async function deriveDatasets(snapshots: Iterable<FoundationSnapshot>): Promise<Derived> {
  const open = new Map<string, Incident>();
  const incidents: Incident[] = [];
  let snapshotCount = 0;

  // Plain sync sweep -- the only async work (hashing incident ids) happens after, over
  // the finished `incidents` array.
  for (const snap of snapshots) {
    snapshotCount++;
    // error/parse_error: the page had content we couldn't read, so it can't testify to
    // absence. Open incidents run straight across it -- skip entirely, evidence or not.
    if (snap.status === "error" || snap.status === "parse_error") continue;

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
  }
  const byMonth = new Map<string, MonthBucket>();

  for (const incident of incidents) {
    if (incident.first_absent_ts === null) openIncidents++;
    estimateRuns += incident.estimateRuns.length;
    causeRuns += incident.causeRuns.length;

    const month = incident.first_seen_ts.slice(0, 7);
    let bucket = byMonth.get(month);
    if (bucket === undefined) {
      bucket = { incidents: [], estimates: [], causes: [] };
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

  const render = (header: string[], rows: CsvValue[][]) =>
    formatRow(header) + rows.map(formatRow).join("");
  for (const [month, bucket] of byMonth) {
    files.set(monthPath(INCIDENTS_DIR, month), render(INCIDENT_HEADER, bucket.incidents));
    files.set(monthPath(ESTIMATES_DIR, month), render(ESTIMATE_HEADER, bucket.estimates));
    files.set(monthPath(CAUSES_DIR, month), render(CAUSE_HEADER, bucket.causes));
  }

  return {
    files,
    stats: {
      snapshots: snapshotCount,
      incidents: incidents.length,
      openIncidents,
      estimateRuns,
      causeRuns,
      months: byMonth.size,
    },
  };
}
