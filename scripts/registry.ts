#!/usr/bin/env -S deno run --allow-net --allow-write
//
// Refreshes data/thermal_points.csv from CMTEB's system map -- the registry of thermal
// points and their coordinates that ADR 0002 rests its identity model on.
//
//   deno task registry
//
// The map page is the only published list of what thermal points exist; the status page
// shows only the ones currently in outage. Names are captured exactly as published,
// because their whitespace padding is evidence ADR 0002's canonicalization must handle.
//
// Run daily by .github/workflows/registry.yml, which commits only when the bytes change.
// Since only the stable fields are kept, that is a no-op except when CMTEB commissions,
// renames, or moves a point -- so the file's git history is the drift record.

import { parseRegistry, REGISTRY_PATH, toCsv } from "../src/registry.ts";

const SOURCE = "https://cmteb.ro/harta_stare_sistem_termoficare_bucuresti.php";

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} returned ${response.status}`);

const points = parseRegistry(await response.text());
await Deno.writeTextFile(REGISTRY_PATH, toCsv(points));

console.log(`${REGISTRY_PATH}: ${points.length} thermal points`);
