// Out-of-time backtest of the published on-time probability: what src/on_time.ts computes
// today against Bayesian shrinkage, exponential recency weighting, and the two together.
//
//   WORK=... TZ=UTC deno run -A calibrate.ts [first-eval-month] [last-eval-month]
//
// Production pools every scored estimate in the archive and walks a backoff chain,
// publishing the first bucket holding MIN_BASIS=20. Two things that can cost accuracy:
// the cliff at 20 throws away everything a thinner bucket knows, and pooling four and a
// half years treats a 2022 estimate as evidence about today. Shrinkage addresses the
// first, decay the second; they are separate knobs and are measured apart before they are
// measured together.

import { loadEpisodes, loadPostings } from "./data.ts";

const FIRST = Deno.args[0] ?? "2025-01";
const LAST = Deno.args[1] ?? "2026-06";

const postings = loadPostings();
const episodeById = new Map(loadEpisodes().map((e) => [e.episode_id, e]));

const slipBucket = (slip: number) => (slip >= 3 ? "3+" : String(slip));

// Production's chain, most to least specific (src/on_time.ts rateTuples).
const CHAIN = ["pt_cause_slip", "sector_cause_slip", "cause_slip", "slip"] as const;
// One more level below the chain, conditioning on nothing at all. Production never uses
// it; it is here as the baseline every conditioned model has to beat to justify itself.
const LEVELS = [...CHAIN, "global"] as const;
type Level = (typeof LEVELS)[number];

interface Ctx {
  sector: string;
  pt_name: string;
  cause_class: string;
  slip: number;
}

function keyAt(level: Level, c: Ctx): string {
  const slip = slipBucket(c.slip);
  if (level === "pt_cause_slip") return `${c.sector}|${c.pt_name}|${c.cause_class}|${slip}`;
  if (level === "sector_cause_slip") return `${c.sector}|${c.cause_class}|${slip}`;
  if (level === "cause_slip") return `${c.cause_class}|${slip}`;
  if (level === "slip") return slip;
  return "*";
}

const MIN_BASIS = 20; // src/on_time.ts

interface Counts {
  hits: number;
  n: number;
}

type Rates = Map<Level, Map<string, Counts>>;

// Weighted hit counts per chain level from every estimate whose outcome was knowable at
// `cutoff`. halfLife in days; Infinity is production's flat pooling.
function tally(cutoff: string, halfLife: number): Rates {
  const cutoffMs = Date.parse(`${cutoff}Z`);
  const rates: Rates = new Map(LEVELS.map((l) => [l, new Map()]));
  for (const p of postings) {
    if (p.restored_ts >= cutoff) continue; // outcome not yet knowable at prediction time
    const e = episodeById.get(p.episode_id)!;
    const ctx: Ctx = {
      sector: e.sector,
      pt_name: e.pt_name,
      cause_class: p.cause_class,
      slip: p.slip_count,
    };
    const ageDays = (cutoffMs - Date.parse(`${p.posted_ts}Z`)) / 86400e3;
    const w = Number.isFinite(halfLife) ? Math.pow(0.5, ageDays / halfLife) : 1;
    for (const level of LEVELS) {
      const byKey = rates.get(level)!;
      const key = keyAt(level, ctx);
      const c = byKey.get(key);
      if (c === undefined) byKey.set(key, { hits: p.hit ? w : 0, n: w });
      else {
        c.n += w;
        if (p.hit) c.hits += w;
      }
    }
  }
  return rates;
}

// Production: the first bucket in the chain holding MIN_BASIS, the coarsest at any size.
function hardBackoff(rates: Rates, ctx: Ctx): number | null {
  for (const level of CHAIN) {
    const c = rates.get(level)!.get(keyAt(level, ctx));
    if (c === undefined) continue;
    if (c.n >= MIN_BASIS || level === "slip") return c.hits / c.n;
  }
  return null;
}

// Hierarchical shrinkage: walk the chain coarse to fine, each level's posterior mean
// pulling its own counts toward the level above with strength kappa. A bucket with two
// estimates barely moves off its parent; one with two hundred is essentially its own rate.
// No cliff, and every level contributes what it knows.
function shrunk(rates: Rates, ctx: Ctx, kappa: number): number | null {
  let prior: number | null = null;
  for (const level of [...CHAIN].reverse()) {
    const c = rates.get(level)!.get(keyAt(level, ctx));
    if (c === undefined) continue;
    prior = prior === null ? c.hits / c.n : (c.hits + kappa * prior) / (c.n + kappa);
  }
  return prior;
}

interface Acc {
  n: number;
  brier: number;
  logLoss: number;
  bins: { p: number; y: number; n: number }[];
}

const newAcc = (): Acc => ({
  n: 0,
  brier: 0,
  logLoss: 0,
  bins: Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 })),
});

let baseRateNumerator = 0;
let baseRateDenominator = 0;

const results = new Map<string, Acc>();
function record(name: string, p: number, hit: boolean): void {
  let a = results.get(name);
  if (a === undefined) {
    a = newAcc();
    results.set(name, a);
  }
  const y = hit ? 1 : 0;
  a.n++;
  a.brier += (p - y) ** 2;
  // Clamp before the log: an empirical 0 or 1 is a small-sample artifact, not certainty.
  const clamped = Math.min(Math.max(p, 1e-3), 1 - 1e-3);
  a.logLoss += -(y * Math.log(clamped) + (1 - y) * Math.log(1 - clamped));
  const bin = a.bins[Math.min(9, Math.floor(p * 10))];
  bin.p += p;
  bin.y += y;
  bin.n++;
}

const months: string[] = [];
for (let y = Number(FIRST.slice(0, 4)); y <= Number(LAST.slice(0, 4)); y++) {
  for (let m = 1; m <= 12; m++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key >= FIRST && key <= LAST) months.push(key);
  }
}

const HALF_LIVES: [string, number][] = [
  ["flat", Infinity],
  ["365d", 365],
  ["180d", 180],
  ["90d", 90],
];
const KAPPAS = [10, 25, 50];

for (const month of months) {
  const cutoff = `${month}-01T00:00:00`;
  const tallies = new Map(HALF_LIVES.map(([name, h]) => [name, tally(cutoff, h)]));

  for (const p of postings) {
    if (p.posted_ts.slice(0, 7) !== month) continue;
    baseRateDenominator++;
    if (p.hit) baseRateNumerator++;
    const e = episodeById.get(p.episode_id)!;
    const ctx: Ctx = {
      sector: e.sector,
      pt_name: e.pt_name,
      cause_class: p.cause_class,
      slip: p.slip_count,
    };

    for (const [hl] of HALF_LIVES) {
      const rates = tallies.get(hl)!;
      // The unconditional rate as it stood at the cutoff: what publishing a single number
      // would have scored. Every conditioned model below has to beat this to be worth its
      // complexity.
      const global = rates.get("global")!.get("*");
      if (global !== undefined) record(`base rate only, ${hl}`, global.hits / global.n, p.hit);
      const hard = hardBackoff(rates, ctx);
      if (hard !== null) record(`backoff@20, ${hl}`, hard, p.hit);
      for (const kappa of KAPPAS) {
        const s = shrunk(rates, ctx, kappa);
        if (s !== null) record(`shrinkage k=${kappa}, ${hl}`, s, p.hit);
      }
    }
  }
  console.error(`${month} scored`);
}

// Expected calibration error: how far the predicted probability sits from the realised
// frequency, averaged over prediction deciles and weighted by their size.
function ece(a: Acc): number {
  let sum = 0;
  for (const b of a.bins) {
    if (b.n === 0) continue;
    sum += b.n * Math.abs(b.p / b.n - b.y / b.n);
  }
  return sum / a.n;
}

// The realised hit rate over the whole eval window, and what a predictor that somehow knew
// it in advance would have scored: the floor no unconditional model can go below, and the
// bar any conditioning has to clear to have added information.
const base = baseRateNumerator / baseRateDenominator;
const oracleBrier = base * (1 - base);
const oracleLogLoss = -(base * Math.log(base) + (1 - base) * Math.log(1 - base));
console.log(`\nEval window ${FIRST}..${LAST}, refit monthly. Lower is better everywhere.`);
console.log(
  `Realised hit rate ${(base * 100).toFixed(2)}% over ${baseRateDenominator} estimates. ` +
    `A predictor that knew it in advance scores Brier ${oracleBrier.toFixed(5)}, ` +
    `log loss ${oracleLogLoss.toFixed(5)} -- the skill floor.\n`,
);
// Mean predicted probability minus the realised hit rate: which way the whole surface
// leans. Calibration error cannot see this -- two bins wrong in opposite directions
// average out there and do not average out here.
function bias(a: Acc): number {
  let p = 0;
  let y = 0;
  for (const b of a.bins) {
    p += b.p;
    y += b.y;
  }
  return (p - y) / a.n;
}

console.log("| model | scored | Brier | log loss | calibration error | bias | skill |");
console.log("|---|---|---|---|---|---|---|");
const rows = [...results.entries()].sort((a, b) => a[1].brier / a[1].n - b[1].brier / b[1].n);
for (const [name, a] of rows) {
  const b = bias(a);
  // Skill against the in-advance base rate: positive means the model beat a single number,
  // negative means the conditioning cost accuracy rather than adding it.
  const skill = (1 - (a.brier / a.n) / oracleBrier) * 100;
  console.log(
    `| ${name} | ${a.n} | ${(a.brier / a.n).toFixed(5)} | ${(a.logLoss / a.n).toFixed(5)} | ` +
      `${(ece(a) * 100).toFixed(2)}pp | ${b >= 0 ? "+" : ""}${(b * 100).toFixed(2)}pp | ` +
      `${skill >= 0 ? "+" : ""}${skill.toFixed(2)}% |`,
  );
}

// The reliability diagram for the two ends of the comparison, as a table: what production
// publishes today, and the configuration chosen on the earlier window.
for (const name of ["backoff@20, flat", "shrinkage k=50, 180d"]) {
  const a = results.get(name);
  if (a === undefined) continue;
  console.log(`\n### Reliability: ${name}\n`);
  console.log("| predicted | n | mean predicted | observed hit rate |");
  console.log("|---|---|---|---|");
  a.bins.forEach((b, i) => {
    if (b.n === 0) return;
    console.log(
      `| ${i * 10}-${i * 10 + 10}% | ${b.n} | ${(b.p / b.n * 100).toFixed(1)}% | ` +
        `${(b.y / b.n * 100).toFixed(1)}% |`,
    );
  });
}
