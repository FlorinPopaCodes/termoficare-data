import { assertEquals } from "@std/assert";
import { buildArtifacts } from "./snapshot.ts";
import { OBSERVATION_HEADER } from "./csv.ts";
import { FIXTURES_DIR, goldenPath, loadManifest } from "./corpus.ts";

const manifest = loadManifest();

function fixture(file: string): string {
  return Deno.readTextFileSync(new URL(file, FIXTURES_DIR));
}

function entry(file: string) {
  const found = manifest.find((e) => e.file === file);
  if (found === undefined) throw new Error(`fixture not in manifest: ${file}`);
  return found;
}

Deno.test("a throwing parser degrades to parse_error without throwing itself", () => {
  const throwingParser = () => {
    throw new Error("boom");
  };

  const artifacts = buildArtifacts("<html></html>", "2026-07-16T15:13:27", throwingParser);

  assertEquals(artifacts.status, "parse_error");
  assertEquals(artifacts.observations, []);
  assertEquals(artifacts.logRow, ["2026-07-16T15:13:27", "parse_error", 0]);
  assertEquals(JSON.parse(artifacts.currentJson).outages, []);
});

Deno.test("observation rows match OBSERVATION_HEADER's order for a real fixture", () => {
  const happyPath = entry("2026-07-01_current-happy-path.html");
  const html = fixture(happyPath.file);

  const artifacts = buildArtifacts(html, happyPath.scraped_at);

  assertEquals(artifacts.status, "ok");
  assertEquals(artifacts.observations[0], [
    happyPath.scraped_at,
    1,
    "Creşa Popişteanu",
    1,
    "Oprire ACC",
    "Depistare si Remediere Avarie Retea Primara",
    "2026-07-01T23:30",
    "• Str av. Popişteanu - Nr.46",
  ]);
  for (const row of artifacts.observations) {
    assertEquals(row.length, OBSERVATION_HEADER.length);
  }
});

Deno.test("currentJson for a fixture is byte-identical to its committed golden", () => {
  const happyPath = entry("2026-07-01_current-happy-path.html");
  const html = fixture(happyPath.file);
  const expected = Deno.readTextFileSync(goldenPath(happyPath));

  const artifacts = buildArtifacts(html, happyPath.scraped_at);

  assertEquals(artifacts.currentJson, expected);
});

Deno.test("buildArtifacts is byte-deterministic on the same input", () => {
  const happyPath = entry("2026-07-01_current-happy-path.html");
  const html = fixture(happyPath.file);

  const first = buildArtifacts(html, happyPath.scraped_at);
  const second = buildArtifacts(html, happyPath.scraped_at);

  assertEquals(first.currentJson, second.currentJson);
});

Deno.test("an empty snapshot yields zero observation rows but a logged empty status", () => {
  const empty = entry("2025-01-01_all-sectors-empty.html");
  const html = fixture(empty.file);

  const artifacts = buildArtifacts(html, empty.scraped_at);

  assertEquals(artifacts.status, "empty");
  assertEquals(artifacts.observations, []);
  assertEquals(artifacts.logRow, [empty.scraped_at, "empty", 0]);
});

Deno.test("an error snapshot yields zero observation rows but a logged error status", () => {
  const error = entry("2022-03-07_backend-error-no-route.html");
  const html = fixture(error.file);

  const artifacts = buildArtifacts(html, error.scraped_at);

  assertEquals(artifacts.status, "error");
  assertEquals(artifacts.observations, []);
  assertEquals(artifacts.logRow, [error.scraped_at, "error", 0]);
});
