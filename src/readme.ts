// README generation. Pure module — no I/O. Given the raw basenames of images/, produces
// the repository README. Outage-map years/utilities are discovered by parsing imageFiles
// against EPISODE_FILE_RE; any other filename is ignored, so postprocess.ts never needs
// to know the episode filename convention or touch data/derived/.

import { MIN_BASIS } from "./on_time.ts";
import { DURATION_MIN_BASIS } from "./duration_trend.ts";

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

export function generateReadme(imageFiles: string[]): string {
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

  if (imageFiles.includes("on-time-trend.svg")) {
    readme += `## Estimate reliability

CMTEB posts a restoration estimate for most outages. Each point is the share of the estimates posted that month that were met — restoration observed at or before the estimated time, with no grace period. Hollow points are provisional: some of that month's outages are still running, so the value can move as they resolve (it usually reads high at first, because quickly-fixed outages settle their scores soonest). Months with fewer than ${MIN_BASIS} scored estimates are not drawn.

![On-time trend](images/on-time-trend.svg)

`;
  }

  if (imageFiles.includes("duration-trend.svg")) {
    readme += `## Outage duration

How long outages last, month by month: the median (p50), p90 and p99 of the durations of outages that began that month, from first sighting to observed restoration. The time scale is logarithmic — typical outages resolve in hours, the worst run for weeks. Hollow points are provisional: some of that month's outages are still running, and the percentiles can still move as those resolve — the still-running outages tend to be the long ones, so the tail is usually understated at first. Months with fewer than ${DURATION_MIN_BASIS} closed outages for a utility are not drawn, which is why the heating panel goes quiet each summer.

![Duration trend](images/duration-trend.svg)

`;
  }

  readme += `## Data Source

- **URL**: https://www.cmteb.ro/functionare_sistem_termoficare.php
- **Update frequency**: Every 15 minutes
- **Format**: Raw HTML

## View Data

Use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

This repository uses the [Flat GitHub Action](https://github.com/githubocto/flat) to periodically fetch the heating status page and commit any changes to this repository.
`;

  return readme;
}
