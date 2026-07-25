// One pass over the observation archive to build what the seam needs but the derivation
// cannot see. `foundationSnapshots` drops zone_raw before any model gets a look, so the
// five `(label, street)` rows of the alias table are resolved here, per observation row,
// and handed to `measure.ts` as a lookup on (snapshot_ts, sector, label).
//
// Also computes each model's canonical sector (most recent label wins) and the identity
// counts the ADR states, so those are measured rather than assumed.
//
//   deno run -A prepare.ts [obs-dir] [registry] [aliases.csv]

import { parseRows } from "../../../src/csv.ts";
import { canonicalRegistryName, wideCanonicalName } from "../identity-model-delta/identity.ts";
import {
  decidedAliasIndex,
  decidedIdentity,
  loadAliasRows,
  scopedKey,
  streetScopedAliases,
} from "./alias_table.ts";

const WORK = Deno.env.get("WORK") ?? ".";
const OBS_DIR = Deno.args[0] ?? "data/observations";
const REGISTRY = Deno.args[1] ?? "data/thermal_points.csv";
const ALIASES = Deno.args[2] ?? "docs/research/alias-table-delta/aliases.csv";

const aliasRows = loadAliasRows(ALIASES);
const index = decidedAliasIndex(aliasRows);
const streetScoped = streetScopedAliases(aliasRows);
console.error(
  `alias table: ${aliasRows.length} rows, ${new Set(aliasRows.map((r) => r.alias)).size} labels ` +
    `(${streetScoped.size} keyed on (label, street))`,
);

const months: string[] = [];
for (const entry of Deno.readDirSync(OBS_DIR)) {
  if (entry.isFile && entry.name.endsWith(".csv")) months.push(entry.name);
}
months.sort();

// identity -> the sector of its most recent label; ties go to the later row.
const sectorOfCanon = new Map<string, string>();
const sectorOfTarget = new Map<string, string>();
const tsOfCanon = new Map<string, string>();
const tsOfTarget = new Map<string, string>();

const scoped = new Map<string, string>();
const rawLabels = new Set<string>();
const canonIdentities = new Map<string, number>();
const targetIdentities = new Map<string, number>();
let rows = 0, emptyRows = 0, scopedRows = 0, fellThrough = 0, scopedConflicts = 0;

// Per (sector, label) memo: the pipeline is pure and the corpus repeats every cell
// thousands of times.
const canonOf = new Map<string, string>();

for (const month of months) {
  const table = parseRows(Deno.readTextFileSync(`${OBS_DIR}/${month}`));
  for (let i = 1; i < table.length; i++) {
    const [ts, sector, label] = table[i];
    rows++;
    let canon = canonOf.get(label);
    if (canon === undefined) {
      canon = wideCanonicalName(label);
      canonOf.set(label, canon);
    }
    rawLabels.add(label);
    canonIdentities.set(canon, (canonIdentities.get(canon) ?? 0) + 1);
    if (canon === "") emptyRows++;

    let target: string;
    if (streetScoped.has(canon)) {
      scopedRows++;
      const result = decidedIdentity(index, streetScoped, label, table[i][7]);
      target = result.identity;
      if (result.fellThrough) fellThrough++;
      const key = scopedKey(ts, sector, label);
      const seen = scoped.get(key);
      if (seen === undefined) scoped.set(key, target);
      else if (seen !== target) scopedConflicts++;
    } else {
      target = index.get(canon) ?? canon;
    }
    targetIdentities.set(target, (targetIdentities.get(target) ?? 0) + 1);

    if ((tsOfCanon.get(canon) ?? "") <= ts) {
      tsOfCanon.set(canon, ts);
      sectorOfCanon.set(canon, sector);
    }
    if ((tsOfTarget.get(target) ?? "") <= ts) {
      tsOfTarget.set(target, ts);
      sectorOfTarget.set(target, sector);
    }
  }
  console.error(`${month}: ${rows.toLocaleString()} rows`);
}

Deno.writeTextFileSync(`${WORK}/street_scoped.json`, JSON.stringify([...scoped]));
Deno.writeTextFileSync(`${WORK}/sector_of_canon.json`, JSON.stringify([...sectorOfCanon]));
Deno.writeTextFileSync(`${WORK}/sector_of_target.json`, JSON.stringify([...sectorOfTarget]));

const registry = new Set(
  parseRows(Deno.readTextFileSync(REGISTRY)).slice(1).map((r) => canonicalRegistryName(r[0])),
);
const absent = (ids: Iterable<string>) =>
  [...ids].filter((id) => id !== "" && !registry.has(id)).length;

const summary = {
  rows,
  rawLabels: rawLabels.size,
  rawLabelsNonEmpty: [...rawLabels].filter((l) => canonOf.get(l) !== "").length,
  identitiesSteps123: canonIdentities.size,
  identitiesSteps123NonEmpty: [...canonIdentities.keys()].filter((k) => k !== "").length,
  identitiesFull: targetIdentities.size,
  identitiesFullNonEmpty: [...targetIdentities.keys()].filter((k) => k !== "").length,
  registryNames: registry.size,
  absentSteps123: absent(canonIdentities.keys()),
  absentFull: absent(targetIdentities.keys()),
  registryOnly: [...registry].filter((n) => !targetIdentities.has(n)).length,
  emptyRows,
  scopedRows,
  scopedFellThrough: fellThrough,
  scopedConflicts,
  aliasedRows: [...canonIdentities.entries()]
    .filter(([k]) => index.has(k) || streetScoped.has(k))
    .reduce((a, [, n]) => a + n, 0),
};
Deno.writeTextFileSync(`${WORK}/summary.json`, JSON.stringify(summary, null, 2));
console.error(JSON.stringify(summary, null, 2));

// Every label folded away by step 4, with its observation count -- the table's own reach.
const folded = [...canonIdentities.entries()]
  .filter(([k]) => index.has(k) || streetScoped.has(k))
  .map(([k, n]) => ({ label: k, n, streetScoped: streetScoped.has(k) }))
  .sort((a, b) => b.n - a.n);
Deno.writeTextFileSync(`${WORK}/folded.json`, JSON.stringify(folded, null, 2));
