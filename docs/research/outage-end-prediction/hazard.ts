// A discrete-time hazard table and the conditional quantiles read off it. Pure:
// observations in, table out; table plus a starting point out, predicted quantiles out.
// The estimator is Kaplan-Meier on a coarse grid, which is what makes censored
// observations -- outages still out when the table was fitted -- carry their exposure
// instead of being dropped.
//
// The grid axis is a parameter because two different questions are asked of the same
// machinery: how long an outage runs (axis in hours since first sighting) and how far
// past CMTEB's own deadline it runs (axis a multiple of the posted lead).

export interface Grid {
  edges: number[]; // ascending, first must be 0; the last bucket is unbounded
}

// Hours since first sighting. Fine near the origin, where most mass sits, and no finer
// than an hour anywhere: the archive brackets each restoration between the last sighting
// and the first absence, a window whose median is about an hour, so a sharper grid would
// model scrape cadence rather than the system.
export const AGE_GRID: Grid = {
  edges: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 36, 48, 60, 72, 96, 120, 168, 240, 336,
    504, 720, 1440],
};

// Multiples of the lead CMTEB posted. 1.0 is an edge on purpose -- survival across it is
// exactly the miss rate, so the table reproduces the published on-time rate by
// construction and the quantiles extend it.
export const RATIO_GRID: Grid = {
  edges: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3, 4,
    5, 6, 8, 10, 15, 20, 30, 50],
};

export interface Observation {
  at: number; // where the observation ends: at restoration, or at censoring
  restored: boolean; // false = still out at the moment the table was fitted
  // Where this observation enters the risk set. 0 for a whole episode; for a row that
  // starts at a posting, the age the episode already had -- left truncation, without which
  // the buckets before entry would be credited with survival nobody observed.
  entry?: number;
}

// Per bucket: how many were still out at its start, and how many ended inside it.
export interface HazardTable {
  grid: Grid;
  atRisk: number[];
  events: number[];
  n: number; // observations contributing, censored included
}

export function bucketOf(grid: Grid, at: number): number {
  for (let i = grid.edges.length - 1; i >= 0; i--) {
    if (at >= grid.edges[i]) return i;
  }
  return 0;
}

export function fit(grid: Grid, observations: Iterable<Observation>): HazardTable {
  const atRisk = grid.edges.map(() => 0);
  const events = grid.edges.map(() => 0);
  let n = 0;
  for (const o of observations) {
    n++;
    const last = bucketOf(grid, o.at);
    for (let i = bucketOf(grid, o.entry ?? 0); i <= last; i++) atRisk[i]++;
    if (o.restored) events[last]++;
  }
  return { grid, atRisk, events, n };
}

// Width of bucket i. The last one is unbounded; hold its hazard flat at the rate the
// previous width implies, so a query past the grid decays rather than stalling.
function widthOf(grid: Grid, i: number): number {
  if (i + 1 < grid.edges.length) return grid.edges[i + 1] - grid.edges[i];
  return grid.edges[i] - grid.edges[i - 1];
}

function bucketSurvival(table: HazardTable, i: number): number {
  if (table.atRisk[i] === 0) return 1;
  return 1 - table.events[i] / table.atRisk[i];
}

// P(still out at `to` | still out at `from`). Within a bucket the hazard is taken
// constant, which makes the answer continuous in `from` instead of stepping at the grid.
export function conditionalSurvival(table: HazardTable, from: number, to: number): number {
  if (to <= from) return 1;
  const { edges } = table.grid;
  let s = 1;
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i];
    const hi = i + 1 < edges.length ? edges[i + 1] : Infinity;
    if (hi <= from) continue;
    if (lo >= to) break;
    const span = Math.min(hi, to) - Math.max(lo, from);
    s *= Math.pow(bucketSurvival(table, i), span / widthOf(table.grid, i));
    if (s === 0) return 0;
  }
  return s;
}

// The point at which conditional survival from `from` first drops to 1-q. Null when the
// table's mass runs out before reaching q -- the honest answer for "when do the worst 5%
// end" on a group with no long history.
export function quantileFrom(table: HazardTable, from: number, q: number): number | null {
  const target = 1 - q;
  const { edges } = table.grid;
  let prev = from;
  for (let i = 0; i < edges.length; i++) {
    const hi = i + 1 < edges.length ? edges[i + 1] : Infinity;
    if (hi <= from) continue;
    if (!Number.isFinite(hi)) break;
    if (conditionalSurvival(table, from, hi) <= target) {
      // Bisect inside the bucket; survival is monotone, and 40 halvings resolve far past
      // the hour this grid is honest to.
      let lo = prev;
      let up = hi;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + up) / 2;
        if (conditionalSurvival(table, from, mid) <= target) up = mid;
        else lo = mid;
      }
      return up;
    }
    prev = hi;
  }
  return null;
}
