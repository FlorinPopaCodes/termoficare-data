// Postprocess entrypoint for the Flat Data action.
// Thin orchestrator: gathers commit counts from git, then sequences the pure
// heatmap and README modules and writes their output to disk.

import { CommitData, generateSVG, getYearsFromData } from "./src/heatmap.ts";
import { generateReadme } from "./src/readme.ts";

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

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
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

  console.log("Done!");
}

main();
