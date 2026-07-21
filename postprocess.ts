// Postprocess entrypoint for the Flat Data action.
// Thin orchestrator: skips all writes when the snapshot is unchanged, otherwise appends
// the scrape's structured artifacts, then sequences the pure heatmap and README modules
// and writes their output to disk.

import { CommitData, generateSVG, getYearsFromData } from "./src/heatmap.ts";
import { generateReadme } from "./src/readme.ts";
import { bucharestTimestamp } from "./src/clock.ts";
import {
  appendPayload,
  type CsvValue,
  monthFile,
  OBSERVATION_HEADER,
  OBSERVATIONS_DIR,
  SNAPSHOT_LOG_HEADER,
  SNAPSHOTS_DIR,
} from "./src/csv.ts";
import { buildArtifacts, SNAPSHOT_PATH } from "./src/snapshot.ts";
import { parseSnapshot } from "./src/parser.ts";
import {
  ACTIVE_EPISODES_PATH,
  parsePredictionContext,
  type PredictionContext,
  RATES_PATH,
} from "./src/on_time.ts";

async function runGit(args: string[]): Promise<string> {
  const cmd = new Deno.Command("git", { args, stdout: "piped" });
  const output = await cmd.output();
  if (!output.success) {
    throw new Error(`git ${args[0]} failed with code ${output.code}`);
  }
  return new TextDecoder().decode(output.stdout);
}

// Only commits touching data/ are data updates: the 2026-01..07 heatmap feedback loop
// left thousands of heatmap-only commits (the SVG counting its own previous commit) that
// must not count.
async function getCommitCounts(): Promise<CommitData> {
  const text = await runGit([
    "log",
    "--author=flat-data",
    "--author=Archive Bot",
    "--format=%ad",
    "--date=short",
    "--",
    "data/",
  ]);

  const counts: CommitData = {};
  for (const line of text.trim().split("\n")) {
    if (line) {
      counts[line] = (counts[line] || 0) + 1;
    }
  }
  return counts;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// Porcelain output is non-empty for an untracked file too, so the first-ever snapshot
// counts as changed.
async function htmlChanged(): Promise<boolean> {
  return (await runGit(["status", "--porcelain", "--", SNAPSHOT_PATH])).trim().length > 0;
}

async function appendCsv(dir: string, ts: string, header: string[], rows: CsvValue[][]) {
  const path = monthFile(dir, ts);
  const payload = appendPayload(await fileExists(path), header, rows);
  if (payload === "") return;

  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, payload, { append: true });
}

// The daily derive pass refreshes the rate files; until it has run (or if a deploy skew
// left them malformed) current.json simply omits the on-time fields.
async function readPredictionContext(): Promise<PredictionContext | null> {
  try {
    return parsePredictionContext(
      await Deno.readTextFile(RATES_PATH),
      await Deno.readTextFile(ACTIVE_EPISODES_PATH),
    );
  } catch {
    return null;
  }
}

// One clock reading feeds all three payloads.
async function writeStructuredArtifacts() {
  const ts = bucharestTimestamp(new Date());
  const artifacts = buildArtifacts(
    await Deno.readTextFile(SNAPSHOT_PATH),
    ts,
    parseSnapshot,
    await readPredictionContext(),
  );

  await appendCsv(OBSERVATIONS_DIR, ts, OBSERVATION_HEADER, artifacts.observations);
  await appendCsv(SNAPSHOTS_DIR, ts, SNAPSHOT_LOG_HEADER, [artifacts.logRow]);
  await Deno.writeTextFile("data/current.json", artifacts.currentJson);

  console.log(`Status: ${artifacts.status}, observations: ${artifacts.observations.length}`);
}

async function main() {
  // An unchanged snapshot is noise, not an observation: skip every write so Flat has
  // nothing to commit. Regenerating the heatmap here would count the previous run's
  // commit and re-commit forever.
  if (!(await htmlChanged())) {
    console.log("Snapshot unchanged — skipping all writes");
    return;
  }

  // A lost HTML snapshot is unrecoverable; bad structured data is repairable by rerunning
  // the backfill. So nothing here may abort the run -- that would cost the snapshot commit
  // and the heatmap below. A persistently broken write path surfaces as scrape-log silence.
  try {
    await writeStructuredArtifacts();
  } catch (err) {
    console.error("Structured artifacts failed; continuing so the snapshot still commits:", err);
  }

  console.log("Generating heatmaps...");

  const data = await getCommitCounts();
  const years = getYearsFromData(data);

  console.log(`Found data for years: ${years.join(", ")}`);

  // Create images directory if needed
  await Deno.mkdir("images", { recursive: true });

  // Backfills can add commits with historical author dates, so past-year SVGs are not
  // immutable -- regenerate them all.
  for (const year of years) {
    const svgPath = `images/heatmap-${year}.svg`;
    console.log(`Generating ${svgPath}...`);
    const svg = generateSVG(year, data);
    await Deno.writeTextFile(svgPath, svg);
  }

  // Generate README. It must render correctly even when derive has never run, so
  // outage-map years are discovered from the images/ listing rather than from derive's
  // own state.
  console.log("Generating README.md...");
  const imageFiles: string[] = [];
  for await (const entry of Deno.readDir("images")) {
    if (entry.isFile) imageFiles.push(entry.name);
  }
  const readme = generateReadme(years, imageFiles);
  await Deno.writeTextFile("README.md", readme);

  console.log("Done!");
}

main();
