// Heatmap generation: GitHub-style contribution heatmaps showing data commits per day.
// No I/O. Given commit counts keyed by date, produces year SVGs by configuring the generic
// year_grid renderer with a per-year min-max color scale. See year_grid.ts for the SVG
// markup and the ambient-TZ caveat (day-cell keys go through toISOString).

import { renderYearGrid } from "./year_grid.ts";

const EMPTY_COLOR = "#161b22";

// Continuous gradient endpoints for non-zero counts, interpolated in RGB space.
// Intermediate stops keep the same hue progression as the original discrete scale.
const GRADIENT_STOPS: [number, number, number][] = [
  [0xfe, 0xf0, 0xd9], // lightest: lowest non-zero count in the year
  [0xfd, 0xcc, 0x8a],
  [0xfc, 0x8d, 0x59],
  [0xd7, 0x30, 0x1f], // red: highest count in the year
];

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

function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, "0");
}

// Piecewise-linear interpolation across the gradient stops for a continuous
// (not bucketed) color range. t=0 -> first stop, t=1 -> last stop.
function interpolateGradient(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (GRADIENT_STOPS.length - 1);
  const index = Math.min(GRADIENT_STOPS.length - 2, Math.floor(scaled));
  const localT = scaled - index;
  const [r1, g1, b1] = GRADIENT_STOPS[index];
  const [r2, g2, b2] = GRADIENT_STOPS[index + 1];
  const r = r1 + (r2 - r1) * localT;
  const g = g1 + (g2 - g1) * localT;
  const b = b1 + (b2 - b1) * localT;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

interface CountRange {
  min: number;
  max: number;
}

function getColorForCount(count: number, range: CountRange): string {
  if (count === 0) return EMPTY_COLOR;
  if (range.max === range.min) return interpolateGradient(1);
  const t = (count - range.min) / (range.max - range.min);
  return interpolateGradient(t);
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
      gradientStops: GRADIENT_STOPS.map(([r, g, b]) => `#${toHex(r)}${toHex(g)}${toHex(b)}`),
    },
  });
}
