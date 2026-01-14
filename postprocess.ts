// Postprocess script for Flat Data action
// Generates GitHub-style contribution heatmaps showing data commits per day

const COLORS = {
  empty: "#161b22",
  level1: "#fef0d9",
  level2: "#fdcc8a",
  level3: "#fc8d59",
  level4: "#d7301f",
};

const CELL_SIZE = 11;
const CELL_GAP = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface CommitData {
  [date: string]: number;
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

function getYearsFromData(data: CommitData): number[] {
  const years = new Set<number>();
  for (const date of Object.keys(data)) {
    years.add(parseInt(date.substring(0, 4)));
  }
  return Array.from(years).sort((a, b) => b - a);
}

function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const startDay = startOfYear.getDay();
  // Adjust for Monday as first day (0=Mon, 6=Sun)
  const adjustedStartDay = startDay === 0 ? 6 : startDay - 1;
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000);
  return Math.floor((dayOfYear + adjustedStartDay) / 7);
}

function getDayOfWeek(date: Date): number {
  // Monday = 0, Sunday = 6
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function getColorForCount(count: number, percentiles: number[]): string {
  if (count === 0) return COLORS.empty;
  if (count <= percentiles[0]) return COLORS.level1;
  if (count <= percentiles[1]) return COLORS.level2;
  if (count <= percentiles[2]) return COLORS.level3;
  return COLORS.level4;
}

function calculatePercentiles(data: CommitData, year: number): number[] {
  const counts = Object.entries(data)
    .filter(([date]) => date.startsWith(year.toString()))
    .map(([, count]) => count)
    .filter(c => c > 0)
    .sort((a, b) => a - b);

  if (counts.length === 0) return [1, 5, 10, 20];

  const p25 = counts[Math.floor(counts.length * 0.25)] || 1;
  const p50 = counts[Math.floor(counts.length * 0.50)] || p25;
  const p75 = counts[Math.floor(counts.length * 0.75)] || p50;

  return [p25, p50, p75];
}

function generateSVG(year: number, data: CommitData): string {
  const percentiles = calculatePercentiles(data, year);

  // Calculate dimensions
  const leftPadding = 30;
  const topPadding = 20;
  const width = leftPadding + 53 * (CELL_SIZE + CELL_GAP) + 10;
  const height = topPadding + 7 * (CELL_SIZE + CELL_GAP) + 30;

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .month { font: 10px sans-serif; fill: #8b949e; }
    .day { font: 10px sans-serif; fill: #8b949e; }
    .title { font: bold 14px sans-serif; fill: #c9d1d9; }
    .legend { font: 10px sans-serif; fill: #8b949e; }
  </style>
  <rect width="100%" height="100%" fill="#0d1117"/>
`;

  // Day labels (Mon, Wed, Fri, Sun)
  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
  for (let i = 0; i < 7; i++) {
    if (dayLabels[i]) {
      const y = topPadding + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2;
      svg += `  <text x="0" y="${y}" class="day">${dayLabels[i]}</text>\n`;
    }
  }

  // Calculate total commits for this year
  let totalCommits = 0;
  for (const [date, count] of Object.entries(data)) {
    if (date.startsWith(year.toString())) {
      totalCommits += count;
    }
  }

  // Month labels
  const monthPositions: { [key: number]: number } = {};
  for (let week = 0; week < 53; week++) {
    const dateInWeek = new Date(year, 0, 1 + week * 7);
    if (dateInWeek.getFullYear() === year) {
      const month = dateInWeek.getMonth();
      if (!(month in monthPositions)) {
        monthPositions[month] = week;
      }
    }
  }
  for (const [monthStr, week] of Object.entries(monthPositions)) {
    const x = leftPadding + week * (CELL_SIZE + CELL_GAP);
    svg += `  <text x="${x}" y="${topPadding - 5}" class="month">${MONTHS[Number(monthStr)]}</text>\n`;
  }

  // Generate cells for each day
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().substring(0, 10);
    const count = data[dateStr] || 0;
    const color = getColorForCount(count, percentiles);

    const week = getWeekNumber(d);
    const dayOfWeek = getDayOfWeek(d);

    const x = leftPadding + week * (CELL_SIZE + CELL_GAP);
    const y = topPadding + dayOfWeek * (CELL_SIZE + CELL_GAP);

    svg += `  <rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${color}" rx="2">`;
    svg += `<title>${dateStr}: ${count} commits</title></rect>\n`;
  }

  // Title at bottom left
  const bottomY = height - 15;
  svg += `  <text x="${leftPadding}" y="${bottomY}" class="title">${year} - ${totalCommits.toLocaleString()} data updates</text>\n`;

  // Legend at bottom right
  const legendX = width - 150;
  svg += `  <text x="${legendX}" y="${bottomY}" class="legend">Less</text>\n`;
  const legendColors = [COLORS.empty, COLORS.level1, COLORS.level2, COLORS.level3, COLORS.level4];
  for (let i = 0; i < legendColors.length; i++) {
    svg += `  <rect x="${legendX + 30 + i * 14}" y="${bottomY - 10}" width="11" height="11" fill="${legendColors[i]}" rx="2"/>\n`;
  }
  svg += `  <text x="${legendX + 105}" y="${bottomY}" class="legend">More</text>\n`;

  svg += `</svg>`;
  return svg;
}

function generateReadme(years: number[]): string {
  let readme = `# Termoficare Bucuresti - Flat Data

Automated tracking of Bucharest district heating system status using [GitHub Flat Data](https://githubnext.com/projects/flat-data).

## Data Source

- **URL**: https://www.cmteb.ro/functionare_sistem_termoficare.php
- **Update frequency**: Every 15 minutes
- **Format**: Raw HTML

## Commit Activity

`;

  for (const year of years) {
    readme += `### ${year}\n![${year} Heatmap](images/heatmap-${year}.svg)\n\n`;
  }

  readme += `## View Data

Once this repository is made public, use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

This repository uses the [Flat GitHub Action](https://github.com/githubocto/flat) to periodically fetch the heating status page and commit any changes to this repository.
`;

  return readme;
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
