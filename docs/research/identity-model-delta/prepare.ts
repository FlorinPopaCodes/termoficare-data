// One pass over the observation archive to build the inputs the identity models need:
// the street set of every canonical identity (the shorthand tie-breaker) and, once
// shorthand is resolved, each identity's canonical sector (most recent label wins).

import { parseRows } from "../../../src/csv.ts";
import { canonicalName, canonicalRegistryName, foldFoldables } from "./identity.ts";
import { type Cell, resolveShorthand } from "./model.ts";

// #53's grammar: zone_raw is bullet-separated, each bullet is "<street> - <blocks>".
// Street type drifts ("Str Tohani" -> "Ale Tohani"), so it is dropped from the name.
const STREET_TYPES = new Set([
  "str",
  "bld",
  "b-dul",
  "bd",
  "cal",
  "ale",
  "sos",
  "intr",
  "splaiul",
  "spl",
  "piata",
  "pta",
  "drumul",
  "dr",
  "prel",
  "prelungirea",
  "imob",
]);

export function streetsOfZoneRaw(zoneRaw: string): string[] {
  const out: string[] = [];
  for (const bullet of zoneRaw.split("•")) {
    const head = bullet.split(" - ")[0];
    const folded = foldFoldables(head).replace(/[.,;]+$/, "");
    if (folded === "") continue;
    const parts = folded.split(" ");
    out.push(STREET_TYPES.has(parts[0]) && parts.length > 1 ? parts.slice(1).join(" ") : folded);
  }
  return out;
}

const WORK = Deno.env.get("WORK") ?? ".";
const OBS_DIR = Deno.args[0] ?? "data/observations";
const REGISTRY_PATH = Deno.args[1] ?? "data/thermal_points.csv";
const months: string[] = [];
for (const entry of Deno.readDirSync(OBS_DIR)) {
  if (entry.isFile && entry.name.endsWith(".csv")) months.push(entry.name);
}
months.sort();

const streets = new Map<string, Set<string>>();
for (const month of months) {
  const rows = parseRows(Deno.readTextFileSync(`${OBS_DIR}/${month}`));
  for (let i = 1; i < rows.length; i++) {
    const id = canonicalName(rows[i][2]);
    let set = streets.get(id);
    if (set === undefined) {
      set = new Set();
      streets.set(id, set);
    }
    for (const s of streetsOfZoneRaw(rows[i][7])) set.add(s);
  }
}
console.error(`${streets.size} identities with street sets`);

const cells: Cell[] = JSON.parse(Deno.readTextFileSync(`${WORK}/census.json`));
const registryNames = new Set(
  parseRows(Deno.readTextFileSync(REGISTRY_PATH)).slice(1).map((r) => canonicalRegistryName(r[0])),
);
const shorthand = resolveShorthand(cells, registryNames, (id) => streets.get(id) ?? new Set());
Deno.writeTextFileSync(`${WORK}/shorthand.json`, JSON.stringify(shorthand, null, 2));

const resolved = new Map(
  shorthand.filter((s) => s.resolvedTo !== null).map((s) => [s.id, s.resolvedTo!]),
);

// Most recent label wins; a tie goes to the later cell in file order.
const canonicalSector = new Map<string, string>();
const bestTs = new Map<string, string>();
for (const cell of cells) {
  const canon = canonicalName(cell.label);
  const id = resolved.get(canon) ?? canon;
  if (!bestTs.has(id) || cell.last >= bestTs.get(id)!) {
    bestTs.set(id, cell.last);
    canonicalSector.set(id, cell.sector);
  }
}
Deno.writeTextFileSync(`${WORK}/canonical_sector.json`, JSON.stringify([...canonicalSector]));

const resolvedCount = shorthand.filter((s) => s.resolvedTo !== null);
console.error(
  `shorthand: ${shorthand.length} labels (${resolvedCount.length} resolved, ` +
    `${resolvedCount.reduce((a, s) => a + s.n, 0)} obs), ` +
    `${shorthand.length - resolvedCount.length} left unresolved`,
);
for (const s of shorthand) {
  console.error(
    `  ${s.reason.padEnd(14)} n=${String(s.n).padStart(5)} ${JSON.stringify(s.id)} -> ${
      s.resolvedTo === null
        ? `(unresolved, ${s.candidates.length} candidates)`
        : JSON.stringify(s.resolvedTo)
    }`,
  );
}
