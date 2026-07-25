// The attribution ladder: what each component of the identity model contributes to the
// published-number delta, as an increment over the rung below it.

import { buildRewriteTable, type Cell, type Model, type ShorthandResolution } from "./model.ts";
import { monthlyDurations } from "../../../src/duration_trend.ts";

const WORK = Deno.env.get("WORK") ?? ".";
const OUT = Deno.env.get("OUT") ?? "out";
const cells: Cell[] = JSON.parse(Deno.readTextFileSync(`${WORK}/census.json`));
const shorthand: ShorthandResolution[] = JSON.parse(
  Deno.readTextFileSync(`${WORK}/shorthand.json`),
);
const canonicalSector = new Map<string, string>(
  JSON.parse(Deno.readTextFileSync(`${WORK}/canonical_sector.json`)),
);

const RUNGS: { model: Model; label: string }[] = [
  { model: "baseline", label: "baseline — `(sector, raw label)`" },
  { model: "partial", label: "+ fold ` - Partial`" },
  { model: "canon", label: "+ fold ` - Module Termice`, diacritics, casing, whitespace" },
  { model: "canon_shorthand", label: "+ resolve pre-2022-07 shorthand" },
  { model: "full", label: "+ drop sector from the key" },
];

interface Score {
  hit: boolean;
}

const rows = RUNGS.map(({ model, label }) => {
  const meta = JSON.parse(Deno.readTextFileSync(`${OUT}/${model}/meta.json`));
  const scores: Score[] = JSON.parse(Deno.readTextFileSync(`${OUT}/${model}/scores.json`));
  const table = buildRewriteTable(model, cells, shorthand, canonicalSector);
  const keys = new Set([...table.values()].map((v) => `${v.sector}${v.pt_name}`));
  const names = new Set([...table.values()].map((v) => v.pt_name));
  const durations = monthlyDurations(
    JSON.parse(Deno.readTextFileSync(`${OUT}/${model}/spans.json`)),
  );
  const p50 = durations.filter((d) => d.utility === "ACC").reduce((a, d) => a + d.p50, 0) /
    durations.filter((d) => d.utility === "ACC").length;
  return {
    label,
    keys: keys.size,
    names: names.size,
    episodes: meta.stats.episodes,
    incidents: meta.stats.incidents,
    bridged: meta.stats.bridgedGaps,
    scored: meta.stats.scoredEstimates,
    hits: scores.filter((s) => s.hit).length,
    rate: scores.filter((s) => s.hit).length / scores.length,
    accP50: p50,
  };
});

const d = (i: number, k: keyof typeof rows[0]) =>
  i === 0
    ? "—"
    : `${(rows[i][k] as number) - (rows[i - 1][k] as number) >= 0 ? "+" : ""}${
      ((rows[i][k] as number) - (rows[i - 1][k] as number)).toLocaleString()
    }`;

console.log(
  `| rung | derivation keys | identities | episodes | Δ | incidents | Δ | bridged gaps | Δ | on-time rate | Δpp |`,
);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|`);
rows.forEach((r, i) => {
  const dpp = i === 0 ? "—" : `${((r.rate - rows[i - 1].rate) * 100).toFixed(3)}`;
  console.log(
    `| ${r.label} | ${r.keys.toLocaleString()} | ${r.names.toLocaleString()} | ` +
      `${r.episodes.toLocaleString()} | ${d(i, "episodes")} | ${r.incidents.toLocaleString()} | ` +
      `${d(i, "incidents")} | ${r.bridged.toLocaleString()} | ${d(i, "bridged")} | ` +
      `${(r.rate * 100).toFixed(2)}% | ${dpp} |`,
  );
});

// How much of the sector drop is the reuniting the ADR predicted?
const canonTable = buildRewriteTable("canon_shorthand", cells, shorthand, canonicalSector);
const sectorsPerName = new Map<string, Set<string>>();
for (const v of canonTable.values()) {
  const set = sectorsPerName.get(v.pt_name) ?? new Set<string>();
  set.add(v.sector);
  sectorsPerName.set(v.pt_name, set);
}
const split = [...sectorsPerName.entries()].filter(([, s]) => s.size > 1);
console.log(
  `\nIdentities carrying more than one sector label (what dropping sector reunites): ` +
    `**${split.length}** of ${sectorsPerName.size}, spanning ${
      split.reduce((a, [, s]) => a + s.size, 0)
    } (sector, identity) keys.`,
);
