import { assertEquals, assertExists } from "@std/assert";
import { FIXTURES_DIR, goldenPath, goldenStatus, loadManifest, renderFixture } from "./corpus.ts";

const manifest = loadManifest();

// Regenerate goldens with: deno task bless
for (const entry of manifest) {
  Deno.test(`golden: ${entry.file}`, () => {
    const expected = Deno.readTextFileSync(goldenPath(entry));
    assertEquals(renderFixture(entry), expected);
  });
}

Deno.test("manifest covers every fixture on disk, and vice versa", () => {
  const onDisk = Array.from(Deno.readDirSync(FIXTURES_DIR))
    .filter((e) => e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort();

  assertEquals(manifest.map((e) => e.file).sort(), onDisk);
});

Deno.test("every scrape-log status is exercised by the corpus", () => {
  const statuses = new Set(manifest.map(goldenStatus));

  assertEquals([...statuses].sort(), ["empty", "error", "ok", "parse_error"]);
});

Deno.test("historical fixtures carry provenance; the synthetic one is marked as such", () => {
  for (const entry of manifest) {
    assertExists(entry.why);
    assertEquals(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(entry.scraped_at), true);
    if (entry.file === "synthetic-parse-error.html") {
      assertEquals(entry.sha, null);
    } else {
      assertEquals(/^[0-9a-f]{40}$/.test(entry.sha ?? ""), true);
    }
  }
});

Deno.test("the synthetic fixture is the corpus's only parse_error, with zero observations", () => {
  const failing = manifest.filter((e) => goldenStatus(e) === "parse_error");

  assertEquals(failing.map((e) => e.file), ["synthetic-parse-error.html"]);
  assertEquals(JSON.parse(renderFixture(failing[0])).outages, []);
});

Deno.test("parsing is deterministic — same fixture, same bytes", () => {
  for (const entry of manifest) {
    assertEquals(renderFixture(entry), renderFixture(entry));
  }
});
