#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-run=git,gh --allow-env=SCRAPER_NAME
//
// One scrape: fetch the CMTEB status page, publish the snapshot plus its postprocessed
// artifacts to origin/main, then record this scraper's heartbeat for the health workflow.
//
//   SCRAPER_NAME=HOME_BOX deno task scrape
//
// Runs on a scraper machine every 15 minutes, never on GitHub Actions: CMTEB blocks
// GitHub's IP ranges (ADR 0004). The machine needs push access to the repo and a gh login
// allowed to write repository variables.
//
// The heartbeat is written only after the snapshot is safely on main, so a scraper that
// can fetch but not push still reads as down.

import { postprocess } from "../postprocess.ts";
import { SOURCE_URL } from "../src/current_json.ts";
import { HEARTBEAT_PREFIX } from "../src/health.ts";
import { SNAPSHOT_PATH } from "../src/snapshot.ts";
import { publish } from "./publish.ts";

const FETCH_TIMEOUT_MS = 60_000;

const name = Deno.env.get("SCRAPER_NAME") ?? "";
if (!/^[A-Za-z0-9_]+$/.test(name)) {
  throw new Error("Set SCRAPER_NAME to this scraper's name (letters, digits, underscores).");
}

// A non-2xx status is a failed fetch: no snapshot, no heartbeat. CMTEB's own error pages
// arrive as 200 and are recorded as "error" rows by postprocess.
const fetchedAt = new Date().toISOString();
const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
if (!response.ok) throw new Error(`${SOURCE_URL} returned ${response.status}`);
const html = await response.text();

const pushed = await publish(`Scrape: latest data (${fetchedAt})`, async () => {
  await Deno.writeTextFile(SNAPSHOT_PATH, html);
  await postprocess();
});
console.log(pushed ? "Published." : "Nothing changed.");

const variable = HEARTBEAT_PREFIX + name.toUpperCase();
const gh = await new Deno.Command("gh", {
  args: ["variable", "set", variable, "--body", fetchedAt],
}).output();
if (!gh.success) throw new Error(`gh variable set ${variable} failed`);
console.log(`${variable}=${fetchedAt}`);
