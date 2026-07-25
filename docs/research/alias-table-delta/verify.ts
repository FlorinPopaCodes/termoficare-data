// The gates. A measurement of a fold is only worth reading if the unfolded run reproduces
// what is actually published, so that check runs here rather than being asserted in prose,
// alongside the three properties ADR 0002 states about step 4 itself.
//
//   deno run -A verify.ts <out-root> <published-root> [registry] [aliases.csv]

import { parseRows } from "../../../src/csv.ts";
import { canonicalRegistryName, wideCanonicalName } from "../identity-model-delta/identity.ts";
import { decidedAliasIndex, loadAliasRows, streetScopedAliases } from "./alias_table.ts";

const outRoot = Deno.args[0] ?? "out";
const published = Deno.args[1] ?? ".";
const registryPath = Deno.args[2] ?? "data/thermal_points.csv";
const aliases = Deno.args[3] ?? "docs/research/alias-table-delta/aliases.csv";

const rows = loadAliasRows(aliases);
const index = decidedAliasIndex(rows);
const streetScoped = streetScopedAliases(rows);
const keys = new Set(rows.map((r) => r.alias));
let failures = 0;
const check = (ok: boolean, claim: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${claim}`);
};

// 1. The 16 artifacts the repo publishes, re-derived from the same input under the
//    unchanged model.
const ARTIFACTS = [
  "data/derived/on_time_rates.csv",
  "data/derived/active_episodes.csv",
  "images/on-time-trend.svg",
  "images/duration-trend.svg",
  ...[2021, 2022, 2023, 2024, 2025, 2026].flatMap((y) => [
    `images/episodes-inc-${y}.svg`,
    `images/episodes-acc-${y}.svg`,
  ]),
];
const identical = ARTIFACTS.filter((path) =>
  Deno.readTextFileSync(`${outRoot}/baseline/${path}`) ===
    Deno.readTextFileSync(`${published}/${path}`)
);
check(
  identical.length === ARTIFACTS.length,
  `baseline re-derives all ${ARTIFACTS.length} published artifacts byte-identical ` +
    `(${identical.length} match)`,
);

// 2. Every run saw the same input. A stream-wrapper bug shows up here first.
const metas = ["baseline", "steps123_keepempty", "steps123", "full"].map((m) =>
  JSON.parse(Deno.readTextFileSync(`${outRoot}/${m}/meta.json`))
);
check(
  new Set(metas.map((m) => m.stats.snapshots)).size === 1 &&
    new Set(metas.map((m) => m.usableDaysDigest)).size === 1,
  `all ${metas.length} runs agree on snapshots (${metas[0].stats.snapshots}) and usable days ` +
    `(${metas[0].usableDays})`,
);

// 3. Step 4 does not repeat: no alias target is itself an alias key.
const targets = [...new Set(rows.map((r) => wideCanonicalName(r.canonical)))];
check(
  targets.every((t) => !keys.has(t)),
  `no alias target is itself an alias key, so step 4 is one lookup and not a fixpoint ` +
    `(${targets.length} targets)`,
);

// 4. Step 4 is a no-op on the registry, which is what keeps #64's one-pipeline prize.
const registry = parseRows(Deno.readTextFileSync(registryPath)).slice(1).map((r) =>
  canonicalRegistryName(r[0])
);
const moved = registry.filter((n) => index.has(n) || streetScoped.has(n));
check(
  moved.length === 0,
  `step 4 changes none of the ${registry.length} registry names (${moved.length} would move)`,
);

// 5. Every alias target is a registry name -- the table folds toward the registry, never
//    into a label the registry has never heard of.
const registrySet = new Set(registry);
const stray = targets.filter((t) => !registrySet.has(t));
check(
  stray.length === 0,
  `all ${targets.length} alias targets are registry names (${stray.length} stray: ${
    stray.join(", ")
  })`,
);

// 6. The table's shape, as ADR 0002 states it.
const labelKeyed = new Set(rows.filter((r) => r.street === "").map((r) => r.alias));
check(
  keys.size === 25 && labelKeyed.size === 20 && streetScoped.size === 5,
  `the table is ${keys.size} labels: ${labelKeyed.size} keyed on the label, ` +
    `${streetScoped.size} on (label, street) over ${rows.length - labelKeyed.size} street rows`,
);

// 7. Nothing falls through, measured over the whole corpus by prepare.ts.
const summary = JSON.parse(
  Deno.readTextFileSync(`${Deno.env.get("WORK") ?? "."}/summary.json`),
);
check(
  summary.scopedFellThrough === 0 && summary.scopedConflicts === 0,
  `all ${summary.scopedRows.toLocaleString()} street-scoped observations resolve, and no ` +
    `snapshot resolves the same label two ways`,
);

// 8. No alias key survives step 4 as an identity of its own, read off the folded run's own
//    output rather than off the resolver. This is the gate that catches a seam wired to a
//    lookup it silently misses: the resolution is computed correctly, the consumer never
//    finds it, every blended label falls through to itself, and the measurement comes out
//    plausible and wrong.
const survivors = new Set<string>();
for (const entry of Deno.readDirSync(`${outRoot}/full/data/derived/episodes`)) {
  if (!entry.name.endsWith(".csv")) continue;
  const table = parseRows(
    Deno.readTextFileSync(`${outRoot}/full/data/derived/episodes/${entry.name}`),
  );
  for (let i = 1; i < table.length; i++) if (keys.has(table[i][2])) survivors.add(table[i][2]);
}
check(
  survivors.size === 0,
  `no alias key survives the folded run as an identity (${survivors.size} did: ${
    [...survivors].join(", ")
  })`,
);

console.log(failures === 0 ? "\nall gates pass" : `\n${failures} gate(s) FAILED`);
if (failures > 0) Deno.exit(1);
