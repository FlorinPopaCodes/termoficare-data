// One full re-derive of the archive, flattened into the two tables every measurement in
// this folder reads. Re-deriving 590MB of observations takes ~30s and dominates any
// modelling loop, so it happens once here and the models iterate on the flat files.
//
//   WORK=/tmp/end-prediction deno run -A prepare.ts [obs-dir] [snap-dir]
//
// src/ is untouched: this reads the same in-memory `files` map scripts/derive.ts writes
// two entries of, and takes the rest -- the monthly episode and estimate-score histories
// the repo derives but does not publish.

import { deriveDatasets, foundationSnapshots, type MonthContent } from "../../../src/derive.ts";
import { formatRow, parseRows } from "../../../src/csv.ts";

const WORK = Deno.env.get("WORK") ?? ".";
const obsDir = Deno.args[0] ?? "data/observations";
const snapDir = Deno.args[1] ?? "data/snapshots";

function* readMonths(): Generator<MonthContent> {
  const months: string[] = [];
  for (const entry of Deno.readDirSync(snapDir)) {
    if (entry.isFile && entry.name.endsWith(".csv")) months.push(entry.name.slice(0, -4));
  }
  months.sort();
  for (const month of months) {
    yield {
      month,
      log: Deno.readTextFileSync(`${snapDir}/${month}.csv`),
      observations: Deno.readTextFileSync(`${obsDir}/${month}.csv`),
    };
  }
}

const started = performance.now();
const { files, stats } = await deriveDatasets(foundationSnapshots(readMonths()));
console.error(
  `derived ${stats.episodes} episodes (${stats.openEpisodes} open), ` +
    `${stats.scoredEstimates} scored estimates in ` +
    `${((performance.now() - started) / 1000).toFixed(1)}s`,
);

// Every month file of one derived dataset, header dropped.
function rowsOf(dir: string): string[][] {
  const out: string[][] = [];
  for (const [path, content] of files) {
    if (!path.startsWith(`${dir}/`)) continue;
    const rows = parseRows(content);
    for (let i = 1; i < rows.length; i++) out.push(rows[i]);
  }
  return out;
}

// episode_id -> its postings, in posting order. An episode's cause class is its first
// posting's -- the classifier lives in src/on_time.ts and is not reimplemented here, so
// an episode that never carried an estimate has no cause class at all.
const postings = new Map<string, string[][]>();
for (const row of rowsOf("data/derived/estimate_scores")) {
  const list = postings.get(row[0]);
  if (list === undefined) postings.set(row[0], [row]);
  else list.push(row);
}
for (const list of postings.values()) {
  list.sort((a, b) => Number(a[5]) - Number(b[5])); // slip_count
}

const EPISODE_OUT = [
  "episode_id",
  "sector",
  "pt_name",
  "utility",
  "first_seen_ts",
  "last_seen_ts",
  "first_absent_ts", // "" = still open at end of archive (right-censored)
  "n_bridged_gaps",
  "bridged_seconds",
  "cause_class", // "" = never carried an estimate
  "n_postings",
];
const POSTING_OUT = [
  "episode_id",
  "utility",
  "cause_class",
  "slip_count",
  "episode_first_seen_ts",
  "posted_ts",
  "estimated_restore",
  "restored_ts",
  "hit",
];

let episodeOut = formatRow(EPISODE_OUT);
let postingOut = formatRow(POSTING_OUT);
let open = 0;
let noEstimate = 0;

for (const e of rowsOf("data/derived/episodes")) {
  const [episode_id, sector, pt_name, utility, first_seen, last_seen, first_absent, , gaps, secs] =
    e;
  const list = postings.get(episode_id) ?? [];
  if (first_absent === "") open++;
  if (list.length === 0) noEstimate++;
  episodeOut += formatRow([
    episode_id,
    sector,
    pt_name,
    utility,
    first_seen,
    last_seen,
    first_absent,
    gaps,
    secs,
    list[0]?.[4] ?? "",
    list.length,
  ]);
  for (const p of list) {
    postingOut += formatRow([
      p[0], // episode_id
      p[3], // utility
      p[4], // cause_class
      p[5], // slip_count
      first_seen,
      p[7], // posted_ts
      p[6], // estimated_restore
      p[8], // restored_ts
      p[9], // hit
    ]);
  }
}

Deno.writeTextFileSync(`${WORK}/episodes.csv`, episodeOut);
Deno.writeTextFileSync(`${WORK}/postings.csv`, postingOut);
console.error(
  `wrote ${WORK}/episodes.csv (${stats.episodes} rows, ${open} censored, ` +
    `${noEstimate} never estimated) and ${WORK}/postings.csv (${stats.scoredEstimates} rows)`,
);
