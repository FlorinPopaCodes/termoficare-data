// Reliability trend: monthly on-time rates from scored estimates, rendered as one
// all-history SVG line chart (one line per utility). No I/O -- like episode_heatmap.ts,
// the input interfaces are structurally identical to derive's output types on purpose:
// the two modules are opposite sides of the seam and deliberately don't import each other.

import { MIN_BASIS } from "./on_time.ts";

export const TREND_PATH = "images/on-time-trend.svg";

export interface EstimateScore {
  utility: string;
  posted_ts: string;
  hit: boolean;
}

// A claim whose outcome is still open: an estimate posted on a still-active episode.
export interface PendingEstimate {
  utility: string;
  posted_ts: string;
}

export interface TrendPoint {
  month: string;
  utility: string;
  rate: number;
  n: number;
  provisional: boolean;
}

// Monthly on-time rate per utility, attributed to the estimate's posting month, in
// (month, utility) order. A point is provisional while any estimate posted in its month
// is still pending -- the rate can move as those outcomes land.
export function monthlyTrend(scores: EstimateScore[], pending: PendingEstimate[]): TrendPoint[] {
  const buckets = new Map<string, { hits: number; n: number }>();
  for (const score of scores) {
    const key = `${score.posted_ts.slice(0, 7)} ${score.utility}`;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { hits: 0, n: 0 };
      buckets.set(key, bucket);
    }
    bucket.n++;
    if (score.hit) bucket.hits++;
  }

  const pendingKeys = new Set(pending.map((p) => `${p.posted_ts.slice(0, 7)} ${p.utility}`));

  return [...buckets.entries()]
    .filter(([, { n }]) => n >= MIN_BASIS)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { hits, n }]) => {
      const [month, utility] = key.split(" ");
      return { month, utility, rate: hits / n, n, provisional: pendingKeys.has(key) };
    });
}

// --- SVG rendering ---

// GitHub-dark chrome, same surface and ink as year_grid.ts so the README images read as
// one family. Series hues validated for CVD separation and 3:1 contrast on this surface.
const SURFACE = "#0d1117";
const GRID_COLOR = "#21262d";
const BASELINE_COLOR = "#30363d";
const SERIES: { utility: string; noun: string; color: string }[] = [
  { utility: "INC", noun: "heating", color: "#d95926" },
  { utility: "ACC", noun: "hot water", color: "#3987e5" },
];

const WIDTH = 782; // match the year grids so the README column lines up
const LEFT = 40;
const PLOT_W = WIDTH - LEFT - 60; // right margin holds the direct series labels
const TOP = 30;
const PLOT_H = 150;
const BOTTOM = TOP + PLOT_H;
const HEIGHT = BOTTOM + 40;

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

interface PlacedPoint extends TrendPoint {
  x: number;
  y: number;
}

function marker(p: PlacedPoint, color: string, noun: string): string {
  const pct = Math.round(p.rate * 100);
  const title = `<title>${p.month}: ${noun} ${pct}% on time (${p.n} estimates${
    p.provisional ? ", provisional" : ""
  })</title>`;
  const pos = `cx="${p.x}" cy="${p.y}" r="4"`;
  // Provisional points are hollow; settled points wear a surface ring so overlapping
  // series stay separable.
  if (p.provisional) {
    return `  <circle ${pos} fill="${SURFACE}" stroke-width="2" stroke="${color}">${title}</circle>\n`;
  }
  return `  <circle ${pos} stroke="${SURFACE}" stroke-width="1.5" fill="${color}">${title}</circle>\n`;
}

// The trend SVG, or null when no month clears MIN_BASIS.
export function renderOnTimeTrend(
  scores: EstimateScore[],
  pending: PendingEstimate[],
): string | null {
  const points = monthlyTrend(scores, pending);
  if (points.length === 0) return null;

  const indices = points.map((p) => monthIndex(p.month));
  const minIdx = Math.min(...indices);
  const maxIdx = Math.max(...indices);
  const span = maxIdx - minIdx;
  const x = (idx: number) =>
    Number((span === 0 ? LEFT + PLOT_W / 2 : LEFT + ((idx - minIdx) / span) * PLOT_W).toFixed(1));
  const y = (rate: number) => Number((BOTTOM - rate * PLOT_H).toFixed(1));

  let svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .axis { font: 10px sans-serif; fill: #8b949e; }
    .label { font: 10px sans-serif; fill: #c9d1d9; paint-order: stroke; stroke: ${SURFACE}; stroke-width: 3px; }
    .title { font: bold 14px sans-serif; fill: #c9d1d9; }
  </style>
  <rect width="100%" height="100%" fill="${SURFACE}"/>
`;

  // Y gridlines and percent labels
  for (const pct of [0, 25, 50, 75, 100]) {
    const gy = y(pct / 100);
    const color = pct === 0 ? BASELINE_COLOR : GRID_COLOR;
    svg += `  <line x1="${LEFT}" y1="${gy}" x2="${LEFT + PLOT_W}" y2="${gy}" stroke="${color}"/>\n`;
    svg += `  <text x="${LEFT - 6}" y="${gy + 3}" text-anchor="end" class="axis">${pct}%</text>\n`;
  }

  // X labels: each January's year; the first month's year too when no January is near it
  const labelIdx: number[] = [];
  for (let idx = minIdx; idx <= maxIdx; idx++) {
    if (idx % 12 === 0) labelIdx.push(idx);
  }
  if (labelIdx.length === 0 || labelIdx[0] - minIdx > 2) labelIdx.unshift(minIdx);
  for (const idx of labelIdx) {
    svg += `  <text x="${x(idx)}" y="${BOTTOM + 14}" text-anchor="middle" class="axis">${
      Math.floor(idx / 12)
    }</text>\n`;
  }

  const placed = new Map<string, PlacedPoint[]>();
  for (const series of SERIES) {
    placed.set(
      series.utility,
      points
        .filter((p) => p.utility === series.utility)
        .map((p) => ({ ...p, x: x(monthIndex(p.month)), y: y(p.rate) })),
    );
  }

  // Lines first, then markers on top; a month gap breaks the line into separate runs
  for (const series of SERIES) {
    const runs: PlacedPoint[][] = [];
    let run: PlacedPoint[] = [];
    for (const p of placed.get(series.utility)!) {
      if (run.length > 0 && monthIndex(p.month) !== monthIndex(run[run.length - 1].month) + 1) {
        runs.push(run);
        run = [];
      }
      run.push(p);
    }
    runs.push(run);
    for (const r of runs) {
      if (r.length < 2) continue;
      const pts = r.map((p) => `${p.x},${p.y}`).join(" ");
      svg +=
        `  <polyline points="${pts}" fill="none" stroke-width="2" stroke="${series.color}"/>\n`;
    }
  }
  for (const series of SERIES) {
    for (const p of placed.get(series.utility)!) svg += marker(p, series.color, series.noun);
  }

  // Direct labels live in the right margin, so only series whose line reaches the final
  // month get one -- a label at a mid-chart line end (INC in summer) sits inside the other
  // series' path and reads as naming it. The legend and tooltips carry the rest.
  const ends = SERIES.map((series) => {
    const pts = placed.get(series.utility)!;
    const end = pts[pts.length - 1];
    return end !== undefined && monthIndex(end.month) === maxIdx ? { ...end } : null;
  });
  const [incEnd, accEnd] = ends;
  if (incEnd && accEnd && Math.abs(incEnd.y - accEnd.y) < 12) {
    if (incEnd.y <= accEnd.y) accEnd.y = incEnd.y + 12;
    else incEnd.y = accEnd.y + 12;
  }
  for (const end of ends) {
    if (end) {
      svg += `  <text x="${end.x + 9}" y="${end.y + 3}" class="label">${end.utility}</text>\n`;
    }
  }

  // Legend, top-right
  const legendItems = SERIES.map((s) => ({ label: `${s.noun} (${s.utility})`, color: s.color }));
  let lx = WIDTH - 340;
  for (const item of legendItems) {
    svg += `  <rect x="${lx}" y="8" width="10" height="10" rx="2" fill="${item.color}"/>\n`;
    svg += `  <text x="${lx + 14}" y="16" class="axis">${item.label}</text>\n`;
    lx += 100;
  }
  svg += `  <circle cx="${
    lx + 5
  }" cy="13" r="4" fill="${SURFACE}" stroke-width="2" stroke="#8b949e"/>\n`;
  svg += `  <text x="${lx + 14}" y="16" class="axis">provisional</text>\n`;

  svg += `  <text x="${LEFT}" y="${HEIGHT - 8}" class="title">` +
    `Share of posted restore estimates met on time</text>\n`;

  svg += `</svg>`;
  return svg;
}
