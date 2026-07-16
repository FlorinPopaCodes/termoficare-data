// Postprocess entrypoint for the Flat Data action.
// Thin orchestrator: appends the scrape's structured artifacts, then sequences the pure
// heatmap and README modules and writes their output to disk.

import { CommitData, generateSVG, getYearsFromData } from "./src/heatmap.ts";
import { generateReadme } from "./src/readme.ts";
import { bucharestTimestamp } from "./src/clock.ts";
import {
  appendPayload,
  type CsvValue,
  monthFile,
  OBSERVATION_HEADER,
  SNAPSHOT_LOG_HEADER,
} from "./src/csv.ts";
import { buildArtifacts } from "./src/snapshot.ts";

const SNAPSHOT_PATH = "data/termoficare.html";

async function runGit(args: string[]): Promise<string> {
  const cmd = new Deno.Command("git", { args, stdout: "piped" });
  const output = await cmd.output();
  if (!output.success) {
    throw new Error(`git ${args[0]} failed with code ${output.code}`);
  }
  return new TextDecoder().decode(output.stdout);
}

async function getCommitCounts(): Promise<CommitData> {
  const text = await runGit([
    "log",
    "--author=flat-data",
    "--author=Archive Bot",
    "--format=%ad",
    "--date=short",
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

// Only change-bearing scrapes emit structured artifacts -- an unchanged snapshot is
// noise, not an observation. One clock reading feeds all three payloads.
async function writeStructuredArtifacts() {
  if (!(await htmlChanged())) {
    console.log("Snapshot unchanged — skipping structured artifacts");
    return;
  }

  const ts = bucharestTimestamp(new Date());
  const artifacts = buildArtifacts(await Deno.readTextFile(SNAPSHOT_PATH), ts);

  await appendCsv("data/observations", ts, OBSERVATION_HEADER, artifacts.observations);
  await appendCsv("data/snapshots", ts, SNAPSHOT_LOG_HEADER, [artifacts.logRow]);
  await Deno.writeTextFile("data/current.json", artifacts.currentJson);

  console.log(`Status: ${artifacts.status}, observations: ${artifacts.observations.length}`);
}

async function main() {
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
  const currentYear = new Date().getFullYear();

  console.log(`Found data for years: ${years.join(", ")}`);
  console.log(`Current year: ${currentYear}`);

  // Create images directory if needed
  await Deno.mkdir("images", { recursive: true });

  // Generate heatmaps
  for (const year of years) {
    const svgPath = `images/heatmap-${year}.svg`;
    const isCurrentYear = year === currentYear;
    const exists = await fileExists(svgPath);

    if (isCurrentYear || !exists) {
      console.log(`Generating ${svgPath}...`);
      const svg = generateSVG(year, data);
      await Deno.writeTextFile(svgPath, svg);
    } else {
      console.log(`Skipping ${svgPath} (already exists)`);
    }
  }

  // Generate README
  console.log("Generating README.md...");
  const readme = generateReadme(years);
  await Deno.writeTextFile("README.md", readme);

  console.log("Done!");
}

main();
