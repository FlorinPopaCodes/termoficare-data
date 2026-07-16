// Postprocess entrypoint for the Flat Data action.
// Thin orchestrator: gathers commit counts from git, then sequences the pure
// heatmap and README modules and writes their output to disk.

import { CommitData, generateSVG, getYearsFromData } from "./src/heatmap.ts";
import { generateReadme } from "./src/readme.ts";
import { nowBucharest } from "./src/time.ts";
import { writeSnapshotArtifacts } from "./src/snapshot_artifacts.ts";

const RAW_HTML_PATH = "data/termoficare.html";

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function getCommitCounts(): Promise<CommitData> {
  const cmd = new Deno.Command("git", {
    args: ["log", "--author=flat-data", "--author=Archive Bot", "--format=%ad", "--date=short"],
    stdout: "piped",
  });
  const output = await cmd.output();
  if (!output.success) {
    throw new Error(`Git command failed with code ${output.code}`);
  }
  const text = new TextDecoder().decode(output.stdout);

  const counts: CommitData = {};
  for (const line of text.trim().split("\n")) {
    if (line) {
      counts[line] = (counts[line] || 0) + 1;
    }
  }
  return counts;
}

async function main() {
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

  // Parse the raw snapshot into structured artifacts. Fault-isolated inside
  // writeSnapshotArtifacts: a parser crash must not cost this commit.
  console.log("Parsing termoficare snapshot...");
  const html = await Deno.readTextFile(RAW_HTML_PATH);
  const snapshotTs = nowBucharest();
  const result = await writeSnapshotArtifacts(html, snapshotTs, {
    currentJson: "data/current.json",
    observationsDir: "data/observations",
    snapshotsDir: "data/snapshots",
  });
  console.log(
    `Snapshot ${snapshotTs}: ${result.status} (${result.observations.length} observations)`,
  );

  console.log("Done!");
}

main();
