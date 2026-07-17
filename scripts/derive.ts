#!/usr/bin/env -S deno run --allow-read --allow-write
//
// Regenerates the derived incident/estimate/cause/episode history from the foundation
// CSVs (data/observations, data/snapshots) per decision #8.
//
//   deno task derive
//
// Full deterministic regeneration -- no cursors, no resume state. Reads each month's
// snapshot log + observations file, aligns them via foundationSnapshots (which throws on
// any mismatch), and feeds the aligned stream to deriveDatasets. Only
// data/derived/{incidents,estimates,causes,episodes,episode_incidents} are replaced
// wholesale; anything else under data/derived/ is left untouched for future datasets to
// live beside these.
//
// Foundation month files are read one at a time (never more than one month's ~586MB of
// observations held in memory together) via a sync generator, matching foundationSnapshots'
// own laziness.

import {
  CAUSES_DIR,
  deriveDatasets,
  EPISODE_INCIDENTS_DIR,
  EPISODES_DIR,
  ESTIMATES_DIR,
  foundationSnapshots,
  INCIDENTS_DIR,
  type MonthContent,
} from "../src/derive.ts";
import { monthPath, OBSERVATIONS_DIR, SNAPSHOTS_DIR } from "../src/csv.ts";

// Enumerates months from the scrape-log dir (the authoritative set of months that were
// ever scraped) and requires a matching observations file for each -- a missing
// observations file means the foundation data itself is broken, not something to skip.
function monthsToProcess(): string[] {
  const months: string[] = [];
  for (const entry of Deno.readDirSync(SNAPSHOTS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".csv")) months.push(entry.name.slice(0, -4));
  }
  months.sort();
  return months;
}

// Sync generator so deriveDatasets' sweep stays a plain sync loop end to end; only one
// month's file contents are held at a time.
function* readMonths(months: string[]): Generator<MonthContent> {
  for (const month of months) {
    const logPath = monthPath(SNAPSHOTS_DIR, month);
    const observationsPath = monthPath(OBSERVATIONS_DIR, month);
    let observations: string;
    try {
      observations = Deno.readTextFileSync(observationsPath);
    } catch {
      throw new Error(`${month}: scrape log exists but ${observationsPath} is missing`);
    }
    yield { month, log: Deno.readTextFileSync(logPath), observations };
  }
}

// Wholesale replacement, not an append: an incident that no longer derives (e.g. a
// foundation regeneration changed history) must not survive alongside stale output.
// Everything else under data/derived/ is left alone for future datasets.
async function write(files: Map<string, string>) {
  for (
    const dir of [INCIDENTS_DIR, ESTIMATES_DIR, CAUSES_DIR, EPISODES_DIR, EPISODE_INCIDENTS_DIR]
  ) {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    await Deno.mkdir(dir, { recursive: true });
  }
  for (const [path, content] of files) await Deno.writeTextFile(path, content);
}

async function main() {
  const months = monthsToProcess();
  if (months.length === 0) throw new Error(`no month files found in ${SNAPSHOTS_DIR}`);
  console.error(`${months.length} months to derive, ${months[0]}..${months[months.length - 1]}.`);

  const started = performance.now();
  const { files, stats } = await deriveDatasets(foundationSnapshots(readMonths(months)));
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  console.error(
    `\nDerived ${stats.incidents} incidents (${stats.openIncidents} still open) from ` +
      `${stats.snapshots} snapshots across ${stats.months} months in ${seconds}s.`,
  );
  console.error(`  ${stats.estimateRuns} estimate runs, ${stats.causeRuns} cause runs.`);
  console.error(
    `  ${stats.episodes} episodes (${stats.openEpisodes} still open), ` +
      `${stats.bridgedGaps} bridged gaps.`,
  );

  await write(files);
  console.error(`Wrote ${files.size} files.`);
}

main();
