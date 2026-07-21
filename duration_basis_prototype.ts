// PROTOTYPE — THROWAWAY. Answered one question (issue #48): should the monthly
// duration-percentile chart use (1) a single whole-point basis n>=100, or (2)
// per-percentile thresholds (p50 n>=20, p90 n>=50, p99 n>=100)?
//
// Verdict: option 1. ACC clears n>=100 every month, so the panels are identical;
// for INC, per-percentile thresholds only added isolated p50 dots in off-season
// shoulder months (2022-09 n=23, 2024-04 n=30) that read as glitches, plus one odd
// one-month spike (2022-10 n=90). Whole-point keeps clean seasonal blocks.
//
// Run from the repo root:
//   TZ=UTC deno run --config deno.json --allow-read --allow-write duration_basis_prototype.ts
// Writes duration_basis_prototype.html next to this file. Wipe both when done.

import { deriveDatasets, foundationSnapshots, type MonthContent } from "./src/derive.ts";
import { monthPath, OBSERVATIONS_DIR, parseRows, SNAPSHOTS_DIR } from "./src/csv.ts";

const OUT = "duration_basis_prototype.html";

// --- load real episode durations -------------------------------------------

function monthsToProcess(): string[] {
  const months: string[] = [];
  for (const entry of Deno.readDirSync(SNAPSHOTS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".csv")) months.push(entry.name.slice(0, -4));
  }
  months.sort();
  return months;
}
function* readMonths(months: string[]): Generator<MonthContent> {
  for (const month of months) {
    yield {
      month,
      log: Deno.readTextFileSync(monthPath(SNAPSHOTS_DIR, month)),
      observations: Deno.readTextFileSync(monthPath(OBSERVATIONS_DIR, month)),
    };
  }
}

const derived = await deriveDatasets(foundationSnapshots(readMonths(monthsToProcess())));

// (utility, month begun) -> sorted closed-episode durations in hours
const durations = new Map<string, number[]>();
for (const [path, content] of derived.files) {
  if (!/episodes\/\d{4}-\d{2}\.csv$/.test(path)) continue;
  for (const row of parseRows(content).slice(1)) {
    const [, , , utility, first_seen, , first_absent] = row;
    if (first_absent === "") continue; // open episode: no duration yet
    const key = `${utility} ${first_seen.slice(0, 7)}`;
    let list = durations.get(key);
    if (!list) durations.set(key, list = []);
    list.push((Date.parse(`${first_absent}Z`) - Date.parse(`${first_seen}Z`)) / 3600e3);
  }
}
for (const list of durations.values()) list.sort((a, b) => a - b);

function nearestRank(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

// --- chart geometry (mimics the on_time_trend.ts family) ---------------------

const SURFACE = "#0d1117";
const GRID = "#21262d";
const WIDTH = 782;
const LEFT = 46;
const PLOT_W = WIDTH - LEFT - 60;
const PANEL_H = 130;
const PANEL_GAP = 46;

const PCTS = [
  { p: 99, minN: 100 },
  { p: 90, minN: 50 },
  { p: 50, minN: 20 },
];
const PANELS = [
  { utility: "INC", noun: "heating", tints: { 50: "#d95926", 90: "#e8875c", 99: "#f2b491" } },
  { utility: "ACC", noun: "hot water", tints: { 50: "#3987e5", 90: "#6fa6ec", 99: "#a6c8f3" } },
];

const LOG_MIN = 3, LOG_MAX = 1200; // hours
const TICKS = [
  { h: 6, label: "6h" },
  { h: 24, label: "1d" },
  { h: 72, label: "3d" },
  { h: 168, label: "1w" },
  { h: 720, label: "30d" },
];

const allMonths = [...new Set([...durations.keys()].map((k) => k.split(" ")[1]))].sort();
const monthIdx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const minIdx = monthIdx(allMonths[0]);
const maxIdx = monthIdx(allMonths[allMonths.length - 1]);
const x = (m: string) => LEFT + ((monthIdx(m) - minIdx) / (maxIdx - minIdx)) * PLOT_W;

function renderVariant(perPercentile: boolean): string {
  const height = PANELS.length * (PANEL_H + PANEL_GAP) + 30;
  let svg = `<svg width="${WIDTH}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .axis { font: 10px sans-serif; fill: #8b949e; }
    .label { font: 10px sans-serif; paint-order: stroke; stroke: ${SURFACE}; stroke-width: 3px; }
    .panel { font: bold 12px sans-serif; fill: #c9d1d9; }
  </style>
  <rect width="100%" height="100%" fill="${SURFACE}"/>\n`;

  PANELS.forEach((panel, pi) => {
    const top = 24 + pi * (PANEL_H + PANEL_GAP);
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
      const gy = y(tick.h);
      svg += `  <line x1="${LEFT}" y1="${gy}" x2="${LEFT + PLOT_W}" y2="${gy}" stroke="${GRID}"/>\n`;
      svg += `  <text x="${LEFT - 6}" y="${
        gy + 3
      }" text-anchor="end" class="axis">${tick.label}</text>\n`;
    }
    for (let idx = minIdx; idx <= maxIdx; idx++) {
      if (idx % 12 === 0) {
        const gx = LEFT + ((idx - minIdx) / (maxIdx - minIdx)) * PLOT_W;
        svg += `  <text x="${gx}" y="${bottom + 14}" text-anchor="middle" class="axis">${
          Math.floor(idx / 12)
        }</text>\n`;
      }
    }

    for (const { p, minN } of PCTS) {
      const threshold = perPercentile ? minN : 100;
      const pts: { m: string; px: number; py: number; n: number; v: number }[] = [];
      for (const m of allMonths) {
        const list = durations.get(`${panel.utility} ${m}`);
        if (!list || list.length < threshold) continue;
        const v = nearestRank(list, p);
        pts.push({ m, px: Number(x(m).toFixed(1)), py: y(v), n: list.length, v });
      }
      const color = panel.tints[p as 50 | 90 | 99];
      const runs: typeof pts[] = [];
      let run: typeof pts = [];
      for (const pt of pts) {
        if (run.length > 0 && monthIdx(pt.m) !== monthIdx(run[run.length - 1].m) + 1) {
          runs.push(run);
          run = [];
        }
        run.push(pt);
      }
      runs.push(run);
      for (const r of runs) {
        if (r.length < 2) continue;
        svg += `  <polyline points="${
          r.map((pt) => `${pt.px},${pt.py}`).join(" ")
        }" fill="none" stroke-width="${p === 50 ? 2 : 1.5}" stroke="${color}"/>\n`;
      }
      for (const pt of pts) {
        svg += `  <circle cx="${pt.px}" cy="${pt.py}" r="2.5" fill="${color}">` +
          `<title>${pt.m}: ${panel.noun} p${p} ${pt.v.toFixed(0)}h (${pt.n} episodes)</title></circle>\n`;
      }
      const end = pts[pts.length - 1];
      if (end) {
        svg +=
          `  <text x="${end.px + 8}" y="${end.py + 3}" class="label" fill="${color}">p${p}</text>\n`;
      }
    }
  });
  svg += `</svg>`;
  return svg;
}

// --- page --------------------------------------------------------------------

const html = `<!doctype html>
<meta charset="utf-8">
<title>Duration basis prototype</title>
<body style="background:#010409;color:#c9d1d9;font:14px sans-serif;margin:24px">
<h2 style="margin:0 0 4px">PROTOTYPE — basis rule for monthly duration percentiles</h2>
<p style="color:#8b949e;max-width:70ch">Real data, closed episodes only, month = month begun,
log scale. The question: how does the <b>heating (INC)</b> panel read around its off-season
edges (Apr &amp; Sep&ndash;Oct shoulders, e.g. 2022-09 n=23, 2022-10 n=90, 2024-04 n=30)?</p>
<h3>Variant 1 — whole-point basis: month shows all three percentiles or nothing (n ≥ 100)</h3>
${renderVariant(false)}
<h3>Variant 2 — per-percentile basis: p50 at n ≥ 20, p90 at n ≥ 50, p99 at n ≥ 100</h3>
${renderVariant(true)}
</body>`;

Deno.writeTextFileSync(OUT, html);
console.log(`wrote ${OUT}`);
