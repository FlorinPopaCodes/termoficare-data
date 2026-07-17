// README generation. Pure module — no I/O. Given the years with commit-activity data and
// the raw basenames of images/, produces the repository README. Outage-map years/utilities
// are discovered by parsing imageFiles against EPISODE_FILE_RE; any other filename is ignored,
// so postprocess.ts never needs to know the episode filename convention or touch data/derived/.

const EPISODE_FILE_RE = /^episodes-(inc|acc)-(\d{4})\.svg$/;

const UTILITY_LABELS: Record<"inc" | "acc", string> = {
  inc: "heating",
  acc: "hot water",
};

// Year -> which utilities have a map, in inc-then-acc render order.
function outageMapsByYear(imageFiles: string[]): Map<number, ("inc" | "acc")[]> {
  const years = new Map<number, ("inc" | "acc")[]>();
  for (const file of imageFiles) {
    const match = EPISODE_FILE_RE.exec(file);
    if (!match) continue;
    const utility = match[1] as "inc" | "acc";
    const year = Number(match[2]);
    const utilities = years.get(year) ?? [];
    utilities.push(utility);
    years.set(year, utilities);
  }
  for (const utilities of years.values()) {
    utilities.sort((a, b) => (a === b ? 0 : a === "inc" ? -1 : 1));
  }
  return years;
}

export function generateReadme(commitYears: number[], imageFiles: string[]): string {
  let readme = `# Termoficare Bucuresti - Flat Data

[![Scrape health](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FFlorinPopaCodes%2Ftermoficare-data%2Fmain%2Fdata%2Fhealth.json)](https://github.com/FlorinPopaCodes/termoficare-data/issues?q=is%3Aissue+label%3Ascrape-health)

Automated tracking of Bucharest district heating system status using [GitHub Flat Data](https://githubnext.com/projects/flat-data).

## Outages

Two utilities are tracked: **heating** (INC) and **domestic hot water** (ACC). Each map covers one year of one utility. Every cell is one day, and its color shows how many outages were active that day: near-black means none were observed, and the yellow-to-red scale deepens as the count rises. The scale is shared across all years of a utility, so equal color means equal severity in any year. Grey cells are days with no usable data — the system's state that day is unknown, which is not the same as a day with zero outages.

`;

  const byYear = outageMapsByYear(imageFiles);
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    readme += `### ${year}\n\n`;
    for (const utility of byYear.get(year)!) {
      readme += `![${year} ${
        UTILITY_LABELS[utility]
      } outages](images/episodes-${utility}-${year}.svg)\n\n`;
    }
  }

  readme += `## Data Source

- **URL**: https://www.cmteb.ro/functionare_sistem_termoficare.php
- **Update frequency**: Every 15 minutes
- **Format**: Raw HTML

## Commit Activity

`;

  for (const year of commitYears) {
    readme += `### ${year}\n![${year} Heatmap](images/heatmap-${year}.svg)\n\n`;
  }

  readme += `## View Data

Once this repository is made public, use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

This repository uses the [Flat GitHub Action](https://github.com/githubocto/flat) to periodically fetch the heating status page and commit any changes to this repository.
`;

  return readme;
}
