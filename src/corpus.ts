// Loads the fixture corpus for the golden tests and the bless task

import { parseSnapshot } from "./parser.ts";
import { toCurrentJson } from "./current_json.ts";

export interface FixtureEntry {
  file: string;
  sha: string | null; // null for the hand-crafted fixture
  scraped_at: string;
  why: string;
}

export const FIXTURES_DIR = new URL("./fixtures/", import.meta.url);

export function loadManifest(): FixtureEntry[] {
  const raw = Deno.readTextFileSync(new URL("manifest.json", FIXTURES_DIR));
  return JSON.parse(raw) as FixtureEntry[];
}

export function goldenPath(entry: FixtureEntry): URL {
  return new URL(entry.file.replace(/\.html$/, ".expected.json"), FIXTURES_DIR);
}

export function renderFixture(entry: FixtureEntry): string {
  const html = Deno.readTextFileSync(new URL(entry.file, FIXTURES_DIR));
  return toCurrentJson(parseSnapshot(html, entry.scraped_at));
}

export function goldenStatus(entry: FixtureEntry): string {
  return JSON.parse(Deno.readTextFileSync(goldenPath(entry))).status;
}
