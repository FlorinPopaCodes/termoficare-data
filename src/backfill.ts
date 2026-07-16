// Regenerates the whole observations + scrape-log dataset from the scrape history, and
// gates the result against the invariants and catalog cross-checks locked in decision #7.
// Pure: an ordered stream of parsed snapshots in, file contents + a verdict out.
// git and disk belong to scripts/backfill.ts.

import { type ScrapeStatus } from "./parser.ts";
import { type SnapshotArtifacts } from "./snapshot.ts";
import {
  appendPayload,
  monthFile,
  OBSERVATION_HEADER,
  OBSERVATIONS_DIR,
  SNAPSHOT_LOG_HEADER,
  SNAPSHOTS_DIR,
} from "./csv.ts";

export interface SnapshotInput {
  instant: number; // committer time, epoch seconds -- the ordering authority
  ts: string; // naive Bucharest label derived from instant; not unique (DST fall-back)
  artifacts: SnapshotArtifacts;
}

export interface MonthStats {
  snapshots: number;
  observations: number; // observation rows routed into the month
  loggedObservations: number; // what the month's scrape log claims it wrote
}

export interface Stats {
  snapshots: number;
  observations: number;
  statusCounts: Record<ScrapeStatus, number>;
  months: Map<string, MonthStats>;
  outOfOrder: string[]; // snapshots whose instant went backwards
  zeroRowViolations: string[]; // non-ok snapshots that still emitted observation rows
  window: { errors: number; empty: number; observations: number }; // catalog-window counts
}

export interface Dataset {
  files: Map<string, string>; // path -> full content; every file is rewritten from scratch
  stats: Stats;
}

// Cross-checks from the independently-derived HTML variant catalog (#4), which
// exhaustively scanned the history through 2026-07-15.
export interface Catalog {
  cutoff: string; // last date the catalog covers (YYYY-MM-DD)
  errors: number; // exactly this many backend-failure scrapes inside the window
  empty: number; // system-wide zero-incident snapshots inside the window
  emptyTolerance: number;
  minObservations: number;
}

// Counts are windowed to the catalog's cutoff because the catalog is a statement about a
// fixed span while the live loop keeps appending past it. Unwindowed, "exactly 4 errors"
// would fire the next time CMTEB's backend hiccups -- turning a durable gate into a
// tripwire that has to be edited every rerun.
export const CATALOG: Catalog = {
  cutoff: "2026-07-15",
  errors: 4,
  // "~42": the catalog counted these by file size and table count, the parser by the
  // flag-galben banner. The two need not agree to the snapshot.
  empty: 42,
  emptyTolerance: 3,
  // A floor, not a target: #4's 467,518 counts pre-explosion HTML rows, and one row
  // carries 1..55 puncte termice, so the observation total lands far above it.
  minObservations: 467_518,
};

// The commits behind decision #7's manual spot checks, pinned by SHA from the fixture
// manifest so the checks run on every regeneration instead of by hand.
export interface SpotCheck {
  sha: string;
  why: string;
  failure: (a: SnapshotArtifacts) => string | null;
}

export const SPOT_CHECKS: SpotCheck[] = [
  {
    sha: "20e267f80181f8438b0f8c17aa97b5a0400d60e0",
    why: "the worst snapshot: 39 HTML rows, one cell holding 90 puncte termice",
    failure: (a) =>
      a.observations.length === 518
        ? null
        : `expected 518 observations, got ${a.observations.length}`,
  },
  {
    sha: "eb87d333c5f2f0dc355cde108230c211d32470f6",
    why: "the first literal Nedefinit estimate",
    // Column 6 is estimated_restore; Nedefinit is null in JSON but an empty CSV field.
    failure: (a) =>
      a.observations.some((row) => row[6] === "") ? null : "no row with an empty estimate",
  },
  {
    sha: "e1ef8331f9f905f8cc1f7935ffccfe4d5a62844c",
    why: "CMTEB's -6 blocuri/imobile data-entry bug, kept as scraped",
    // Column 3 is blocks.
    failure: (a) =>
      a.observations.some((row) => (row[3] as number) < 0)
        ? null
        : "no row with a negative block count",
  },
];

interface Bucket {
  observations: string[];
  log: string[];
  started: boolean;
  stats: MonthStats;
}

export async function buildDataset(
  snapshots: AsyncIterable<SnapshotInput>,
  catalog: Catalog = CATALOG,
): Promise<Dataset> {
  const buckets = new Map<string, Bucket>();
  const stats: Stats = {
    snapshots: 0,
    observations: 0,
    statusCounts: { ok: 0, empty: 0, error: 0, parse_error: 0 },
    months: new Map(),
    outOfOrder: [],
    zeroRowViolations: [],
    window: { errors: 0, empty: 0, observations: 0 },
  };
  let previous = -Infinity;

  for await (const { instant, ts, artifacts } of snapshots) {
    const month = ts.slice(0, 7);
    let bucket = buckets.get(month);
    if (bucket === undefined) {
      bucket = {
        observations: [],
        log: [],
        started: false,
        stats: { snapshots: 0, observations: 0, loggedObservations: 0 },
      };
      buckets.set(month, bucket);
      stats.months.set(month, bucket.stats);
    }

    // Routed through the live loop's own append logic, so a backfilled month is
    // byte-identical to one the live loop wrote -- including the header-only file a month
    // of nothing but empty snapshots produces.
    bucket.observations.push(
      appendPayload(bucket.started, OBSERVATION_HEADER, artifacts.observations),
    );
    bucket.log.push(appendPayload(bucket.started, SNAPSHOT_LOG_HEADER, [artifacts.logRow]));
    bucket.started = true;

    const rows = artifacts.observations.length;
    bucket.stats.snapshots++;
    bucket.stats.observations += rows;
    bucket.stats.loggedObservations += Number(artifacts.logRow[2]);

    stats.snapshots++;
    stats.observations += rows;
    stats.statusCounts[artifacts.status]++;
    if (instant < previous) stats.outOfOrder.push(ts);
    if (artifacts.status !== "ok" && rows > 0) stats.zeroRowViolations.push(ts);

    if (ts.slice(0, 10) <= catalog.cutoff) {
      stats.window.observations += rows;
      if (artifacts.status === "error") stats.window.errors++;
      if (artifacts.status === "empty") stats.window.empty++;
    }

    previous = instant;
  }

  const files = new Map<string, string>();
  for (const [month, bucket] of buckets) {
    const ts = `${month}-01T00:00:00`;
    files.set(monthFile(OBSERVATIONS_DIR, ts), bucket.observations.join(""));
    files.set(monthFile(SNAPSHOTS_DIR, ts), bucket.log.join(""));
  }

  return { files, stats };
}

export interface ValidationInput {
  dataset: Dataset;
  expectedSnapshots: number; // commits enumerated by rev-list
  captured: Map<string, SnapshotArtifacts>; // sha -> artifacts, for SPOT_CHECKS
}

function dataRows(content: string | undefined): number {
  if (content === undefined) return -1;
  return content.split("\n").filter((l) => l !== "").length - 1; // less the header
}

// Every gate decision #7 lists, run against the bytes about to be pushed rather than
// against the counters that produced them. Returns one message per failure; empty = green.
export function validate(input: ValidationInput, catalog: Catalog = CATALOG): string[] {
  const { dataset: { files, stats }, expectedSnapshots, captured } = input;
  const failures: string[] = [];

  if (stats.snapshots !== expectedSnapshots) {
    failures.push(
      `scrape log has ${stats.snapshots} rows, but rev-list enumerated ${expectedSnapshots} commits`,
    );
  }
  if (stats.outOfOrder.length > 0) {
    failures.push(
      `${stats.outOfOrder.length} snapshots are out of commit order, so file order is no ` +
        `longer the chronology (first: ${stats.outOfOrder[0]})`,
    );
  }
  if (stats.zeroRowViolations.length > 0) {
    failures.push(
      `${stats.zeroRowViolations.length} non-ok snapshots emitted observation rows; empty, ` +
        `error and parse_error must yield zero observation rows ` +
        `(first: ${stats.zeroRowViolations[0]})`,
    );
  }

  // Per-month reconciliation, counted off the rendered files.
  let observations = 0;
  let logged = 0;
  for (const [month, monthStats] of stats.months) {
    const ts = `${month}-01T00:00:00`;
    const inObservations = dataRows(files.get(monthFile(OBSERVATIONS_DIR, ts)));
    const inLog = dataRows(files.get(monthFile(SNAPSHOTS_DIR, ts)));

    if (inObservations !== monthStats.observations) {
      failures.push(
        `${month}: observations file holds ${inObservations} rows, expected ${monthStats.observations}`,
      );
    }
    if (inLog !== monthStats.snapshots) {
      failures.push(`${month}: scrape log holds ${inLog} rows, expected ${monthStats.snapshots}`);
    }
    if (monthStats.observations !== monthStats.loggedObservations) {
      failures.push(
        `${month}: scrape log claims ${monthStats.loggedObservations} observations, ` +
          `file holds ${monthStats.observations}`,
      );
    }
    observations += monthStats.observations;
    logged += monthStats.snapshots;
  }
  if (observations !== stats.observations) {
    failures.push(`months hold ${observations} observations, total says ${stats.observations}`);
  }
  if (logged !== stats.snapshots) {
    failures.push(`months hold ${logged} snapshots, total says ${stats.snapshots}`);
  }

  // Cross-checks against #4's catalog, windowed to the span it covers.
  const window = `through ${catalog.cutoff}`;
  if (stats.window.errors !== catalog.errors) {
    failures.push(
      `${stats.window.errors} error scrapes ${window}, catalog found exactly ${catalog.errors}`,
    );
  }
  if (Math.abs(stats.window.empty - catalog.empty) > catalog.emptyTolerance) {
    failures.push(
      `${stats.window.empty} empty snapshots ${window}, catalog found ~${catalog.empty} ` +
        `(tolerance ±${catalog.emptyTolerance})`,
    );
  }
  if (stats.window.observations < catalog.minObservations) {
    failures.push(
      `${stats.window.observations} observations ${window}, below the catalog floor of ` +
        `${catalog.minObservations}`,
    );
  }

  for (const spot of SPOT_CHECKS) {
    const artifacts = captured.get(spot.sha);
    if (artifacts === undefined) {
      failures.push(`spot check ${spot.sha} (${spot.why}) was not captured from history`);
      continue;
    }
    const failure = spot.failure(artifacts);
    if (failure !== null) failures.push(`spot check ${spot.sha} (${spot.why}): ${failure}`);
  }

  return failures;
}
