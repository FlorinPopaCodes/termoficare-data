// Continuous gradient color scale for count-per-day heatmaps. No I/O. Used by the
// episode heatmaps (episode_heatmap.ts) so that "equal color" always means the same
// thing across every year-grid this repo renders.

import chroma from "chroma-js";

export const EMPTY_COLOR = "#161b22";

// Same ColorBrewer OrRd-4 endpoints as before; interpolated in Lab space (via chroma-js)
// rather than raw RGB, so equal steps in count read as equal steps in perceived color
// instead of dimming through a muddy midpoint.
export const GRADIENT_STOP_HEXES: string[] = ["#fef0d9", "#fdcc8a", "#fc8d59", "#d7301f"];

const scale = chroma.scale(GRADIENT_STOP_HEXES).mode("lab");

export interface CountRange {
  min: number;
  max: number;
}

export function getColorForCount(count: number, range: CountRange): string {
  if (count === 0) return EMPTY_COLOR;
  if (range.max === range.min) return scale(1).hex();
  const t = (count - range.min) / (range.max - range.min);
  return scale(t).hex();
}
