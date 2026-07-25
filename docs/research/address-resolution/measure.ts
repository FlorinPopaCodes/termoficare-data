// Measures address→thermal-point resolution under the model decided on #56, and derives
// the alias table that model depends on. Writes pt_aliases.csv and prints the report the
// README quotes.
//
//   deno run --allow-read --allow-write docs/research/address-resolution/measure.ts

import { parse } from "@std/csv";
import { wideCanonicalName } from "../identity-model-delta/identity.ts";
import { addressKey, type AliasRow, buildAliasIndex, parseZone, resolveAlias } from "./address.ts";

const OBSERVATIONS = "data/observations";
const REGISTRY = "data/thermal_points.csv";
const OUT = "docs/research/address-resolution/pt_aliases.csv";

// Misspellings: absent from the registry, and their use stops exactly when a
// registry-present near-twin starts. Not reachable by ADR 0002's substring rule --
// `saboani` is not a substring of `sabaoani`.
const MISSPELLINGS: Record<string, string> = {
  "saboani": "Sabaoani",
  "5 oltenitei": "5 Oltenita",
};

interface Row {
  canonical: string;
  streets: string[];
  blocks: [string, string][];
  day: string;
}

function loadRegistry(): Map<string, string> {
  const rows = parse(Deno.readTextFileSync(REGISTRY), { skipFirstRow: true }) as Record<
    string,
    string
  >[];
  const byCanonical = new Map<string, string>();
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    byCanonical.set(wideCanonicalName(r.name ?? ""), name);
  }
  return byCanonical;
}

function loadRows(): Row[] {
  const zoneCache = new Map<string, ReturnType<typeof parseZone>>();
  const out: Row[] = [];
  const months = [...Deno.readDirSync(OBSERVATIONS)].map((e) => e.name)
    .filter((n) => n.endsWith(".csv")).sort();
  for (const month of months) {
    const recs = parse(Deno.readTextFileSync(`${OBSERVATIONS}/${month}`), {
      skipFirstRow: true,
    }) as Record<string, string>[];
    for (const r of recs) {
      const canonical = wideCanonicalName(r.pt_name ?? "");
      if (!canonical) continue; // rows with an empty pt_name carry zones but no point
      const zone = r.zone_raw ?? "";
      if (!zone) continue;
      let segs = zoneCache.get(zone);
      if (!segs) {
        segs = parseZone(zone);
        zoneCache.set(zone, segs);
      }
      if (!segs.length) continue;
      const streets = [...new Set(segs.map((s) => s.street))];
      const blocks: [string, string][] = [];
      for (const s of segs) for (const b of s.blocks) blocks.push([s.street, b]);
      out.push({ canonical, streets, blocks, day: (r.snapshot_ts ?? "").slice(0, 10) });
    }
  }
  return out;
}

// --- derive the alias table -----------------------------------------------------------
const registry = loadRegistry();
const rows = loadRows();

const addrPoints = new Map<string, Set<string>>();
const streetPoints = new Map<string, Set<string>>();
for (const row of rows) {
  for (const s of row.streets) {
    let set = streetPoints.get(s);
    if (!set) {
      set = new Set();
      streetPoints.set(s, set);
    }
    set.add(row.canonical);
  }
  for (const [street, block] of row.blocks) {
    const key = addressKey(street, block);
    let set = addrPoints.get(key);
    if (!set) {
      set = new Set();
      addrPoints.set(key, set);
    }
    set.add(row.canonical);
  }
}

// A shorthand label is absent from the registry but contained in at least one registry
// name. ADR 0002 resolves it only when that containment is unique; the address corpus
// resolves the rest.
const corpus = new Set<string>();
for (const set of addrPoints.values()) for (const p of set) corpus.add(p);
const candidates = new Map<string, string[]>();
for (const label of corpus) {
  if (registry.has(label)) continue;
  const hits = [...registry.keys()].filter((r) => r !== label && r.includes(label));
  if (hits.length) candidates.set(label, hits);
}

/** Resolves a shorthand at one address: the candidate seen at this address, else on this street. */
function resolveHere(label: string, addr: string, cands: string[]): string | null {
  const here = cands.filter((c) => addrPoints.get(addr)?.has(c));
  if (here.length === 1) return here[0];
  const street = addr.split("|")[0];
  const onStreet = cands.filter((c) => streetPoints.get(street)?.has(c));
  return onStreet.length === 1 ? onStreet[0] : null;
}

const aliasRows: AliasRow[] = [];
for (const [label, cands] of [...candidates].sort()) {
  const perStreet = new Map<string, Set<string>>();
  for (const [addr, points] of addrPoints) {
    if (!points.has(label)) continue;
    const pick = resolveHere(label, addr, cands);
    if (!pick) continue;
    const street = addr.split("|")[0];
    let set = perStreet.get(street);
    if (!set) {
      set = new Set();
      perStreet.set(street, set);
    }
    set.add(pick);
  }
  if (!perStreet.size) continue;
  const targets = new Set<string>();
  for (const set of perStreet.values()) for (const t of set) targets.add(t);
  if (targets.size === 1) {
    aliasRows.push({ alias: label, street: "", canonical: registry.get([...targets][0])! });
  } else {
    // Blends two estates: no single row can be right, so the street scopes it.
    for (const [street, set] of [...perStreet].sort()) {
      if (set.size !== 1) continue;
      aliasRows.push({ alias: label, street, canonical: registry.get([...set][0])! });
    }
  }
}
for (const [alias, canonical] of Object.entries(MISSPELLINGS)) {
  aliasRows.push({ alias, street: "", canonical });
}
aliasRows.sort((a, b) => a.alias.localeCompare(b.alias) || a.street.localeCompare(b.street));

const csv = ["alias,street,canonical"];
for (const r of aliasRows) {
  csv.push(
    [r.alias, r.street, r.canonical].map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
      .join(","),
  );
}
Deno.writeTextFileSync(OUT, csv.join("\n") + "\n");

const labelRows = aliasRows.filter((r) => !r.street).length;
console.log(
  `alias table: ${aliasRows.length} rows (${labelRows} by label, ${
    aliasRows.length - labelRows
  } by (label, street))`,
);

// --- measure the index ----------------------------------------------------------------
const aliasIndex = buildAliasIndex(aliasRows.map((r) => ({
  ...r,
  canonical: wideCanonicalName(r.canonical),
})));

interface Span {
  min: string;
  max: string;
}
const index = new Map<string, Map<string, Span>>();
const streetIndex = new Map<string, Set<string>>();
for (const row of rows) {
  const point = resolveAlias(aliasIndex, row.canonical, row.streets);
  for (const s of row.streets) {
    let set = streetIndex.get(s);
    if (!set) {
      set = new Set();
      streetIndex.set(s, set);
    }
    set.add(point);
  }
  for (const [street, block] of row.blocks) {
    const key = addressKey(street, block);
    let byPoint = index.get(key);
    if (!byPoint) {
      byPoint = new Map();
      index.set(key, byPoint);
    }
    const span = byPoint.get(point);
    if (!span) byPoint.set(point, { min: row.day, max: row.day });
    else {
      if (row.day < span.min) span.min = row.day;
      if (row.day > span.max) span.max = row.day;
    }
  }
}

let single = 0, concurrent = 0, migrated = 0;
const listSizes = new Map<number, number>();
const migrations: string[] = [];
for (const [addr, byPoint] of index) {
  if (byPoint.size === 1) {
    single++;
    continue;
  }
  listSizes.set(byPoint.size, (listSizes.get(byPoint.size) ?? 0) + 1);
  const spans = [...byPoint.entries()];
  let overlap = false;
  for (let i = 0; i < spans.length && !overlap; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i][1].min <= spans[j][1].max && spans[j][1].min <= spans[i][1].max) {
        overlap = true;
        break;
      }
    }
  }
  if (overlap) concurrent++;
  else {
    migrated++;
    migrations.push(
      `${addr.replace("|", " / bl ")}: ` +
        spans.sort((a, b) => a[1].min.localeCompare(b[1].min))
          .map(([p, s]) => `${p} [${s.min}..${s.max}]`).join(" -> "),
    );
  }
}
const total = index.size;
console.log(`\naddresses: ${total}`);
console.log(`  exactly one thermal point: ${single} (${(single / total * 100).toFixed(2)}%)`);
console.log(
  `  concurrent candidate list: ${concurrent} (${(concurrent / total * 100).toFixed(2)}%)`,
);
console.log(`  time-disjoint (migration): ${migrated} (${(migrated / total * 100).toFixed(2)}%)`);
console.log(`streets in the street index: ${streetIndex.size}`);
console.log(`\ncandidate-list sizes:`);
for (const [k, v] of [...listSizes].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${k} points: ${v} addresses`);
}
console.log(`\nmigrations:`);
migrations.sort().forEach((m) => console.log(`  ${m}`));
