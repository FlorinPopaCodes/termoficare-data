import { assertEquals, assertRejects } from "@std/assert";
import {
  appendObservations,
  appendScrapeLog,
  csvField,
  csvRow,
  monthFilePath,
  OBSERVATIONS_HEADER,
  SNAPSHOT_LOG_HEADER,
} from "./csv.ts";
import { withTempDir } from "./test_util.ts";
import type { Observation, ParseResult } from "./parser.ts";

Deno.test("csvField leaves plain values unquoted", () => {
  assertEquals(csvField("MODUL TERMIC B3"), "MODUL TERMIC B3");
  assertEquals(csvField(-6), "-6");
});

Deno.test("csvField quotes and escapes commas and quotes", () => {
  assertEquals(csvField("Str. A, bl. 1"), '"Str. A, bl. 1"');
  assertEquals(csvField('say "hi"'), '"say ""hi"""');
});

Deno.test("csvField flattens embedded newlines to guarantee one physical line per row", () => {
  assertEquals(csvField("line1\nline2"), "line1 line2");
  assertEquals(csvField("a\r\nb"), "a b");
});

Deno.test("csvRow joins fields with commas and applies quoting", () => {
  assertEquals(csvRow(["a", "b,c", 3]), 'a,"b,c",3');
});

Deno.test("monthFilePath routes by the YYYY-MM prefix of the timestamp", () => {
  assertEquals(
    monthFilePath("data/observations", "2026-07-01T07:06:36"),
    "data/observations/2026-07.csv",
  );
  assertEquals(
    monthFilePath("data/snapshots", "2021-12-19T21:17:32"),
    "data/snapshots/2021-12.csv",
  );
});

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    snapshot_ts: "2026-07-01T07:06:36",
    sector: 1,
    pt_name: "MODUL TERMIC B3",
    blocks: 1,
    service: "Oprire ACC",
    cause: "Remediere avarie",
    estimated_restore: "2026-07-01T20:00",
    zone_raw: "• Str Hrisovului - bl. B3",
    ...overrides,
  };
}

function result(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    status: "ok",
    snapshot_ts: "2026-07-01T07:06:36",
    observations: [observation()],
    error: null,
    ...overrides,
  };
}

Deno.test("appendObservations writes a header on first write, LF-terminated", async () => {
  await withTempDir(async (dir) => {
    await appendObservations(dir, [observation()]);

    const content = await Deno.readTextFile(`${dir}/2026-07.csv`);

    assertEquals(content.includes("\r"), false);
    const lines = content.split("\n");
    assertEquals(lines[0], csvRow(OBSERVATIONS_HEADER));
    assertEquals(
      lines[1],
      csvRow([
        "2026-07-01T07:06:36",
        1,
        "MODUL TERMIC B3",
        1,
        "Oprire ACC",
        "Remediere avarie",
        "2026-07-01T20:00",
        "• Str Hrisovului - bl. B3",
      ]),
    );
    assertEquals(lines[lines.length - 1], "");
  });
});

Deno.test("appendObservations does not repeat the header on a second append", async () => {
  await withTempDir(async (dir) => {
    await appendObservations(dir, [observation()]);
    await appendObservations(dir, [observation({ pt_name: "MODUL TERMIC B4" })]);

    const content = await Deno.readTextFile(`${dir}/2026-07.csv`);
    const lines = content.split("\n").filter((l) => l !== "");

    assertEquals(lines.length, 3); // header + 2 rows
    assertEquals(lines[0], csvRow(OBSERVATIONS_HEADER));
  });
});

Deno.test("appendObservations with no observations creates no file", async () => {
  await withTempDir(async (dir) => {
    await appendObservations(dir, []);
    await assertRejects(() => Deno.stat(`${dir}/2026-07.csv`), Deno.errors.NotFound);
  });
});

Deno.test("appendObservations with a null estimated_restore writes an empty field", async () => {
  await withTempDir(async (dir) => {
    await appendObservations(dir, [observation({ estimated_restore: null })]);
    const content = await Deno.readTextFile(`${dir}/2026-07.csv`);
    const dataLine = content.split("\n")[1];
    assertEquals(dataLine.split(",").at(-2), "");
  });
});

Deno.test("appendScrapeLog always writes a row, even with zero observations", async () => {
  await withTempDir(async (dir) => {
    await appendScrapeLog(dir, result({ status: "empty", observations: [] }));

    const content = await Deno.readTextFile(`${dir}/2026-07.csv`);
    const lines = content.split("\n");

    assertEquals(lines[0], csvRow(SNAPSHOT_LOG_HEADER));
    assertEquals(lines[1], csvRow(["2026-07-01T07:06:36", "empty", 0]));
  });
});

Deno.test("appendScrapeLog records the observation count for an ok snapshot", async () => {
  await withTempDir(async (dir) => {
    await appendScrapeLog(dir, result());
    const content = await Deno.readTextFile(`${dir}/2026-07.csv`);
    assertEquals(content.split("\n")[1], csvRow(["2026-07-01T07:06:36", "ok", 1]));
  });
});
