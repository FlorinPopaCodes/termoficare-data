// Re-derives the full history under one model and writes every published surface to its
// own output directory. scripts/derive.ts, with the observation stream put through the
// seam rewrite first and nothing written into the repo.
//
//   deno run -A measure.ts <model> <out-dir> [obs-dir] [snap-dir] [aliases.csv]

import {
  deriveDatasets,
  type FoundationSnapshot,
  foundationSnapshots,
  type MonthContent,
} from "../../../src/derive.ts";
import { renderEpisodeHeatmaps } from "../../../src/episode_heatmap.ts";
import { renderOnTimeTrend } from "../../../src/on_time_trend.ts";
import { renderDurationTrend } from "../../../src/duration_trend.ts";
import { loadContext, type Model, rewriteRow } from "./model.ts";

const model = Deno.args[0] as Model;
const outDir = Deno.args[1];
const obsDir = Deno.args[2] ?? "data/observations";
const snapDir = Deno.args[3] ?? "data/snapshots";
const aliases = Deno.args[4] ?? "docs/research/alias-table-delta/aliases.csv";

const WORK = Deno.env.get("WORK") ?? ".";
const ctx = loadContext(WORK, aliases);

function* readMonths(): Generator<MonthContent> {
  const months: string[] = [];
  for (const entry of Deno.readDirSync(snapDir)) {
    if (entry.isFile && entry.name.endsWith(".csv")) months.push(entry.name.slice(0, -4));
  }
  months.sort();
  for (const month of months) {
    yield {
      month,
      log: Deno.readTextFileSync(`${snapDir}/${month}.csv`),
      observations: Deno.readTextFileSync(`${obsDir}/${month}.csv`),
    };
  }
}

let dropped = 0;
function* rewritten(snapshots: Iterable<FoundationSnapshot>): Generator<FoundationSnapshot> {
  for (const snap of snapshots) {
    if (model === "baseline") {
      yield snap;
      continue;
    }
    const observations = [];
    for (const obs of snap.observations) {
      const to = rewriteRow(model, ctx, snap.ts, obs.sector, obs.pt_name);
      if (to === null) {
        dropped++;
        continue;
      }
      observations.push({ ...obs, sector: to.sector, pt_name: to.pt_name });
    }
    yield { ...snap, observations };
  }
}

const started = performance.now();
const derived = await deriveDatasets(rewritten(foundationSnapshots(readMonths())));
console.error(
  `${model}: derived in ${((performance.now() - started) / 1000).toFixed(1)}s, ` +
    `${dropped} observation rows dropped at the seam`,
);

async function write(path: string, content: string) {
  const full = `${outDir}/${path}`;
  await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(full, content);
}

for (const [path, content] of derived.files) await write(path, content);
for (const [path, svg] of renderEpisodeHeatmaps(derived.episodeSpans, derived.usableDays)) {
  await write(path, svg);
}
const trend = renderOnTimeTrend(derived.estimateScores, derived.pendingEstimates);
if (trend !== null) await write("images/on-time-trend.svg", trend);
const durations = renderDurationTrend(derived.episodeSpans);
if (durations !== null) await write("images/duration-trend.svg", durations);

await write(
  "meta.json",
  JSON.stringify({
    model,
    dropped,
    stats: derived.stats,
    usableDays: derived.usableDays.size,
    usableDaysDigest: [...derived.usableDays].sort().join(","),
  }),
);
await write("spans.json", JSON.stringify(derived.episodeSpans));
await write("scores.json", JSON.stringify(derived.estimateScores));
await write("pending.json", JSON.stringify(derived.pendingEstimates));
console.error(`${model}: wrote ${derived.files.size} data files to ${outDir}`);
