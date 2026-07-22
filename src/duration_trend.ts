// Duration trend: monthly p50/p90/p99 of episode durations from closed episodes,
// rendered as one all-history SVG (one panel per utility). No I/O -- like
// on_time_trend.ts, the input interface is structurally compatible with derive's
// output type on purpose: the two modules are opposite sides of the seam and
// deliberately don't import each other.

export const DURATION_TREND_PATH = "images/duration-trend.svg";

// A month+utility needs this many closed episodes to draw a point -- sized for p99
// (nearest-rank p99 over fewer than 100 samples is just the single worst episode),
// deliberately separate from on_time.ts's MIN_BASIS, which is sized for a rate.
export const DURATION_MIN_BASIS = 100;

export interface EpisodeDuration {
  utility: string;
  first_seen_ts: string;
  first_absent_ts: string | null; // null = still open (no duration yet)
}

export interface DurationPoint {
  month: string;
  utility: string;
  p50: number; // hours
  p90: number;
  p99: number;
  n: number;
  provisional: boolean;
}

export function monthlyDurations(episodes: EpisodeDuration[]): DurationPoint[] {
  const buckets = new Map<string, number[]>();
  const openKeys = new Set<string>();
  for (const episode of episodes) {
    const key = `${episode.first_seen_ts.slice(0, 7)} ${episode.utility}`;
    if (episode.first_absent_ts === null) {
      openKeys.add(key);
      continue;
    }
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(
      (Date.parse(`${episode.first_absent_ts}Z`) - Date.parse(`${episode.first_seen_ts}Z`)) /
        3600e3,
    );
  }

  return [...buckets.entries()]
    .filter(([, durations]) => durations.length >= DURATION_MIN_BASIS)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, durations]) => {
      const [month, utility] = key.split(" ");
      durations.sort((a, b) => a - b);
      const rank = (p: number) => durations[Math.ceil((p / 100) * durations.length) - 1];
      return {
        month,
        utility,
        p50: rank(50),
        p90: rank(90),
        p99: rank(99),
        n: durations.length,
        provisional: openKeys.has(key),
      };
    });
}

// --- SVG rendering ---

// GitHub-dark chrome, same surface and ink as on_time_trend.ts so the README images read
// as one family. One hue per utility (the family's series colors), lighter tints for
// higher percentiles: the three lines never cross (p50 <= p90 <= p99), so vertical order
// plus direct labels carry identity even with close tints.
const SURFACE = "#0d1117";
const GRID_COLOR = "#21262d";
const PERCENTILES = [99, 90, 50] as const;
type Percentile = (typeof PERCENTILES)[number];
const PANELS: { utility: string; noun: string; tints: Record<Percentile, string> }[] = [
  { utility: "INC", noun: "heating", tints: { 50: "#d95926", 90: "#e8875c", 99: "#f2b491" } },
  { utility: "ACC", noun: "hot water", tints: { 50: "#3987e5", 90: "#6fa6ec", 99: "#a6c8f3" } },
];

const WIDTH = 782; // match the year grids so the README column lines up
const LEFT = 46;
const PLOT_W = WIDTH - LEFT - 60; // right margin holds the direct percentile labels
const PANEL_H = 130;
const PANEL_GAP = 46; // room for a panel's x labels plus the next panel's title

// Fixed log domain in hours: comfortably below the shortest monthly p50 and above the
// worst monthly p99 seen in history, so the chart doesn't rescale as months land.
const LOG_MIN = 3;
const LOG_MAX = 1200;
const TICKS: { hours: number; label: string }[] = [
  { hours: 6, label: "6h" },
  { hours: 24, label: "1d" },
  { hours: 72, label: "3d" },
  { hours: 168, label: "1w" },
  { hours: 720, label: "30d" },
];

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

interface PlacedPoint {
  month: string;
  x: number;
  y: number;
  hours: number;
  n: number;
  provisional: boolean;
}

function marker(p: PlacedPoint, color: string, noun: string, pct: Percentile): string {
  const title = `<title>${p.month}: ${noun} p${pct} ${Math.round(p.hours)}h (${p.n} episodes${
    p.provisional ? ", provisional" : ""
  })</title>`;
  const pos = `cx="${p.x}" cy="${p.y}" r="3"`;
  // Provisional points are hollow, matching the on-time trend's grammar.
  if (p.provisional) {
    return `  <circle ${pos} fill="${SURFACE}" stroke-width="2" stroke="${color}">${title}</circle>\n`;
  }
  return `  <circle ${pos} stroke="${SURFACE}" stroke-width="1.5" fill="${color}">${title}</circle>\n`;
}

// The duration trend SVG, or null when no month clears DURATION_MIN_BASIS.
export function renderDurationTrend(episodes: EpisodeDuration[]): string | null {
  const points = monthlyDurations(episodes);
  if (points.length === 0) return null;

  const indices = points.map((p) => monthIndex(p.month));
  const minIdx = Math.min(...indices);
  const maxIdx = Math.max(...indices);
  const span = maxIdx - minIdx;
  const x = (idx: number) =>
    Number((span === 0 ? LEFT + PLOT_W / 2 : LEFT + ((idx - minIdx) / span) * PLOT_W).toFixed(1));

  const height = PANELS.length * (PANEL_H + PANEL_GAP) + 40;
  let svg = `<svg width="${WIDTH}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .axis { font: 10px sans-serif; fill: #8b949e; }
    .label { font: 10px sans-serif; paint-order: stroke; stroke: ${SURFACE}; stroke-width: 3px; }
    .panel { font: bold 12px sans-serif; fill: #c9d1d9; }
    .title { font: bold 14px sans-serif; fill: #c9d1d9; }
  </style>
  <rect width="100%" height="100%" fill="${SURFACE}"/>
`;

  PANELS.forEach((panel, panelIdx) => {
    const top = 24 + panelIdx * (PANEL_H + PANEL_GAP);
    const bottom = top + PANEL_H;
    const y = (hours: number) => {
      const clamped = Math.min(Math.max(hours, LOG_MIN), LOG_MAX);
      const t = (Math.log(clamped) - Math.log(LOG_MIN)) / (Math.log(LOG_MAX) - Math.log(LOG_MIN));
      return Number((bottom - t * PANEL_H).toFixed(1));
    };

    svg += `  <text x="${LEFT}" y="${
      top - 8
    }" class="panel">${panel.noun} (${panel.utility})</text>\n`;
    for (const tick of TICKS) {
      const gy = y(tick.hours);
      svg += `  <line x1="${LEFT}" y1="${gy}" x2="${
        LEFT + PLOT_W
      }" y2="${gy}" stroke="${GRID_COLOR}"/>\n`;
      svg += `  <text x="${LEFT - 6}" y="${
        gy + 3
      }" text-anchor="end" class="axis">${tick.label}</text>\n`;
    }

    // X labels: each January's year; the first month's year too when no January is near it
    const labelIdx: number[] = [];
    for (let idx = minIdx; idx <= maxIdx; idx++) {
      if (idx % 12 === 0) labelIdx.push(idx);
    }
    if (labelIdx.length === 0 || labelIdx[0] - minIdx > 2) labelIdx.unshift(minIdx);
    for (const idx of labelIdx) {
      svg += `  <text x="${x(idx)}" y="${bottom + 14}" text-anchor="middle" class="axis">${
        Math.floor(idx / 12)
      }</text>\n`;
    }

    const panelPoints = points.filter((p) => p.utility === panel.utility);
    const labelEnds: { pct: Percentile; x: number; y: number }[] = [];
    for (const pct of PERCENTILES) {
      const placed: PlacedPoint[] = panelPoints.map((p) => ({
        month: p.month,
        x: x(monthIndex(p.month)),
        y: y(p[`p${pct}`]),
        hours: p[`p${pct}`],
        n: p.n,
        provisional: p.provisional,
      }));
      const color = panel.tints[pct];

      // Lines first, then markers on top; a month gap breaks the line into separate runs
      const runs: PlacedPoint[][] = [];
      let run: PlacedPoint[] = [];
      for (const p of placed) {
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
        svg += `  <polyline points="${pts}" fill="none" stroke-width="${
          pct === 50 ? 2 : 1.5
        }" stroke="${color}"/>\n`;
      }
      for (const p of placed) svg += marker(p, color, panel.noun, pct);

      const end = placed[placed.length - 1];
      if (end !== undefined) labelEnds.push({ pct, x: end.x, y: end.y });
    }

    // Direct label at each line's end; panels are per-utility, so a mid-chart line end
    // (INC's seasonal stop) can't collide with another series' path. Close line ends
    // (p90/p99 in a mild month) would overprint, so nudge labels 11px apart, top-down.
    labelEnds.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labelEnds.length; i++) {
      if (labelEnds[i].y < labelEnds[i - 1].y + 11) labelEnds[i].y = labelEnds[i - 1].y + 11;
    }
    for (const end of labelEnds) {
      svg += `  <text x="${end.x + 8}" y="${end.y + 3}" class="label" fill="${
        panel.tints[end.pct]
      }">p${end.pct}</text>\n`;
    }
  });

  // Legend, top-right: only the provisional grammar needs explaining
  svg += `  <circle cx="${
    WIDTH - 130
  }" cy="13" r="3" fill="${SURFACE}" stroke-width="2" stroke="#8b949e"/>\n`;
  svg += `  <text x="${WIDTH - 121}" y="16" class="axis">provisional</text>\n`;

  svg += `  <text x="${LEFT}" y="${height - 8}" class="title">` +
    `How long outages last: median, p90 and p99 by month begun</text>\n`;

  svg += `</svg>`;
  return svg;
}
