// Point-label census over the whole observation archive: one row per (sector, label)
// with its observation count and first/last snapshot_ts. Proper CSV parsing -- two
// labels in the corpus carry embedded commas and quoting, so field-splitting on "," is
// wrong.

import { parseRows } from "../../../src/csv.ts";

const WORK = Deno.env.get("WORK") ?? ".";
const OBS_DIR = Deno.args[0] ?? "data/observations";

interface Cell {
  sector: string;
  label: string;
  n: number;
  first: string;
  last: string;
}

const cells = new Map<string, Cell>();
const months: string[] = [];
for (const entry of Deno.readDirSync(OBS_DIR)) {
  if (entry.isFile && entry.name.endsWith(".csv")) months.push(entry.name);
}
months.sort();

for (const month of months) {
  const rows = parseRows(Deno.readTextFileSync(`${OBS_DIR}/${month}`));
  for (let i = 1; i < rows.length; i++) {
    const [ts, sector, label] = rows[i];
    const key = `${sector}${label}`;
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { sector, label, n: 0, first: ts, last: ts };
      cells.set(key, cell);
    }
    cell.n++;
    if (ts < cell.first) cell.first = ts;
    if (ts > cell.last) cell.last = ts;
  }
  console.error(`${month}: ${cells.size} cells`);
}

const out = [...cells.values()].sort((a, b) =>
  a.label < b.label ? -1 : a.label > b.label ? 1 : Number(a.sector) - Number(b.sector)
);
Deno.writeTextFileSync(Deno.args[1] ?? `${WORK}/census.json`, JSON.stringify(out));
console.error(
  `${out.length} (sector, label) cells, ${new Set(out.map((c) => c.label)).size} labels`,
);
