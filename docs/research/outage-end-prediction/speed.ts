// Is the system getting faster? A deadline-free measure of the same question trend.ts
// asks, plus the resolution limit any "when will it end" answer inherits.
//
//   WORK=... TZ=UTC deno run -A speed.ts [first-month-of-year] [last-month-of-year]
//
// Heating is seasonal and the archive's last year runs only to July, so a plain calendar
// rollup compares a Jan-Jul 2026 against a full 2025. Restricting every year to the same
// months makes the years comparable; the default does that, Jan-Jul.
//
// The on-time rate mixes two things: how fast outages end, and how far out CMTEB sets its
// deadlines. The fixed-horizon restoration rate -- the share of episodes restored within X
// hours of first sighting -- depends only on the first, so it moves only when the system
// itself moves.

import { hours, loadEpisodes, quantile } from "./data.ts";

const episodes = loadEpisodes();
const HORIZONS = [6, 12, 24, 72, 168];
const FROM_MONTH = Number(Deno.args[0] ?? 1);
const TO_MONTH = Number(Deno.args[1] ?? 7);
// 2021 is one December, and its restorations are bracketed to 4h rather than ~1h, so it is
// not comparable to any later year on either count.
const FIRST_YEAR = "2022";

interface Cell {
  within: number[];
  eligible: number[]; // per horizon: episodes observed long enough to settle it
  durations: number[];
  gaps: number[];
}

const newCell = (): Cell => ({
  within: HORIZONS.map(() => 0),
  eligible: HORIZONS.map(() => 0),
  durations: [],
  gaps: [],
});

const byYear = new Map<string, Cell>();
const cell = (key: string) => {
  let c = byYear.get(key);
  if (c === undefined) {
    c = newCell();
    byYear.set(key, c);
  }
  return c;
};

// A horizon is settled for an episode when it either restored, or outlived the horizon
// without restoring. An episode begun three days before the archive ends settles the 6h,
// 12h, 24h and 72h horizons and not the 168h one -- so each horizon carries its own
// denominator. Counting the unsettled ones either way would bend the most recent year.
const CENSOR_TS = episodes.reduce((a, e) => (e.last_seen_ts > a ? e.last_seen_ts : a), "");
let stillOpen = 0;

for (const e of episodes) {
  const c = cell(`${e.first_seen_ts.slice(0, 7)} ${e.utility}`);
  const restored = e.first_absent_ts;
  const observedFor = hours(e.first_seen_ts, CENSOR_TS);
  HORIZONS.forEach((h, i) => {
    if (restored === null && observedFor < h) return;
    c.eligible[i]++;
    if (restored !== null && hours(e.first_seen_ts, restored) <= h) c.within[i]++;
  });
  if (restored === null) {
    stillOpen++;
    continue;
  }
  c.durations.push(hours(e.first_seen_ts, restored));
  c.gaps.push(hours(e.last_seen_ts, restored));
}

// Roll months up to years so a single hot August cannot carry a yearly claim, over the
// same months of each year so the years are comparable.
const rollup = new Map<string, Cell>();
for (const [key, c] of byYear) {
  const [month, utility] = key.split(" ");
  const m = Number(month.slice(5, 7));
  if (m < FROM_MONTH || m > TO_MONTH || month < FIRST_YEAR) continue;
  const yearKey = `${month.slice(0, 4)} ${utility}`;
  const r = rollup.get(yearKey) ?? newCell();
  c.within.forEach((v, i) => r.within[i] += v);
  c.eligible.forEach((v, i) => r.eligible[i] += v);
  r.durations.push(...c.durations);
  r.gaps.push(...c.gaps);
  rollup.set(yearKey, r);
}

console.log(`Censor time (last sighting in the archive): ${CENSOR_TS}`);
console.log(`${stillOpen} episodes still open; each horizon drops the ones it cannot settle\n`);

console.log(`| year | util | episodes | ${HORIZONS.map((h) => `≤${h}h`).join(" | ")} |`);
console.log(`|---|---|---|${HORIZONS.map(() => "---").join("|")}|`);
for (const [key, c] of [...rollup.entries()].sort()) {
  const [year, utility] = key.split(" ");
  const pct = c.within
    .map((v, i) => {
      const share = `${(v / c.eligible[i] * 100).toFixed(1)}%`;
      // Flag a horizon whose denominator lost episodes to the archive's edge.
      return c.eligible[i] === c.eligible[0] ? share : `${share} (n=${c.eligible[i]})`;
    })
    .join(" | ");
  console.log(`| ${year} | ${utility} | ${c.eligible[0]} | ${pct} |`);
}

// How wide the bracket on an observed restoration is: the episode was last seen present at
// last_seen_ts and first seen absent at first_absent_ts, so the truth is somewhere between.
// No prediction can be sharper than this.
console.log("\n### Restoration bracket (first_absent − last_seen)\n");
console.log("| year | util | n | p50 | p90 | p99 |");
console.log("|---|---|---|---|---|---|");
for (const [key, c] of [...rollup.entries()].sort()) {
  const [year, utility] = key.split(" ");
  const gaps = c.gaps.sort((a, b) => a - b);
  console.log(
    `| ${year} | ${utility} | ${gaps.length} | ${quantile(gaps, 0.5).toFixed(2)}h | ` +
      `${quantile(gaps, 0.9).toFixed(2)}h | ${quantile(gaps, 0.99).toFixed(2)}h |`,
  );
}
