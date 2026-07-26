// Diffs two model runs across every published surface. #61's compare.ts, with the claim
// and live-row joins taught that a source key can have more than one destination: an
// estimate record carries no zone_raw, so a street-scoped shorthand label has two possible
// landing places and the join takes whichever exists.
//
//   deno run -A compare.ts <from-model> <to-model> [out-root] [current.json] [aliases.csv]

import { parseRows } from "../../../src/csv.ts";
import { MIN_BASIS, parsePredictionContext, predictOutage } from "../../../src/on_time.ts";
import { monthlyTrend } from "../../../src/on_time_trend.ts";
import { DURATION_MIN_BASIS, monthlyDurations } from "../../../src/duration_trend.ts";
import { candidateKeys, type Key, loadContext, type Model, rewriteLive } from "./model.ts";

const fromModel = Deno.args[0] as Model;
const toModel = Deno.args[1] as Model;
const outRoot = Deno.args[2] ?? "out";
const currentPath = Deno.args[3] ?? "data/current.json";
const aliases = Deno.args[4] ?? "docs/research/alias-table-delta/aliases.csv";
const baseDir = `${outRoot}/${fromModel}`;
const foldDir = `${outRoot}/${toModel}`;

const ctx = loadContext(Deno.env.get("WORK") ?? ".", aliases);

const read = (dir: string, path: string) => Deno.readTextFileSync(`${dir}/${path}`);
const readJson = (dir: string, path: string) => JSON.parse(read(dir, path));

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const signed = (x: number) => (x >= 0 ? `+${x}` : String(x));
const out: string[] = [];
const say = (s = "") => out.push(s);

say(`# \`${fromModel}\` -> \`${toModel}\``);

// --- 1. counts -------------------------------------------------------------------

const baseMeta = readJson(baseDir, "meta.json");
const foldMeta = readJson(foldDir, "meta.json");
say();
say(`## 1. Counts`);
say();
say(`| | ${fromModel} | ${toModel} | delta |`);
say(`|---|---|---|---|`);
for (const k of ["episodes", "incidents", "bridgedGaps", "scoredEstimates"]) {
  const a = baseMeta.stats[k], b = foldMeta.stats[k];
  say(
    `| ${k} | ${a.toLocaleString()} | ${b.toLocaleString()} | ${signed(b - a)} (${
      ((b - a) / a * 100).toFixed(3)
    }%) |`,
  );
}
say();
say(
  `snapshots ${baseMeta.stats.snapshots === foldMeta.stats.snapshots ? "identical" : "DIFFER"}, ` +
    `usable days ${
      baseMeta.usableDaysDigest === foldMeta.usableDaysDigest ? "identical" : "DIFFER"
    }`,
);

// --- 2. on-time rate and claim flips ---------------------------------------------

interface Score {
  sector: string;
  pt_name: string;
  utility: string;
  posted_ts: string;
  estimated_restore: string;
  hit: boolean;
}
const baseScores: Score[] = readJson(baseDir, "scores.json");
const foldScores: Score[] = readJson(foldDir, "scores.json");

const rate = (s: Score[]) => s.filter((x) => x.hit).length / s.length;
say();
say(`## 2. All-history on-time rate`);
say();
const baseHits = baseScores.filter((s) => s.hit).length;
const foldHits = foldScores.filter((s) => s.hit).length;
say(
  `${pct(rate(baseScores))} -> ${pct(rate(foldScores))}, ` +
    `**${((rate(foldScores) - rate(baseScores)) * 100).toFixed(3)}pp** ` +
    `(${baseHits.toLocaleString()}/${baseScores.length.toLocaleString()} -> ` +
    `${foldHits.toLocaleString()}/${foldScores.length.toLocaleString()})`,
);

// Claims join on the natural key, not on episode_id: the ids churn under every fold, so an
// id-keyed diff would not join at all.
//
// Two passes. The exact key is #61's, so the figures stay comparable. But merging two
// histories re-dates the surviving claim -- `posted_ts` is the first snapshot of the
// estimate run, and a run that gains rows starts earlier -- so a second pass joins what is
// left on the same claim without its posted date. Without it a re-dated claim reads as one
// disappearance plus one appearance, which is how a fold this small could look like
// hundreds of claims coming and going.
const exactKey = (k: Key, s: Score) =>
  `${k.sector}${k.pt_name}${s.utility}${s.posted_ts}${s.estimated_restore}`;
const looseKey = (k: Key, s: Score) => `${k.sector}${k.pt_name}${s.utility}${s.estimated_restore}`;

const bucket = (map: Map<string, number[]>, k: string, i: number) =>
  (map.get(k) ?? map.set(k, []).get(k)!).push(i);
const foldExact = new Map<string, number[]>();
const foldLoose = new Map<string, number[]>();
foldScores.forEach((s, i) => {
  bucket(foldExact, exactKey(s, s), i);
  bucket(foldLoose, looseKey(s, s), i);
});
const usedFold = new Uint8Array(foldScores.length);

let hitToMiss = 0, missToHit = 0, unchanged = 0, ambiguous = 0, vanished = 0, redated = 0;
const deferred: Score[] = [];

function matchOne(
  s: Score,
  keyOf: (k: Key, s: Score) => string,
  index: Map<string, number[]>,
): number | "none" | "many" {
  const hits: number[] = [];
  for (const k of candidateKeys(fromModel, toModel, ctx, s)) {
    for (const i of index.get(keyOf(k, s)) ?? []) if (!usedFold[i]) hits.push(i);
  }
  return hits.length === 1 ? hits[0] : hits.length === 0 ? "none" : "many";
}

function score(s: Score, i: number) {
  usedFold[i] = 1;
  const folded = foldScores[i];
  if (s.hit === folded.hit) unchanged++;
  else if (s.hit) hitToMiss++;
  else missToHit++;
}

for (const s of baseScores) {
  const m = matchOne(s, exactKey, foldExact);
  if (m === "none") deferred.push(s);
  else if (m === "many") ambiguous++;
  else score(s, m);
}
for (const s of deferred) {
  const m = matchOne(s, looseKey, foldLoose);
  if (m === "none") vanished++;
  else if (m === "many") ambiguous++;
  else {
    redated++;
    score(s, m);
  }
}
const appeared = usedFold.reduce((a, u) => a + (u ? 0 : 1), 0);

say();
say(
  `Claims keyed \`(mapped sector, mapped pt_name, utility, posted_ts, estimated_restore)\`: ` +
    `**${hitToMiss.toLocaleString()} flip hit -> miss, ${missToHit.toLocaleString()} miss -> hit**, ` +
    `${unchanged.toLocaleString()} unchanged, ${vanished.toLocaleString()} disappear ` +
    `(deduped into merged histories), ${appeared.toLocaleString()} appear.`,
);
say(
  `${redated.toLocaleString()} joined only after dropping \`posted_ts\` -- the same claim, ` +
    `re-dated by the merge. ${ambiguous.toLocaleString()} sit on a key carrying more than one ` +
    `candidate row and are not counted either way -- the error bar on the flip figures.`,
);

// --- 3. on-time trend chart -------------------------------------------------------

const basePoints = monthlyTrend(baseScores, readJson(baseDir, "pending.json"));
const foldPoints = monthlyTrend(foldScores, readJson(foldDir, "pending.json"));
const pointKey = (p: { month: string; utility: string }) => `${p.month} ${p.utility}`;
const foldPointMap = new Map(foldPoints.map((p) => [pointKey(p), p]));
const basePointMap = new Map(basePoints.map((p) => [pointKey(p), p]));

say();
say(`## 3. On-time trend (images/on-time-trend.svg)`);
say();
let moved = 0, down = 0, up = 0, wholePct = 0, worst = { key: "", d: 0, n: 0 };
for (const p of basePoints) {
  const q = foldPointMap.get(pointKey(p));
  if (q === undefined || q.rate === p.rate) continue;
  moved++;
  if (q.rate < p.rate) down++;
  else up++;
  if (Math.round(q.rate * 100) !== Math.round(p.rate * 100)) wholePct++;
  if (Math.abs(q.rate - p.rate) > Math.abs(worst.d)) {
    worst = { key: pointKey(p), d: q.rate - p.rate, n: q.n };
  }
}
say(
  `${moved} of ${basePoints.length} monthly points move (${down} down, ${up} up); ` +
    `${wholePct} change the whole-percent figure the tooltip displays. ` +
    `Largest move ${(worst.d * 100).toFixed(3)}pp at ${worst.key} (n=${worst.n}).`,
);
say(
  `Points appearing: ${foldPoints.filter((p) => !basePointMap.has(pointKey(p))).length}; ` +
    `disappearing: ${basePoints.filter((p) => !foldPointMap.has(pointKey(p))).length} ` +
    `(MIN_BASIS=${MIN_BASIS} crossings).`,
);

// --- 4. duration trend ------------------------------------------------------------

const baseDur = monthlyDurations(readJson(baseDir, "spans.json"));
const foldDur = monthlyDurations(readJson(foldDir, "spans.json"));
const foldDurMap = new Map(foldDur.map((p) => [pointKey(p), p]));
const baseDurMap = new Map(baseDur.map((p) => [pointKey(p), p]));

say();
say(`## 4. Duration trend (images/duration-trend.svg)`);
say();
say(`| percentile | points moving | up | down | largest absolute | median relative move |`);
say(`|---|---|---|---|---|---|`);
for (const p of ["p50", "p90", "p99"] as const) {
  let n = 0, u = 0, d = 0, largest = { key: "", v: 0 };
  const rels: number[] = [];
  for (const a of baseDur) {
    const b = foldDurMap.get(pointKey(a));
    if (b === undefined || b[p] === a[p]) continue;
    n++;
    if (b[p] > a[p]) u++;
    else d++;
    rels.push((b[p] - a[p]) / a[p]);
    if (Math.abs(b[p] - a[p]) > Math.abs(largest.v)) {
      largest = { key: pointKey(a), v: b[p] - a[p] };
    }
  }
  rels.sort((x, y) => x - y);
  const med = rels.length === 0 ? 0 : rels[Math.floor(rels.length / 2)];
  say(
    `| ${p} | ${n}/${baseDur.length} | ${u} | ${d} | ${largest.v >= 0 ? "+" : ""}${
      largest.v.toFixed(2)
    }h${largest.key ? ` (${largest.key})` : ""} | ${(med * 100).toFixed(2)}% |`,
  );
}
say();
say(
  `Points appearing: ${foldDur.filter((p) => !baseDurMap.has(pointKey(p))).length}; ` +
    `disappearing: ${baseDur.filter((p) => !foldDurMap.has(pointKey(p))).length} ` +
    `(DURATION_MIN_BASIS=${DURATION_MIN_BASIS} crossings).`,
);

// --- 5. heatmaps ------------------------------------------------------------------
// Read back off the rendered SVGs: the tooltip carries the published cell count and the
// chart title the published per-year count, so this measures the artifact, not a model of
// it.

interface Grid {
  cells: Map<string, number | null>;
  title: string;
  fills: Map<string, string>;
}
function readGrid(dir: string, utility: string, year: number): Grid | null {
  let svg: string;
  try {
    svg = read(dir, `images/episodes-${utility}-${year}.svg`);
  } catch {
    return null;
  }
  const cells = new Map<string, number | null>();
  const fills = new Map<string, string>();
  for (const m of svg.matchAll(/fill="([^"]+)" rx="2"><title>([^<]*)<\/title>/g)) {
    const [, fill, tip] = m;
    const [date, rest] = tip.split(": ");
    cells.set(date, rest === "no data" ? null : Number(rest.split(" ")[0]));
    fills.set(date, fill);
  }
  const title = svg.match(/class="title">([^<]*)</)?.[1] ?? "";
  return { cells, title, fills };
}

say();
say(`## 5. Heatmaps (images/episodes-*.svg)`);
say();
say(
  `| utility | day-cells with an episode | cells changing | down | up | mean delta | max delta |`,
);
say(`|---|---|---|---|---|---|---|`);
const years = [2021, 2022, 2023, 2024, 2025, 2026];
const titleRows: string[] = [];
let recoloured = 0, totalCells = 0, recolouredOnly = 0, changedValue = 0;
for (const utility of ["inc", "acc"]) {
  let withEpisode = 0, changed = 0, dn = 0, up = 0, sum = 0, max = 0;
  for (const year of years) {
    const a = readGrid(baseDir, utility, year);
    const b = readGrid(foldDir, utility, year);
    if (a === null || b === null) continue;
    for (const [date, av] of a.cells) {
      const bv = b.cells.get(date);
      totalCells++;
      const colourMoved = a.fills.get(date) !== b.fills.get(date);
      if (colourMoved) recoloured++;
      if (av !== null && av > 0) withEpisode++;
      if (av === bv) {
        if (colourMoved) recolouredOnly++;
        continue;
      }
      changedValue++;
      changed++;
      const delta = (bv ?? 0) - (av ?? 0);
      if (delta < 0) dn++;
      else up++;
      sum += delta;
      if (Math.abs(delta) > Math.abs(max)) max = delta;
    }
    if (a.title !== b.title) {
      titleRows.push(`| ${utility.toUpperCase()} ${year} | ${a.title} | ${b.title} |`);
    }
  }
  say(
    `| ${utility.toUpperCase()} | ${withEpisode} | **${changed} (${
      (changed / withEpisode * 100).toFixed(1)
    }%)** | ${dn} | ${up} | ${(sum / (changed || 1)).toFixed(2)} | ${max} |`,
  );
}
say();
say(
  `Cells whose published fill colour changes: **${recoloured} of ${totalCells}**, against ` +
    `${changedValue} that change value. **${recolouredOnly} recolour without their count moving ` +
    `at all** -- a cell can only do that if the global colour scale shifted under it.`,
);
if (titleRows.length > 0) {
  say();
  say(`| chart | ${fromModel} title | ${toModel} title |`);
  say(`|---|---|---|`);
  out.push(...titleRows);
}

// --- 6. on_time_rates.csv ---------------------------------------------------------

function rateRows(dir: string) {
  const rows = parseRows(read(dir, "data/derived/on_time_rates.csv")).slice(1);
  const byLevel = new Map<string, number>();
  const clearingByLevel = new Map<string, number>();
  let clearing = 0;
  for (const r of rows) {
    byLevel.set(r[0], (byLevel.get(r[0]) ?? 0) + 1);
    if (Number(r[6]) >= MIN_BASIS) {
      clearing++;
      clearingByLevel.set(r[0], (clearingByLevel.get(r[0]) ?? 0) + 1);
    }
  }
  return { rows: rows.length, byLevel, clearing, clearingByLevel };
}
const baseRates = rateRows(baseDir);
const foldRates = rateRows(foldDir);

say();
say(`## 6. \`data/derived/on_time_rates.csv\``);
say();
say(`| level | ${fromModel} rows | ${toModel} rows | delta | usable rows | delta |`);
say(`|---|---|---|---|---|---|`);
for (const level of baseRates.byLevel.keys()) {
  const a = baseRates.byLevel.get(level)!;
  const b = foldRates.byLevel.get(level) ?? 0;
  const ca = baseRates.clearingByLevel.get(level) ?? 0;
  const cb = foldRates.clearingByLevel.get(level) ?? 0;
  say(
    `| ${level} | ${a.toLocaleString()} | ${b.toLocaleString()} | ${signed(b - a)} | ` +
      `${cb.toLocaleString()} | ${signed(cb - ca)} |`,
  );
}
say(
  `\nBuckets clearing \`MIN_BASIS=${MIN_BASIS}\`: ${baseRates.clearing.toLocaleString()} -> ` +
    `${foldRates.clearing.toLocaleString()} (${signed(foldRates.clearing - baseRates.clearing)}).`,
);

// --- 7. current.json --------------------------------------------------------------

const current = JSON.parse(Deno.readTextFileSync(currentPath));
const baseCtx = parsePredictionContext(
  read(baseDir, "data/derived/on_time_rates.csv"),
  read(baseDir, "data/derived/active_episodes.csv"),
);
const foldCtx = parsePredictionContext(
  read(foldDir, "data/derived/on_time_rates.csv"),
  read(foldDir, "data/derived/active_episodes.csv"),
);

let withEstimate = 0, changedField = 0, changedProb = 0, changedPct = 0, bucketMoves = 0;
let basisOnly = 0;
let reproduced = 0;
const magnitudes = [0.005, 0.01, 0.02, 0.05];
const buckets = magnitudes.map(() => 0);
let maxDelta = 0;
const bucketDetail: string[] = [];
for (const o of current.outages) {
  if (o.estimated_restore === null) continue;
  withEstimate++;
  // The live row must go through the same seam before the lookup, or every folded
  // prediction misses its PT bucket and the measurement is an artifact of the join.
  const from = rewriteLive(fromModel, ctx, String(o.sector), o.pt_name, o.zone_raw ?? "");
  const to = rewriteLive(toModel, ctx, String(o.sector), o.pt_name, o.zone_raw ?? "");
  if (from === null || to === null) continue;
  const a = predictOutage(
    { ...o, sector: Number(from.sector), pt_name: from.pt_name },
    o.estimated_restore,
    current.scraped_at,
    baseCtx,
  );
  const b = predictOutage(
    { ...o, sector: Number(to.sector), pt_name: to.pt_name },
    o.estimated_restore,
    current.scraped_at,
    foldCtx,
  );
  if (a !== null && o.on_time_probability !== undefined && fromModel === "baseline") {
    if (
      a.on_time_probability === o.on_time_probability && a.basis_n === o.basis_n &&
      a.basis_bucket === o.basis_bucket
    ) reproduced++;
  }
  if (a === null || b === null) continue;
  const probDelta = Math.abs(b.on_time_probability - a.on_time_probability);
  if (
    a.on_time_probability !== b.on_time_probability || a.basis_n !== b.basis_n ||
    a.basis_bucket !== b.basis_bucket
  ) changedField++;
  if (
    a.on_time_probability === b.on_time_probability && a.basis_bucket === b.basis_bucket &&
    a.basis_n !== b.basis_n
  ) basisOnly++;
  if (probDelta > 0) {
    changedProb++;
    magnitudes.forEach((m, i) => {
      if (probDelta >= m) buckets[i]++;
    });
    if (probDelta > maxDelta) maxDelta = probDelta;
  }
  if (Math.round(a.on_time_probability * 100) !== Math.round(b.on_time_probability * 100)) {
    changedPct++;
  }
  if (a.basis_bucket !== b.basis_bucket) {
    bucketMoves++;
    bucketDetail.push(
      `- s${o.sector} \`${o.pt_name}\` — \`${a.basis_bucket}\` (n=${a.basis_n}, ` +
        `${a.on_time_probability}) -> \`${b.basis_bucket}\` (n=${b.basis_n}, ` +
        `${b.on_time_probability}): **${
          ((b.on_time_probability - a.on_time_probability) * 100).toFixed(1)
        }pp**`,
    );
  }
}

say();
say(`## 7. \`data/current.json\``);
say();
say(
  `${current.outages.length} live outages, ${withEstimate} with a posted estimate.` +
    (fromModel === "baseline"
      ? ` The baseline context reproduces the committed published fields on ${reproduced} of them.`
      : ""),
);
say(
  `**${changedField} change a published field**; ${changedProb} change the probability itself — ` +
    magnitudes.map((m, i) => `${buckets[i]} by >=${m}`).join(", ") +
    ` (max ${maxDelta.toFixed(3)}). **${changedPct} change the displayed whole percent.** ` +
    `${bucketMoves} change \`basis_bucket\`, and ${basisOnly} move only \`basis_n\` -- a wider ` +
    `basis behind the same published number.`,
);
if (bucketDetail.length > 0) {
  say();
  out.push(...bucketDetail);
}

console.log(out.join("\n"));
