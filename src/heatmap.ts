// Heatmap generation: GitHub-style contribution heatmaps showing data commits per day.
// No I/O. Given commit counts keyed by date, produces year SVGs. Output depends on the
// ambient timezone (day-cell keys go through toISOString), so callers that need
// reproducible bytes must fix TZ — the Flat workflow and the tests both run under UTC.

const EMPTY_COLOR = "#161b22";

// Continuous gradient endpoints for non-zero counts, interpolated in RGB space.
// Intermediate stops keep the same hue progression as the original discrete scale.
const GRADIENT_STOPS: [number, number, number][] = [
  [0xfe, 0xf0, 0xd9], // lightest: lowest non-zero count in the year
  [0xfd, 0xcc, 0x8a],
  [0xfc, 0x8d, 0x59],
  [0xd7, 0x30, 0x1f], // red: highest count in the year
];

const CELL_SIZE = 11;
const CELL_GAP = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    svg += `  <text x="${x}" y="${topPadding - 5}" class="month">${
      MONTHS[Number(monthStr)]
    }</text>\n`;
  }

  // Generate cells for each day
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  for (const d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().substring(0, 10);
    const count = data[dateStr] || 0;
    const color = getColorForCount(count, range);

    const week = getWeekNumber(d);
    const dayOfWeek = getDayOfWeek(d);

    const x = leftPadding + week * (CELL_SIZE + CELL_GAP);
    const y = topPadding + dayOfWeek * (CELL_SIZE + CELL_GAP);

    svg +=
      `  <rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${color}" rx="2">`;
    svg += `<title>${dateStr}: ${count} commits</title></rect>\n`;
  }

  // Title at bottom left
  const bottomY = height - 15;
  svg +=
    `  <text x="${leftPadding}" y="${bottomY}" class="title">${year} - ${totalCommits.toLocaleString()} data updates</text>\n`;

  // Legend at bottom right: a black swatch for zero, then a continuous gradient bar
  const legendX = width - 150;
  const legendY = bottomY - 10;
  svg += `  <defs>
    <linearGradient id="legend-gradient" x1="0" y1="0" x2="1" y2="0">
${
    GRADIENT_STOPS.map((stop, i) => {
      const offset = (i / (GRADIENT_STOPS.length - 1)) * 100;
      return `      <stop offset="${offset}%" stop-color="#${toHex(stop[0])}${toHex(stop[1])}${
        toHex(stop[2])
      }"/>`;
    }).join("\n")
  }
    </linearGradient>
  </defs>\n`;
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
