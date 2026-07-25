// The ladder: what each rung costs on the published numbers, as an increment over the rung
// below it.
//
//   deno run -A ladder.ts [out-root]

import { monthlyDurations } from "../../../src/duration_trend.ts";
import type { Model } from "./model.ts";

const OUT = Deno.args[0] ?? "out";
const summary = JSON.parse(Deno.readTextFileSync(`${Deno.env.get("WORK") ?? "."}/summary.json`));

const RUNGS: { model: Model; label: string; identities: number | null }[] = [
  { model: "baseline", label: "baseline — `(sector, raw label)`", identities: summary.rawLabels },
  {
    model: "steps123_keepempty",
    label: "+ ADR 0002 steps 1–3, sector dropped",
    identities: summary.identitiesSteps123,
  },
  {
    model: "steps123",
    label: "+ drop the empty `pt_name`",
    identities: summary.identitiesSteps123NonEmpty,
  },
  {
    model: "full",
    label: "+ step 4, the alias table",
    identities: summary.identitiesFullNonEmpty,
  },
];

interface Score {
  hit: boolean;
}

const rows = RUNGS.map(({ model, label, identities }) => {
  const meta = JSON.parse(Deno.readTextFileSync(`${OUT}/${model}/meta.json`));
  const scores: Score[] = JSON.parse(Deno.readTextFileSync(`${OUT}/${model}/scores.json`));
  const durations = monthlyDurations(
    JSON.parse(Deno.readTextFileSync(`${OUT}/${model}/spans.json`)),
  );
  const acc = durations.filter((d) => d.utility === "ACC");
  return {
    label,
    identities,
    episodes: meta.stats.episodes,
    incidents: meta.stats.incidents,
    bridged: meta.stats.bridgedGaps,
    hits: scores.filter((s) => s.hit).length,
    rate: scores.filter((s) => s.hit).length / scores.length,
    accP50: acc.reduce((a, d) => a + d.p50, 0) / acc.length,
  };
});

const d = (i: number, k: keyof typeof rows[0]) =>
  i === 0
    ? "—"
    : `${(rows[i][k] as number) - (rows[i - 1][k] as number) >= 0 ? "+" : ""}${
      ((rows[i][k] as number) - (rows[i - 1][k] as number)).toLocaleString()
    }`;

console.log(
  `| rung | identities | episodes | Δ | incidents | Δ | bridged gaps | Δ | on-time rate | Δpp |`,
);
console.log(`|---|---|---|---|---|---|---|---|---|---|`);
rows.forEach((r, i) => {
  const dpp = i === 0 ? "—" : `${((r.rate - rows[i - 1].rate) * 100).toFixed(3)}`;
  console.log(
    `| ${r.label} | ${r.identities?.toLocaleString() ?? "—"} | ` +
      `${r.episodes.toLocaleString()} | ${d(i, "episodes")} | ${r.incidents.toLocaleString()} | ` +
      `${d(i, "incidents")} | ${r.bridged.toLocaleString()} | ${d(i, "bridged")} | ` +
      `${(r.rate * 100).toFixed(2)}% | ${dpp} |`,
  );
});
