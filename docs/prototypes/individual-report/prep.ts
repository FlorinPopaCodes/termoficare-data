// PROTOTYPE -- throwaway. Builds the data payload the individual-report variants render.
//
//   deno run --allow-read --allow-write docs/prototypes/individual-report/prep.ts
//
// Answers nothing on its own: it exists so the three page variants sit on real record
// density rather than lorem ipsum. Two passes over data/observations:
//
//   1. raw CSV -- the (street, block) address index and the street index of #56, keyed on
//      the decided identity (wideCanonicalName + the alias table), plus a row-aligned
//      array of canonical names for pass 2.
//   2. the real derivation -- foundationSnapshots + deriveDatasets from src/, with each
//      observation's (sector, pt_name) rewritten to the decided identity before it enters.
//
// The rewrite is the model ADR 0002 will have once #71 and #72 land; nothing in main
// performs it yet, so every number here is a preview of post-fold figures, not of what
// today's published surfaces say.

import { parseRows } from "../../../src/csv.ts";
import { deriveDatasets, foundationSnapshots, type MonthContent } from "../../../src/derive.ts";
import { wideCanonicalName } from "../../research/identity-model-delta/identity.ts";
import {
  type AliasRow,
  addressKey,
  buildAliasIndex,
  parseZone,
  resolveAlias,
} from "../../research/address-resolution/address.ts";

const OBS_DIR = "data/observations";
const SNAP_DIR = "data/snapshots";
const OUT = "docs/prototypes/individual-report/data.json";

function months(): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(SNAP_DIR)) {
    if (e.isFile && e.name.endsWith(".csv")) out.push(e.name.slice(0, -4));
  }
  return out.sort();
}

// ---------------------------------------------------------------- pass 1: the indexes

const aliasIndex = buildAliasIndex(
  parseRows(Deno.readTextFileSync("docs/research/address-resolution/pt_aliases.csv"))
    .slice(1)
    // The table's target column carries registry spelling; the model keys on the canonical
    // form of it, as measure.ts does when it reads its own output back.
    .map(([alias, street, canonical]): AliasRow => ({
      alias,
      street,
      canonical: wideCanonicalName(canonical),
    })),
);

interface Span {
  first: string;
  last: string;
  n: number;
}

function touch(m: Map<string, Span>, key: string, ts: string) {
  const s = m.get(key);
  if (s === undefined) m.set(key, { first: ts, last: ts, n: 1 });
  else {
    if (ts < s.first) s.first = ts;
    if (ts > s.last) s.last = ts;
    s.n++;
  }
}

const MONTHS = months();

/** (street|block) -> canonical -> when that point was seen serving it. */
const addrIndex = new Map<string, Map<string, Span>>();
/** street -> canonical -> span. Feeds the miss path. */
const streetIndex = new Map<string, Map<string, Span>>();
/** (street|block) -> every street label the block has carried, for search aliasing. */
const blockStreets = new Map<string, Set<string>>();
/** canonical -> most recently reported sector. */
const sectorOf = new Map<string, string>();
const sectorTs = new Map<string, string>();
/** Row-aligned canonical names, in month order then file order -- pass 2 consumes in step. */
const canonicals: string[] = [];

const intern = new Map<string, string>();
function canonOf(label: string, streets: readonly string[]): string {
  // Street-scoped alias rows make this per-observation, not per-label, so the cache key
  // carries the streets that could match one.
  const key = `${label}${streets.join(",")}`;
  const hit = intern.get(key);
  if (hit !== undefined) return hit;
  const value = resolveAlias(aliasIndex, wideCanonicalName(label), streets);
  intern.set(key, value);
  return value;
}

console.error(`pass 1: ${MONTHS.length} months`);
for (const month of MONTHS) {
  const rows = parseRows(Deno.readTextFileSync(`${OBS_DIR}/${month}.csv`));
  for (let i = 1; i < rows.length; i++) {
    const [ts, sector, label, , , , , zoneRaw] = rows[i];
    const segments = parseZone(zoneRaw ?? "");
    const streets = segments.map((s) => s.street);
    const canonical = canonOf(label, streets);
    canonicals.push(canonical);

    if (!sectorTs.has(canonical) || ts >= sectorTs.get(canonical)!) {
      sectorTs.set(canonical, ts);
      sectorOf.set(canonical, sector);
    }

    for (const seg of segments) {
      let byStreet = streetIndex.get(seg.street);
      if (byStreet === undefined) streetIndex.set(seg.street, (byStreet = new Map()));
      touch(byStreet, canonical, ts);

      for (const block of seg.blocks) {
        const key = addressKey(seg.street, block);
        let byAddr = addrIndex.get(key);
        if (byAddr === undefined) addrIndex.set(key, (byAddr = new Map()));
        touch(byAddr, canonical, ts);

        let labels = blockStreets.get(`${canonical}${block}`);
        if (labels === undefined) blockStreets.set(`${canonical}${block}`, (labels = new Set()));
        labels.add(seg.street);
      }
    }
  }
}
console.error(
  `  ${canonicals.length} observations, ${addrIndex.size} addresses, ` +
    `${streetIndex.size} streets, ${sectorOf.size} identities`,
);

// ---------------------------------------------------------------- pass 2: the derivation

function* readMonths(): Generator<MonthContent> {
  for (const month of MONTHS) {
    yield {
      month,
      log: Deno.readTextFileSync(`${SNAP_DIR}/${month}.csv`),
      observations: Deno.readTextFileSync(`${OBS_DIR}/${month}.csv`),
    };
  }
}

// foundationSnapshots consumes observation rows strictly in file order across months in
// the order given, so a single cursor into `canonicals` stays aligned with it.
function* rewritten() {
  let cursor = 0;
  for (const snap of foundationSnapshots(readMonths())) {
    const observations = snap.observations.map((o) => {
      const pt_name = canonicals[cursor++];
      return { ...o, pt_name, sector: sectorOf.get(pt_name) ?? o.sector };
    });
    yield { ...snap, observations };
  }
  if (cursor !== canonicals.length) {
    throw new Error(`rewrite cursor ended at ${cursor}, expected ${canonicals.length}`);
  }
}

console.error("pass 2: deriving");
const started = performance.now();
const derived = await deriveDatasets(rewritten());
console.error(
  `  ${derived.stats.episodes} episodes (${derived.stats.openEpisodes} open), ` +
    `${derived.stats.scoredEstimates} scored estimates in ` +
    `${((performance.now() - started) / 1000).toFixed(1)}s`,
);

// ---------------------------------------------------------------- shape the derivation

interface Episode {
  episode_id: string;
  pt: string;
  utility: string;
  first_seen_ts: string;
  last_seen_ts: string;
  first_absent_ts: string;
  n_incidents: number;
}

const episodes: Episode[] = [];
const episodeIncidents = new Map<string, string[]>();
const incidentCause = new Map<string, string>();

for (const [path, body] of derived.files) {
  const rows = parseRows(body).slice(1);
  if (path.includes("/episodes/")) {
    for (const r of rows) {
      episodes.push({
        episode_id: r[0],
        pt: r[2],
        utility: r[3],
        first_seen_ts: r[4],
        last_seen_ts: r[5],
        first_absent_ts: r[6],
        n_incidents: Number(r[7]),
      });
    }
  } else if (path.includes("/episode_incidents/")) {
    for (const r of rows) {
      const list = episodeIncidents.get(r[0]);
      if (list === undefined) episodeIncidents.set(r[0], [r[1]]);
      else list.push(r[1]);
    }
  } else if (path.includes("/causes/")) {
    // Longest-running cause run wins the incident; good enough to label an episode.
    for (const r of rows) if (!incidentCause.has(r[0])) incidentCause.set(r[0], r[1]);
  }
}

const episodesByPt = new Map<string, Episode[]>();
for (const e of episodes) {
  const list = episodesByPt.get(e.pt);
  if (list === undefined) episodesByPt.set(e.pt, [e]);
  else list.push(e);
}

const scoresByPt = new Map<string, typeof derived.estimateScores>();
const scoresByEpisode = new Map<string, typeof derived.estimateScores>();
for (const s of derived.estimateScores) {
  const list = scoresByPt.get(s.pt_name);
  if (list === undefined) scoresByPt.set(s.pt_name, [s]);
  else list.push(s);
  const own = scoresByEpisode.get(s.episode_id);
  if (own === undefined) scoresByEpisode.set(s.episode_id, [s]);
  else own.push(s);
}

function causeOf(e: Episode): string {
  for (const id of episodeIncidents.get(e.episode_id) ?? []) {
    const c = incidentCause.get(id);
    if (c) return c;
  }
  return "";
}

// ---------------------------------------------------------------- live state + registry

interface CurrentOutage {
  sector: number;
  pt_name: string;
  service: string;
  cause: string;
  estimated_restore: string;
  on_time_probability: number | null;
  basis_n: number;
  basis_bucket: string;
  zone_raw: string;
}
const current = JSON.parse(Deno.readTextFileSync("data/current.json")) as {
  scraped_at: string;
  outages: CurrentOutage[];
};
const liveByPt = new Map<string, CurrentOutage[]>();
for (const o of current.outages) {
  const canonical = canonOf(o.pt_name, parseZone(o.zone_raw ?? "").map((s) => s.street));
  const list = liveByPt.get(canonical);
  if (list === undefined) liveByPt.set(canonical, [o]);
  else list.push(o);
}

const registry = new Map<string, { lat: number; lon: number }>();
for (const r of parseRows(Deno.readTextFileSync("data/thermal_points.csv")).slice(1)) {
  registry.set(wideCanonicalName(r[0]), { lat: Number(r[1]), lon: Number(r[2]) });
}

// ---------------------------------------------------------------- assemble

const HOUR = 3600_000;
function hours(a: string, b: string): number {
  return (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / HOUR;
}

function candidate(pt: string, addrSpan: Span | null, block: string | null) {
  const list = (episodesByPt.get(pt) ?? []).slice().sort((a, b) =>
    a.first_seen_ts < b.first_seen_ts ? -1 : 1
  );
  const shaped = list.map((e) => ({
    utility: e.utility,
    start: e.first_seen_ts,
    end: e.first_absent_ts || null,
    hours: e.first_absent_ts ? Number(hours(e.first_seen_ts, e.first_absent_ts).toFixed(1)) : null,
    cause: causeOf(e),
    // Each posted estimate scored on its own per ADR 0001 -- what lets a page say "the
    // deadline passed unmet" as an observed act rather than as a rate.
    estimates: (scoresByEpisode.get(e.episode_id) ?? []).map((s) => ({
      deadline: s.estimated_restore,
      hit: s.hit,
    })),
  }));

  const scores = scoresByPt.get(pt) ?? [];
  const closed = shaped.filter((e) => e.hours !== null).map((e) => e.hours!).sort((a, b) => a - b);
  const byYear: Record<string, { inc: number; acc: number; hours: number }> = {};
  for (const e of shaped) {
    const year = e.start.slice(0, 4);
    const y = byYear[year] ??= { inc: 0, acc: 0, hours: 0 };
    if (e.utility === "INC") y.inc++;
    else y.acc++;
    y.hours += e.hours ?? 0;
  }

  return {
    pt,
    sector: sectorOf.get(pt) ?? "",
    coords: registry.get(pt) ?? null,
    inRegistry: registry.has(pt),
    servedSince: addrSpan?.first ?? null,
    servedUntil: addrSpan?.last ?? null,
    streetLabels: block ? [...(blockStreets.get(`${pt}${block}`) ?? [])] : [],
    live: (liveByPt.get(pt) ?? []).map((o) => ({
      service: o.service,
      cause: o.cause,
      estimate: o.estimated_restore,
      probability: o.on_time_probability,
      basis_n: o.basis_n,
      basis_bucket: o.basis_bucket,
    })),
    episodes: shaped,
    summary: {
      total: shaped.length,
      inc: shaped.filter((e) => e.utility === "INC").length,
      acc: shaped.filter((e) => e.utility === "ACC").length,
      open: shaped.filter((e) => e.end === null).length,
      medianHours: closed.length ? Number(closed[closed.length >> 1].toFixed(1)) : null,
      p90Hours: closed.length
        ? Number(closed[Math.min(closed.length - 1, Math.floor(closed.length * 0.9))].toFixed(1))
        : null,
      longestHours: closed.length ? Number(closed[closed.length - 1].toFixed(1)) : null,
      totalHours: Number(closed.reduce((a, b) => a + b, 0).toFixed(1)),
      lastOutage: shaped.length ? shaped[shaped.length - 1].start : null,
      estimates: { n: scores.length, hits: scores.filter((s) => s.hit).length },
      byYear,
    },
  };
}

function lookup(street: string, block: string) {
  const byAddr = addrIndex.get(addressKey(street, block));
  const spans = byAddr ? [...byAddr] : [];
  // #56's three states: one candidate, several concurrent, or a time-disjoint pair.
  const state = spans.length === 0
    ? "miss"
    : spans.length === 1
    ? "one"
    : spans.every((a, i) => spans.every((b, j) => i === j || a[1].last < b[1].first || b[1].last < a[1].first))
    ? "migration"
    : "many";
  return {
    street,
    block,
    state,
    candidates: spans
      .sort((a, b) => (a[1].first < b[1].first ? -1 : 1))
      .map(([pt, span]) => candidate(pt, span, block)),
    streetPoints: state === "miss"
      ? [...(streetIndex.get(street) ?? [])]
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 8)
        .map(([pt, span]) => ({ pt, first: span.first, last: span.last, n: span.n }))
      : [],
  };
}

// Blind days inside the record's span -- every published figure carries them (CONTEXT.md
// `Basis`), and the individual page inherits the same duty.
const days = new Set<string>();
for (const d of derived.usableDays) days.add(d);
const first = [...days].sort()[0];
const last = [...days].sort()[days.size - 1];
let blindDays = 0;
for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 24 * HOUR) {
  if (!days.has(new Date(t).toISOString().slice(0, 10))) blindDays++;
}

// The addresses the variants are judged on -- one per state #56 defined, plus a
// currently-out one so the live-first half of the page has something to say. Chosen from
// the index rather than by hand, then frozen in picks.json so a re-run renders the same
// pages and the variants stay comparable.
const PICKS_PATH = "docs/prototypes/individual-report/picks.json";
interface Pick {
  street: string;
  block: string;
  why: string;
}

function choosePicks(): Pick[] {
  const entries = [...addrIndex].map(([key, by]) => {
    const [street, block] = key.split("|");
    const spans = [...by.values()];
    const disjoint = spans.every((a, i) =>
      spans.every((b, j) => i === j || a.last < b.first || b.last < a.first)
    );
    return { street, block, n: spans.reduce((t, s) => t + s.n, 0), k: by.size, disjoint };
  });

  const single = entries.filter((e) => e.k === 1).sort((a, b) => b.n - a.n);
  const many = entries.filter((e) => e.k > 1 && !e.disjoint).sort((a, b) => b.n - a.n);
  const migrated = entries.filter((e) => e.k > 1 && e.disjoint).sort((a, b) => b.n - a.n);

  const picks: Pick[] = [];

  // The live case first: the page leads with current status, so at least one address must
  // actually be out right now.
  for (const o of current.outages) {
    const seg = parseZone(o.zone_raw ?? "").find((s) => s.blocks.length > 0);
    if (!seg) continue;
    const key = addressKey(seg.street, seg.blocks[0]);
    if (!addrIndex.has(key)) continue;
    picks.push({ street: seg.street, block: seg.blocks[0], why: "out right now" });
    break;
  }

  picks.push({ ...single[0], why: "one candidate, heaviest record in the corpus" });
  picks.push({
    ...single[Math.floor(single.length / 2)],
    why: "one candidate, median record -- the ordinary case",
  });
  if (many[0]) picks.push({ ...many[0], why: "concurrent candidates, shown separately" });
  if (migrated[0]) picks.push({ ...migrated[0], why: "changed thermal point (time-disjoint)" });

  // A miss on a street the index does know: the block never appeared in a published
  // outage, which is the only zero-outage state the record has.
  const busiestStreet = [...streetIndex]
    .sort((a, b) => b[1].size - a[1].size)[0][0];
  picks.push({ street: busiestStreet, block: "999", why: "no published outage at this address" });

  return picks.map((p) => ({ street: p.street, block: p.block, why: p.why }));
}

let picks: Pick[];
try {
  picks = JSON.parse(Deno.readTextFileSync(PICKS_PATH));
} catch {
  picks = choosePicks();
  Deno.writeTextFileSync(PICKS_PATH, JSON.stringify(picks, null, 2));
  console.error(`chose ${picks.length} addresses -> ${PICKS_PATH}`);
}

// City-wide reference figures. Only one variant shows them, on purpose: whether an
// individual page may say "worse than the city median" is one of the things this
// prototype is asking, and ADR 0003 bears on it.
const allClosed = episodes
  .filter((e) => e.first_absent_ts)
  .map((e) => hours(e.first_seen_ts, e.first_absent_ts))
  .sort((a, b) => a - b);
const city = {
  medianHours: Number(allClosed[allClosed.length >> 1].toFixed(1)),
  p90Hours: Number(allClosed[Math.floor(allClosed.length * 0.9)].toFixed(1)),
  episodesPerPointPerYear: Number(
    (derived.stats.episodes / sectorOf.size / (days.size / 365)).toFixed(1),
  ),
  onTimeRate: Number(
    (derived.estimateScores.filter((s) => s.hit).length / derived.estimateScores.length).toFixed(4),
  ),
  estimates: derived.estimateScores.length,
};

const payload = {
  note: "PROTOTYPE. Identity is ADR 0002 + the #56 alias table, which main does not yet " +
    "perform -- these are post-fold figures.",
  city,
  scrapedAt: current.scraped_at,
  commit: new TextDecoder().decode(
    new Deno.Command("git", { args: ["rev-parse", "--short", "HEAD"] }).outputSync().stdout,
  ).trim(),
  corpus: {
    firstDay: first,
    lastDay: last,
    usableDays: days.size,
    blindDays,
    episodes: derived.stats.episodes,
    identities: sectorOf.size,
    addresses: addrIndex.size,
    streets: streetIndex.size,
  },
  addresses: picks.map((p) => ({ why: p.why, ...lookup(p.street, p.block) })),
};

Deno.writeTextFileSync(OUT, JSON.stringify(payload, null, 2));
console.error(`wrote ${OUT}`);
for (const a of payload.addresses) {
  console.error(
    `  ${a.street} / ${a.block}: ${a.state}, ${a.candidates.length} candidate(s), ` +
      `${a.candidates.reduce((n, c) => n + c.episodes.length, 0)} episodes`,
  );
}
