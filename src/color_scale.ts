// Continuous gradient color scale for count-per-day heatmaps. No I/O. Shared by the
// commit heatmap (heatmap.ts) and the episode heatmaps (episode_heatmap.ts) so that
// "equal color" always means the same thing across every year-grid this repo renders.

export const EMPTY_COLOR = "#161b22";

// Continuous gradient endpoints for non-zero counts, interpolated in RGB space.
// Intermediate stops keep the same hue progression as the original discrete scale.
export const GRADIENT_STOPS: [number, number, number][] = [
  [0xfe, 0xf0, 0xd9], // lightest: lowest non-zero count in range
  [0xfd, 0xcc, 0x8a],
  [0xfc, 0x8d, 0x59],
  [0xd7, 0x30, 0x1f], // red: highest count in range
];

export function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, "0");
}

// The gradient stops rendered as "#rrggbb", for callers building a legend swatch bar.
export const GRADIENT_STOP_HEXES: string[] = GRADIENT_STOPS.map(
  ([r, g, b]) => `#${toHex(r)}${toHex(g)}${toHex(b)}`,
);

// Piecewise-linear interpolation across the gradient stops for a continuous
// (not bucketed) color range. t=0 -> first stop, t=1 -> last stop.
export function interpolateGradient(t: number): string {
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

export interface CountRange {
  min: number;
  max: number;
}

export function getColorForCount(count: number, range: CountRange): string {
  if (count === 0) return EMPTY_COLOR;
  if (range.max === range.min) return interpolateGradient(1);
  const t = (count - range.min) / (range.max - range.min);
  return interpolateGradient(t);
}
