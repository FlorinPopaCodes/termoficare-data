// Where step 4's episode delta comes from, family by family. A family is one alias key and
// everything it can reach: for the twenty label-keyed rows that is a pair, for the five
// street-keyed rows it is the label plus both estates it blends.
//
// The point of splitting it this way is that the table does two opposite things. A
// label-keyed row merges two identities and can only lower the episode count; a
// street-keyed row divides one identity's observations between two and can only raise it.
//
//   deno run -A families.ts <before-dir> <after-dir> [aliases.csv]

import { parseRows } from "../../../src/csv.ts";
import { wideCanonicalName } from "../identity-model-delta/identity.ts";
import { loadAliasRows } from "./alias_table.ts";

const beforeDir = Deno.args[0];
const afterDir = Deno.args[1];
const aliases = Deno.args[2] ?? "docs/research/alias-table-delta/aliases.csv";

function episodeCounts(dir: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of Deno.readDirSync(`${dir}/data/derived/episodes`)) {
    if (!entry.name.endsWith(".csv")) continue;
    const rows = parseRows(Deno.readTextFileSync(`${dir}/data/derived/episodes/${entry.name}`));
    for (let i = 1; i < rows.length; i++) {
      counts.set(rows[i][2], (counts.get(rows[i][2]) ?? 0) + 1);
    }
  }
  return counts;
}

const rows = loadAliasRows(aliases);
const before = episodeCounts(beforeDir);
const after = episodeCounts(afterDir);

// One family per alias key: the key plus every target it can reach.
const families = new Map<string, { members: Set<string>; scoped: boolean }>();
for (const r of rows) {
  const family = families.get(r.alias) ?? { members: new Set([r.alias]), scoped: false };
  family.members.add(wideCanonicalName(r.canonical));
  if (r.street !== "") family.scoped = true;
  families.set(r.alias, family);
}

const sum = (counts: Map<string, number>, members: Set<string>) =>
  [...members].reduce((a, m) => a + (counts.get(m) ?? 0), 0);

let mergeDelta = 0, splitDelta = 0;
const out: string[] = [];
out.push(`| family | keyed on | episodes before | after | Δ |`);
out.push(`|---|---|---|---|---|`);
for (
  const [alias, { members, scoped }] of [...families].sort((a, b) =>
    sum(before, b[1].members) - sum(before, a[1].members)
  )
) {
  const a = sum(before, members), b = sum(after, members);
  if (scoped) splitDelta += b - a;
  else mergeDelta += b - a;
  if (a === b) continue;
  const targets = [...members].filter((m) => m !== alias).sort();
  out.push(
    `| \`${alias}\` → ${targets.map((t) => `\`${t}\``).join(" / ")} | ` +
      `${scoped ? "`(label, street)`" : "label"} | ${a} | ${b} | ${b - a >= 0 ? "+" : ""}${
        b - a
      } |`,
  );
}
console.log(out.join("\n"));

const touched = new Set([...families.values()].flatMap((f) => [...f.members]));
const drift = [...after.keys()].filter((n) => !touched.has(n))
  .reduce((a, n) => a + (after.get(n)! - (before.get(n) ?? 0)), 0);
console.log(
  `\nLabel-keyed rows (merges only): **${mergeDelta}** episodes. ` +
    `Street-keyed rows (splits and merges): **${splitDelta >= 0 ? "+" : ""}${splitDelta}**. ` +
    `Episodes outside every family move by ${drift}.`,
);
