// Out-of-time backtest of "when will this outage end", against CMTEB's own deadline.
//
//   WORK=... TZ=UTC deno run -A predict.ts [first-eval-month] [last-eval-month]
//
// The evaluation unit is a posting: the moment CMTEB puts a deadline on the page is the
// moment this repo would publish a prediction beside it. For each eval month every model
// is refitted on the archive as it stood at the first of that month -- outages closed by
// then as events, outages still out as censored exposure -- so no run sees its own future.
// What is scored is the remaining time from the posting to the observed restoration.
//
// Two families are compared. The age models answer from the outage's own age, ignoring
// what CMTEB said. The ratio models answer in multiples of CMTEB's posted lead, which
// makes them a correction of the deadline rather than a replacement for it.

import { hours, loadEpisodes, loadPostings, quantile } from "./data.ts";
import {
  AGE_GRID,
  bucketOf,
  fit,
  type Grid,
  type HazardTable,
  type Observation,
  quantileFrom,
  RATIO_GRID,
} from "./hazard.ts";

const FIRST = Deno.args[0] ?? "2025-01";
// The last month whose outages have mostly settled. Postings in a month near the archive
// edge over-represent short outages, because a long one begun then is still open and has
// no restoration to score against.
const LAST = Deno.args[1] ?? "2026-06";

const episodes = loadEpisodes();
const postings = loadPostings();
const episodeById = new Map(episodes.map((e) => [e.episode_id, e]));

function slipBucket(slip: number): string {
  return slip >= 3 ? "3+" : String(slip);
}

// How far ahead the deadline was set, coarsened. A covariate on top of an already-thin
// cell, not a series in its own right.
function leadBucket(leadHours: number): string {
  if (leadHours <= 6) return "<=6h";
  if (leadHours <= 24) return "<=24h";
  return ">24h";
}

// How long the outage had already been running when the deadline went up.
function ageBucket(age: number): string {
  if (age <= 6) return "<=6h";
  if (age <= 24) return "<=24h";
  return ">24h";
}

interface Ctx {
  utility: string;
  cause_class: string;
  slip: number;
  lead: number;
  age: number;
}

const KEY: Record<string, (c: Ctx) => string> = {
  "utility x cause x slip x lead x age": (c) =>
    `${c.utility}|${c.cause_class}|${slipBucket(c.slip)}|${leadBucket(c.lead)}|${ageBucket(c.age)}`,
  "utility x cause x slip x lead": (c) =>
    `${c.utility}|${c.cause_class}|${slipBucket(c.slip)}|${leadBucket(c.lead)}`,
  "utility x cause x slip": (c) => `${c.utility}|${c.cause_class}|${slipBucket(c.slip)}`,
  "utility x cause": (c) => `${c.utility}|${c.cause_class}`,
  "utility": (c) => c.utility,
  "pooled": () => "*",
};

// Fewest observations still at risk at the point being predicted from for a cell to
// answer; below it the chain backs off. Sized like on_time.ts's MIN_BASIS, same reason.
const MIN_AT_RISK = 30;

// "episode" fits whole outages on the age axis (slip is not representable -- an outage has
// one row, its slip count varies over its life). "posting" fits one row per posted
// deadline, left-truncated at the age the outage already had. "ratio" fits one row per
// posted deadline on the multiples-of-the-lead axis.
type Unit = "episode" | "posting" | "ratio";

interface Model {
  name: string;
  chain: string[];
  unit: Unit;
}

const MODELS: Model[] = [
  { name: "age: pooled", chain: ["pooled"], unit: "episode" },
  { name: "age: utility", chain: ["utility", "pooled"], unit: "episode" },
  {
    name: "age: utility x cause",
    chain: ["utility x cause", "utility", "pooled"],
    unit: "episode",
  },
  {
    name: "age: utility x cause x slip",
    chain: ["utility x cause x slip", "utility x cause", "utility", "pooled"],
    unit: "posting",
  },
  {
    name: "age: + CMTEB's lead as a covariate",
    chain: [
      "utility x cause x slip x lead",
      "utility x cause x slip",
      "utility x cause",
      "utility",
      "pooled",
    ],
    unit: "posting",
  },
  { name: "ratio: pooled", chain: ["pooled"], unit: "ratio" },
  {
    name: "ratio: utility x cause x slip",
    chain: ["utility x cause x slip", "utility x cause", "utility", "pooled"],
    unit: "ratio",
  },
  {
    name: "ratio: utility x cause x slip x lead",
    chain: [
      "utility x cause x slip x lead",
      "utility x cause x slip",
      "utility x cause",
      "utility",
      "pooled",
    ],
    unit: "ratio",
  },
  {
    name: "ratio: + elapsed age",
    chain: [
      "utility x cause x slip x lead x age",
      "utility x cause x slip x lead",
      "utility x cause x slip",
      "utility x cause",
      "utility",
      "pooled",
    ],
    unit: "ratio",
  },
];

type Tables = Map<string, Map<string, HazardTable>>;

function gridOf(unit: Unit): Grid {
  return unit === "ratio" ? RATIO_GRID : AGE_GRID;
}

// Every table each model's chain can ask for, fitted from the archive as of `cutoff`.
function fitAll(cutoff: string, unit: Unit): Tables {
  const levels = [...new Set(MODELS.filter((m) => m.unit === unit).flatMap((m) => m.chain))];
  const grid = gridOf(unit);
  const rows: { ctx: Ctx; o: Observation }[] = [];

  if (unit === "episode") {
    for (const e of episodes) {
      if (e.first_seen_ts >= cutoff) continue;
      const closed = e.first_absent_ts !== null && e.first_absent_ts < cutoff;
      const at = closed
        ? hours(e.first_seen_ts, e.first_absent_ts!)
        : hours(e.first_seen_ts, cutoff);
      if (at <= 0) continue;
      // An outage that never carried an estimate still contributes exposure here; its
      // cause class is blank, which is a cell of its own at the cause levels.
      rows.push({
        ctx: { utility: e.utility, cause_class: e.cause_class, slip: 0, lead: 0, age: 0 },
        o: { at, restored: closed },
      });
    }
  } else {
    for (const p of postings) {
      if (p.posted_ts >= cutoff) continue;
      const lead = hours(p.posted_ts, p.estimated_restore);
      const closed = p.restored_ts < cutoff;
      const entry = hours(p.episode_first_seen_ts, p.posted_ts);
      const ctx: Ctx = {
        utility: p.utility,
        cause_class: p.cause_class,
        slip: p.slip_count,
        lead,
        age: entry,
      };
      if (unit === "posting") {
        const at = closed
          ? hours(p.episode_first_seen_ts, p.restored_ts)
          : hours(p.episode_first_seen_ts, cutoff);
        if (at <= entry) continue;
        rows.push({ ctx, o: { at, restored: closed, entry } });
      } else {
        // A deadline already past when it was posted has no lead to be a multiple of.
        if (lead <= 0) continue;
        const elapsed = closed ? hours(p.posted_ts, p.restored_ts) : hours(p.posted_ts, cutoff);
        if (elapsed <= 0) continue;
        rows.push({ ctx, o: { at: elapsed / lead, restored: closed } });
      }
    }
  }

  const acc: Tables = new Map();
  for (const level of levels) {
    const grouped = new Map<string, Observation[]>();
    for (const { ctx, o } of rows) {
      const key = KEY[level](ctx);
      const list = grouped.get(key);
      if (list === undefined) grouped.set(key, [o]);
      else list.push(o);
    }
    acc.set(level, new Map([...grouped].map(([key, obs]) => [key, fit(grid, obs)])));
  }
  return acc;
}

// The most specific table in the chain still holding MIN_AT_RISK observations at this
// point on the axis.
function tableFor(tables: Tables, chain: string[], ctx: Ctx, from: number): HazardTable | null {
  let fallback: HazardTable | null = null;
  for (const level of chain) {
    const t = tables.get(level)?.get(KEY[level](ctx));
    if (t === undefined) continue;
    if (fallback === null) fallback = t;
    if (t.atRisk[bucketOf(t.grid, from)] >= MIN_AT_RISK) return t;
  }
  return fallback;
}

// Pinball (quantile) loss: the proper scoring rule for a quantile forecast.
function pinball(actual: number, predicted: number, q: number): number {
  return actual >= predicted ? q * (actual - predicted) : (1 - q) * (predicted - actual);
}

interface Acc {
  n: number;
  absErr: number[];
  pinball50: number;
  pinball50n: number;
  pinball80: number;
  covered80: number;
  covered80n: number;
  deadline80: number[];
  unbounded80: number; // the model declined to name an 80% deadline
}

const newAcc = (): Acc => ({
  n: 0,
  absErr: [],
  pinball50: 0,
  pinball50n: 0,
  pinball80: 0,
  covered80: 0,
  covered80n: 0,
  deadline80: [],
  unbounded80: 0,
});

const results = new Map<string, Acc>();
const accOf = (name: string) => {
  let a = results.get(name);
  if (a === undefined) {
    a = newAcc();
    results.set(name, a);
  }
  return a;
};

// One scored prediction: `p50` as a point forecast, `p80` as a deadline meant to hold 80%
// of the time. Null quantiles are the model declining to answer, counted rather than
// silently dropped.
function score(name: string, actual: number, p50: number | null, p80: number | null): void {
  const a = accOf(name);
  a.n++;
  if (p50 !== null) {
    a.absErr.push(Math.abs(actual - p50));
    a.pinball50 += pinball(actual, p50, 0.5);
    a.pinball50n++;
  }
  if (p80 === null) {
    a.unbounded80++;
    return;
  }
  a.pinball80 += pinball(actual, p80, 0.8);
  a.covered80n++;
  if (actual <= p80) a.covered80++;
  a.deadline80.push(p80);
}

const months: string[] = [];
for (let y = Number(FIRST.slice(0, 4)); y <= Number(LAST.slice(0, 4)); y++) {
  for (let m = 1; m <= 12; m++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key >= FIRST && key <= LAST) months.push(key);
  }
}

for (const month of months) {
  const cutoff = `${month}-01T00:00:00`;
  const tablesByUnit: Record<Unit, Tables> = {
    episode: fitAll(cutoff, "episode"),
    posting: fitAll(cutoff, "posting"),
    ratio: fitAll(cutoff, "ratio"),
  };

  const evalSet = postings.filter((p) => p.posted_ts.slice(0, 7) === month);
  for (const p of evalSet) {
    const episode = episodeById.get(p.episode_id)!;
    const age = hours(episode.first_seen_ts, p.posted_ts);
    const actual = hours(p.posted_ts, p.restored_ts);
    if (actual < 0) continue; // restoration observed before this estimate went up
    const lead = hours(p.posted_ts, p.estimated_restore);
    const ctx: Ctx = {
      utility: p.utility,
      cause_class: p.cause_class,
      slip: p.slip_count,
      lead,
      age,
    };

    // CMTEB's own deadline, scored as a point forecast and as a claim of any coverage.
    score("CMTEB's posted deadline", actual, lead, lead);

    for (const model of MODELS) {
      const table = tableFor(
        tablesByUnit[model.unit],
        model.chain,
        ctx,
        model.unit === "ratio" ? 0 : age,
      );
      if (table === null) continue;
      if (model.unit === "ratio") {
        if (lead <= 0) continue;
        const r50 = quantileFrom(table, 0, 0.5);
        const r80 = quantileFrom(table, 0, 0.8);
        score(
          model.name,
          actual,
          r50 === null ? null : r50 * lead,
          r80 === null ? null : r80 * lead,
        );
      } else {
        const a50 = quantileFrom(table, age, 0.5);
        const a80 = quantileFrom(table, age, 0.8);
        score(model.name, actual, a50 === null ? null : a50 - age, a80 === null ? null : a80 - age);
      }
    }
  }
  console.error(`${month}: ${evalSet.length} postings scored`);
}

console.log(
  `\nEval window ${FIRST}..${LAST}, refit monthly on the archive as of each month's 1st.\n`,
);
console.log(
  "| model | scored | median abs err | p90 abs err | pinball p50 | pinball p80 | " +
    "80% deadline coverage | median 80% deadline | no answer |",
);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const name of ["CMTEB's posted deadline", ...MODELS.map((m) => m.name)]) {
  const a = results.get(name);
  if (a === undefined) continue;
  const errs = [...a.absErr].sort((x, y) => x - y);
  const deadlines = [...a.deadline80].sort((x, y) => x - y);
  console.log(
    `| ${name} | ${a.n} | ${quantile(errs, 0.5).toFixed(1)}h | ` +
      `${quantile(errs, 0.9).toFixed(1)}h | ${(a.pinball50 / a.pinball50n).toFixed(2)} | ` +
      `${(a.pinball80 / a.covered80n).toFixed(2)} | ` +
      `${(a.covered80 / a.covered80n * 100).toFixed(1)}% | ` +
      `${deadlines.length === 0 ? "-" : quantile(deadlines, 0.5).toFixed(1) + "h"} | ` +
      `${a.unbounded80} |`,
  );
}
