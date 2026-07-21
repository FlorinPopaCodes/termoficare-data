#!/usr/bin/env -S deno run --allow-read --allow-write
//
// Regenerates the published derived outputs from the foundation CSVs (data/observations,
// data/snapshots) per decision #8, and renders the episode heatmap SVGs
// (images/episodes-<utility>-<year>.svg) from the same derivation.
//
//   deno task derive
//
// Full deterministic regeneration -- no cursors, no resume state. Reads each month's
// snapshot log + observations file, aligns them via foundationSnapshots (which throws on
// any mismatch), and feeds the aligned stream to deriveDatasets. The derivation renders
// the full incident/estimate/cause/episode history in memory (the surface the tests lock
// down), but only the files postprocess.ts consumes are written out:
// data/derived/on_time_rates.csv and data/derived/active_episodes.csv. The monthly
// history datasets are not published -- nothing reads them from disk, and they re-derive
// from the foundation at any time. The images/ output is regenerated wholesale (one file
// per utility per year) but nothing there is removed first -- images/heatmap-<year>.svg
// from the commit heatmap lives alongside it undisturbed.
//
// Foundation month files are read one at a time (never more than one month's ~586MB of
// observations held in memory together) via a sync generator, matching foundationSnapshots'
// own laziness.

import { deriveDatasets, foundationSnapshots, type MonthContent } from "../src/derive.ts";
import { ACTIVE_EPISODES_PATH, RATES_PATH } from "../src/on_time.ts";
import { monthPath, OBSERVATIONS_DIR, SNAPSHOTS_DIR } from "../src/csv.ts";
import { IMAGES_DIR, renderEpisodeHeatmaps } from "../src/episode_heatmap.ts";

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

const PUBLISHED_PATHS = [RATES_PATH, ACTIVE_EPISODES_PATH];

async function main() {
  const months = monthsToProcess();
  if (months.length === 0) throw new Error(`no month files found in ${SNAPSHOTS_DIR}`);
  console.error(`${months.length} months to derive, ${months[0]}..${months[months.length - 1]}.`);

  const started = performance.now();
  const { files, stats, episodeSpans, usableDays } = await deriveDatasets(
    foundationSnapshots(readMonths(months)),
  );
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
  console.error(`  ${stats.scoredEstimates} scored estimates.`);

  for (const path of PUBLISHED_PATHS) await Deno.writeTextFile(path, files.get(path)!);
  console.error(`Wrote ${PUBLISHED_PATHS.length} files.`);

  const heatmaps = renderEpisodeHeatmaps(episodeSpans, usableDays);
  await Deno.mkdir(IMAGES_DIR, { recursive: true });
  for (const [path, svg] of heatmaps) await Deno.writeTextFile(path, svg);
  console.error(`Wrote ${heatmaps.size} episode heatmaps.`);
}

main();
