// Episode-outage heatmaps: GitHub-style year grids where each day-cell shows how many
// episodes of one utility (INC or ACC) were active at any point that day. No I/O --
// mirrors heatmap.ts's role as a thin config of the generic year_grid renderer, but the
// color scale is global across all years per utility (not per-year like the commit map),
// so equal color means equal badness whichever year you're looking at.

import { renderYearGrid } from "./year_grid.ts";
import {
  type CountRange,
  EMPTY_COLOR,
  getColorForCount,
  GRADIENT_STOP_HEXES,
} from "./color_scale.ts";

export const IMAGES_DIR = "images";

// Neutral grey, distinct from EMPTY_COLOR's near-black -- "we don't know" must not read as
// "we know it was zero."
const BLIND_COLOR = "#484f58";

const UTILITIES = ["INC", "ACC"] as const;

const UTILITY_NOUN: Record<string, string> = {
  INC: "heating",
  ACC: "hot water",
};

// Structurally identical to derive.ts's own EpisodeSpan on purpose -- the two modules are
// opposite sides of the seam and deliberately don't import each other.
export interface EpisodeSpan {
  utility: string;
  first_seen_ts: string;
  last_seen_ts: string;
}

// One count per day an episode of this utility was active, summed across every episode's
// [first-seen date, last-seen date] range inclusive. The ts strings are naive Bucharest
// wall-clock, so slicing them already yields the Bucharest-local calendar day; the UTC
// anchoring below is just ambient-TZ-proof arithmetic for stepping those date strings.
function dailyCounts(episodes: EpisodeSpan[], utility: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const episode of episodes) {
    if (episode.utility !== utility) continue;
    const start = Date.parse(`${episode.first_seen_ts.slice(0, 10)}T00:00:00Z`);
    const end = Date.parse(`${episode.last_seen_ts.slice(0, 10)}T00:00:00Z`);
    for (let t = start; t <= end; t += 86400000) {
      const date = new Date(t).toISOString().slice(0, 10);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  }
  return counts;
}

// Global per utility, not per year like the commit heatmap: equal color must mean equal
// badness across every year this utility's cells appear in.
function utilityRange(counts: Map<string, number>): CountRange {
  const nonZero = [...counts.values()].filter((c) => c > 0);
  if (nonZero.length === 0) return { min: 1, max: 1 };
  return { min: Math.min(...nonZero), max: Math.max(...nonZero) };
}

// What the title reports: how many of this utility's episodes touch the year at all,
// distinct from the day-cell counts (a single long episode counts once here, once per day
// there).
function episodesInYear(episodes: EpisodeSpan[], utility: string, year: number): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return episodes.filter((e) =>
    e.utility === utility &&
    e.first_seen_ts.slice(0, 10) <= yearEnd &&
    e.last_seen_ts.slice(0, 10) >= yearStart
  ).length;
}

export function renderEpisodeHeatmaps(
  episodes: EpisodeSpan[],
  usableDays: Set<string>,
): Map<string, string> {
  const svgs = new Map<string, string>();
  if (usableDays.size === 0) return svgs;

  const years = [...usableDays].map((d) => Number(d.slice(0, 4)));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  for (const utility of UTILITIES) {
    const counts = dailyCounts(episodes, utility);
    const range = utilityRange(counts);

    for (let year = minYear; year <= maxYear; year++) {
      const svg = renderYearGrid(year, {
        value: (date) => {
          const count = counts.get(date) ?? 0;
          // A nonzero count wins over blindness: an episode spanning a blind day is still
          // known-active. Grey only ever replaces a would-be zero.
          if (count > 0) return count;
          return usableDays.has(date) ? 0 : null;
        },
        color: (value) => value === null ? BLIND_COLOR : getColorForCount(value, range),
        tooltip: (date, value) => {
          if (value === null) return `${date}: no data`;
          return `${date}: ${value} active episode${value === 1 ? "" : "s"}`;
        },
        title: `${year} - ${episodesInYear(episodes, utility, year)} ${
          UTILITY_NOUN[utility]
        } episodes`,
        legend: {
          zeroColor: EMPTY_COLOR,
          gradientStops: GRADIENT_STOP_HEXES,
          noData: { color: BLIND_COLOR, label: "No data" },
        },
      });
      svgs.set(`${IMAGES_DIR}/episodes-${utility.toLowerCase()}-${year}.svg`, svg);
    }
  }

  return svgs;
}
