// Diffs two identity-model runs across every published surface, the way #54 did.
//
//   deno run -A compare.ts <baseline-dir> <folded-dir> <model>

import { parseRows } from "../../../src/csv.ts";
import { MIN_BASIS, parsePredictionContext, predictOutage } from "../../../src/on_time.ts";
import { monthlyTrend } from "../../../src/on_time_trend.ts";
import { DURATION_MIN_BASIS, monthlyDurations } from "../../../src/duration_trend.ts";
import {
  buildRewriteTable,
  type Cell,
  cellKey,
  type Model,
  type ShorthandResolution,
} from "./model.ts";

const baseDir = Deno.args[0];
const foldDir = Deno.args[1];
const model = Deno.args[2] as Model;

const WORK = Deno.env.get("WORK") ?? ".";
const cells: Cell[] = JSON.parse(Deno.readTextFileSync(`${WORK}/census.json`));
const shorthand: ShorthandResolution[] = JSON.parse(
  Deno.readTextFileSync(`${WORK}/shorthand.json`),
);
const canonicalSector = new Map<string, string>(
  JSON.parse(Deno.readTextFileSync(`${WORK}/canonical_sector.json`)),
);
const rewrite = buildRewriteTable(model, cells, shorthand, canonicalSector);

const read = (dir: string, path: string) => Deno.readTextFileSync(`${dir}/${path}`);
const readJson = (dir: string, path: string) => JSON.parse(read(dir, path));

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const signed = (x: number) => (x >= 0 ? `+${x}` : String(x));
const out: string[] = [];
const say = (s = "") => out.push(s);

// --- 1. counts -------------------------------------------------------------------

const baseMeta = readJson(baseDir, "meta.json");
const foldMeta = readJson(foldDir, "meta.json");
say(`## 1. Counts`);
say();
say(`| | baseline | folded | delta |`);
say(`|---|---|---|---|`);
for (const k of ["episodes", "incidents", "bridgedGaps", "scoredEstimates"]) {
  const a = baseMeta.stats[k], b = foldMeta.stats[k];
  say(
    `| ${k} | ${a.toLocaleString()} | ${b.toLocaleString()} | ${signed(b - a)} (${
      ((b - a) / a * 100).toFixed(2)
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
    `**${((rate(foldScores) - rate(baseScores)) * 100).toFixed(2)}pp** ` +
    `(${baseHits.toLocaleString()}/${baseScores.length.toLocaleString()} -> ` +
    `${foldHits.toLocaleString()}/${foldScores.length.toLocaleString()})`,
);

// Claims join on the natural key, not on episode_id: dropping sector from the id digests
// churns every id, so an id-keyed diff would not join at all.
const claimKey = (s: Score, mapped: { sector: string; pt_name: string }) =>
  `${mapped.sector}${mapped.pt_name}${s.utility}${s.posted_ts}${s.estimated_restore}`;

const baseByKey = new Map<string, Score[]>();
for (const s of baseScores) {
  const mapped = rewrite.get(cellKey(s.sector, s.pt_name)) ?? s;
  const k = claimKey(s, mapped);
  (baseByKey.get(k) ?? baseByKey.set(k, []).get(k)!).push(s);
}
const foldByKey = new Map<string, Score[]>();
for (const s of foldScores) {
  const k = claimKey(s, s);
  (foldByKey.get(k) ?? foldByKey.set(k, []).get(k)!).push(s);
}

let hitToMiss = 0, missToHit = 0, unchanged = 0, ambiguous = 0, vanished = 0, appeared = 0;
for (const [k, rows] of baseByKey) {
  const folded = foldByKey.get(k);
  if (folded === undefined) {
    vanished += rows.length;
    continue;
  }
  if (rows.length > 1 || folded.length > 1) {
    ambiguous += rows.length;
    continue;
  }
  if (rows[0].hit === folded[0].hit) unchanged++;
  else if (rows[0].hit) hitToMiss++;
  else missToHit++;
}
for (const [k, rows] of foldByKey) if (!baseByKey.has(k)) appeared += rows.length;

say();
say(
  `Claims keyed \`(mapped sector, mapped pt_name, utility, posted_ts, estimated_restore)\`: ` +
    `**${hitToMiss.toLocaleString()} flip hit -> miss, ${missToHit.toLocaleString()} miss -> hit**, ` +
    `${unchanged.toLocaleString()} unchanged, ${vanished.toLocaleString()} disappear ` +
    `(deduped into merged histories), ${appeared} appear. ` +
    `${ambiguous.toLocaleString()} claims sit on a key carrying more than one row on one side ` +
    `and are not counted either way -- the error bar on the flip figures.`,
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
  if (q === undefined) continue;
  if (q.rate === p.rate) continue;
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
    `Largest move ${(worst.d * 100).toFixed(2)}pp at ${worst.key} (n=${worst.n}).`,
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
    }h (${largest.key}) | ${(med * 100).toFixed(2)}% |`,
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
// chart title the published per-year count, so this measures the artifact, not a model
// of it.

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
let recoloured = 0, totalCells = 0;
for (const utility of ["inc", "acc"]) {
  let withEpisode = 0, changed = 0, dn = 0, up = 0, sum = 0, max = 0;
  for (const year of years) {
    const a = readGrid(baseDir, utility, year);
    const b = readGrid(foldDir, utility, year);
    if (a === null || b === null) continue;
    for (const [date, av] of a.cells) {
      const bv = b.cells.get(date);
      totalCells++;
      if (a.fills.get(date) !== b.fills.get(date)) recoloured++;
      if (av !== null && av > 0) withEpisode++;
      if (av === bv) continue;
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
say(`Cells whose published fill colour changes: **${recoloured} of ${totalCells}**.`);
if (titleRows.length > 0) {
  say();
  say(`| chart | baseline title | folded title |`);
  say(`|---|---|---|`);
  out.push(...titleRows);
}

// --- 6. on_time_rates.csv ---------------------------------------------------------

function rateRows(dir: string) {
  const rows = parseRows(read(dir, "data/derived/on_time_rates.csv")).slice(1);
  const byLevel = new Map<string, number>();
  let clearing = 0;
  for (const r of rows) {
    byLevel.set(r[0], (byLevel.get(r[0]) ?? 0) + 1);
    if (Number(r[6]) >= MIN_BASIS) clearing++;
  }
  return { rows: rows.length, byLevel, clearing };
}
const baseRates = rateRows(baseDir);
const foldRates = rateRows(foldDir);

say();
say(`## 6. \`data/derived/on_time_rates.csv\``);
say();
say(`| level | baseline rows | folded rows | delta |`);
say(`|---|---|---|---|`);
for (const level of baseRates.byLevel.keys()) {
  const a = baseRates.byLevel.get(level)!;
  const b = foldRates.byLevel.get(level) ?? 0;
  say(`| ${level} | ${a.toLocaleString()} | ${b.toLocaleString()} | ${signed(b - a)} |`);
}
say(
  `\nBuckets clearing \`MIN_BASIS=${MIN_BASIS}\`: ${baseRates.clearing.toLocaleString()} -> ` +
    `${foldRates.clearing.toLocaleString()} (${signed(foldRates.clearing - baseRates.clearing)}).`,
);

// --- 7. current.json --------------------------------------------------------------

const current = JSON.parse(Deno.readTextFileSync(Deno.args[3] ?? "data/current.json"));
const baseCtx = parsePredictionContext(
  read(baseDir, "data/derived/on_time_rates.csv"),
  read(baseDir, "data/derived/active_episodes.csv"),
);
const foldCtx = parsePredictionContext(
  read(foldDir, "data/derived/on_time_rates.csv"),
  read(foldDir, "data/derived/active_episodes.csv"),
);

let withEstimate = 0, changedField = 0, changedProb = 0, changedPct = 0, bucketMoves = 0;
let reproduced = 0;
const magnitudes = [0.005, 0.01, 0.02, 0.05];
const buckets = magnitudes.map(() => 0);
let maxDelta = 0;
const bucketDetail: string[] = [];
for (const o of current.outages) {
  if (o.estimated_restore === null) continue;
  withEstimate++;
  // The live row must be canonicalized before the lookup, or every folded prediction
  // misses its PT bucket and the measurement is an artifact of the join.
  const mapped = rewrite.get(cellKey(String(o.sector), o.pt_name)) ??
    { sector: String(o.sector), pt_name: o.pt_name };
  const a = predictOutage(o, o.estimated_restore, current.scraped_at, baseCtx);
  const b = predictOutage(
    { ...o, sector: Number(mapped.sector), pt_name: mapped.pt_name },
    o.estimated_restore,
    current.scraped_at,
    foldCtx,
  );
  if (a !== null && o.on_time_probability !== undefined) {
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
  if (probDelta > 0) {
    changedProb++;
    magnitudes.forEach((m, i) => {
      if (probDelta >= m) buckets[i]++;
    });
    if (probDelta > maxDelta) maxDelta = probDelta;
  }
  if (
    Math.round(a.on_time_probability * 100) !== Math.round(b.on_time_probability * 100)
  ) changedPct++;
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
  `${current.outages.length} live outages, ${withEstimate} with a posted estimate. ` +
    `The baseline context reproduces the committed published fields on ${reproduced} of them.`,
);
say(
  `**${changedField} change a published field**; ${changedProb} change the probability itself — ` +
    magnitudes.map((m, i) => `${buckets[i]} by >=${m}`).join(", ") +
    ` (max ${maxDelta.toFixed(3)}). **${changedPct} change the displayed whole percent.** ` +
    `${bucketMoves} change \`basis_bucket\`.`,
);
if (bucketDetail.length > 0) {
  say();
  out.push(...bucketDetail);
}

console.log(out.join("\n"));
