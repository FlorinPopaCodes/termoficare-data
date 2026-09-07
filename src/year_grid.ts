// Episode year-grid SVG renderer. No I/O. Counts and the utility's global color range
// come from episode_heatmap.ts. Output depends on the ambient
// timezone (day-cell keys go through toISOString), so callers that need reproducible bytes
// must fix TZ -- the Flat workflow and the tests both run under UTC.

import {
  type CountRange,
  EMPTY_COLOR,
  getColorForCount,
  GRADIENT_STOP_HEXES,
} from "./color_scale.ts";

// Unknown days must not read as days with an observed zero.
const BLIND_COLOR = "#484f58";
const CELL_SIZE = 11;
const CELL_GAP = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

export function renderYearGrid(
  year: number,
  counts: Map<string, number>,
  usableDays: Set<string>,
  range: CountRange,
  title: string,
): string {
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
    svg += `  <text x="${x}" y="${topPadding - 5}" class="month">${
      MONTHS[Number(monthStr)]
    }</text>\n`;
  }

  // Generate cells for each day
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  for (const d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().substring(0, 10);
    const count = counts.get(dateStr) ?? 0;
    // An episode spanning a blind day is known-active; only a would-be zero turns grey.
    const value = count > 0 ? count : usableDays.has(dateStr) ? 0 : null;
    const color = value === null ? BLIND_COLOR : getColorForCount(value, range);
    const tooltip = value === null
      ? `${dateStr}: no data`
      : `${dateStr}: ${value} active episode${value === 1 ? "" : "s"}`;

    const week = getWeekNumber(d);
    const dayOfWeek = getDayOfWeek(d);

    const x = leftPadding + week * (CELL_SIZE + CELL_GAP);
    const y = topPadding + dayOfWeek * (CELL_SIZE + CELL_GAP);

    svg +=
      `  <rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${color}" rx="2">`;
    svg += `<title>${tooltip}</title></rect>\n`;
  }

  // Title at bottom left
  const bottomY = height - 15;
  svg += `  <text x="${leftPadding}" y="${bottomY}" class="title">${title}</text>\n`;

  // Legend at bottom right: a swatch for zero, then a continuous gradient bar
  const legendX = width - 150;
  const legendY = bottomY - 10;
  const stops = GRADIENT_STOP_HEXES;
  svg += `  <defs>
    <linearGradient id="legend-gradient" x1="0" y1="0" x2="1" y2="0">
${
    stops.map((stop, i) => {
      const offset = (i / (stops.length - 1)) * 100;
      return `      <stop offset="${offset}%" stop-color="${stop}"/>`;
    }).join("\n")
  }
    </linearGradient>
  </defs>\n`;
  svg += `  <text x="${legendX - 72}" y="${bottomY}" class="legend">No data</text>\n`;
  svg += `  <rect x="${
    legendX - 30
  }" y="${legendY}" width="11" height="11" fill="${BLIND_COLOR}" rx="2"/>\n`;
  svg += `  <text x="${legendX}" y="${bottomY}" class="legend">Less</text>\n`;
  svg += `  <rect x="${
    legendX + 30
  }" y="${legendY}" width="11" height="11" fill="${EMPTY_COLOR}" rx="2"/>\n`;
  svg += `  <rect x="${
    legendX + 44
  }" y="${legendY}" width="53" height="11" fill="url(#legend-gradient)" rx="2"/>\n`;
  svg += `  <text x="${legendX + 105}" y="${bottomY}" class="legend">More</text>\n`;

  svg += `</svg>`;
  return svg;
}
