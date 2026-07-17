// Heatmap generation: GitHub-style contribution heatmaps showing data commits per day.
// No I/O. Given commit counts keyed by date, produces year SVGs by configuring the generic
// year_grid renderer with a per-year min-max color scale. See year_grid.ts for the SVG
// markup and the ambient-TZ caveat (day-cell keys go through toISOString).

import { renderYearGrid } from "./year_grid.ts";
import {
  type CountRange,
  EMPTY_COLOR,
  getColorForCount,
  GRADIENT_STOP_HEXES,
} from "./color_scale.ts";

export interface CommitData {
  [date: string]: number;
}

export function getYearsFromData(data: CommitData): number[] {
  const years = new Set<number>();
  for (const date of Object.keys(data)) {
    years.add(parseInt(date.substring(0, 4)));
  }
  return Array.from(years).sort((a, b) => b - a);
}

function calculateRange(data: CommitData, year: number): CountRange {
  const counts = Object.entries(data)
    .filter(([date]) => date.startsWith(year.toString()))
    .map(([, count]) => count)
    .filter((c) => c > 0);

  if (counts.length === 0) return { min: 1, max: 1 };

  return { min: Math.min(...counts), max: Math.max(...counts) };
}

export function generateSVG(year: number, data: CommitData): string {
  const range = calculateRange(data, year);

  let totalCommits = 0;
  for (const [date, count] of Object.entries(data)) {
    if (date.startsWith(year.toString())) {
      totalCommits += count;
    }
  }

  return renderYearGrid(year, {
    value: (date) => data[date] || 0,
    color: (value) => getColorForCount(value ?? 0, range),
    tooltip: (date, value) => `${date}: ${value} commits`,
    title: `${year} - ${totalCommits.toLocaleString()} data updates`,
    legend: {
      zeroColor: EMPTY_COLOR,
      gradientStops: GRADIENT_STOP_HEXES,
    },
  });
}
