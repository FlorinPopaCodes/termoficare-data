import { assertEquals } from "@std/assert";
import { appendPayload, formatRow, monthFile, OBSERVATION_HEADER, parseRows } from "./csv.ts";

Deno.test("fields are unquoted when they contain nothing special", () => {
  assertEquals(formatRow(["a", 1, "b"]), "a,1,b\n");
});

Deno.test("a field containing a comma is quoted", () => {
  assertEquals(formatRow(["a,b"]), '"a,b"\n');
});

Deno.test("a field containing a double quote is quoted with the quote doubled", () => {
  assertEquals(formatRow(['say "hi"']), '"say ""hi"""\n');
});

Deno.test("a field containing a newline/CR is quoted", () => {
  assertEquals(formatRow(["a\nb"]), '"a\nb"\n');
  assertEquals(formatRow(["a\rb"]), '"a\rb"\n');
});

Deno.test("null renders as an empty field; numbers render bare", () => {
  // -6 blocks: CMTEB's real data-entry bug, kept as scraped
  assertEquals(formatRow([null, -6, 0]), ",-6,0\n");
});

Deno.test("rows end with LF and contain no CR", () => {
  const payload = formatRow(["a", "b"]);
  assertEquals(payload.endsWith("\n"), true);
  assertEquals(payload.includes("\r"), false);
});

Deno.test("appendPayload includes the header only when the file is new", () => {
  const rows = [["a", 1]];
  assertEquals(appendPayload(false, ["h1", "h2"], rows), "h1,h2\na,1\n");
  assertEquals(appendPayload(true, ["h1", "h2"], rows), "a,1\n");
});

Deno.test("appendPayload returns the header alone for a new file with zero rows", () => {
  assertEquals(appendPayload(false, ["h1", "h2"], []), "h1,h2\n");
});

Deno.test('appendPayload returns "" for an existing file with zero rows', () => {
  assertEquals(appendPayload(true, ["h1", "h2"], []), "");
});

Deno.test("monthFile routes by the snapshot_ts month for both observations and snapshots dirs", () => {
  assertEquals(
    monthFile("data/observations", "2026-07-16T15:13:27"),
    "data/observations/2026-07.csv",
  );
  assertEquals(monthFile("data/snapshots", "2026-02-06T09:32:38"), "data/snapshots/2026-02.csv");
});

Deno.test("a real zone_raw value with bullets and commas round-trips as one physical line", () => {
  const zone = "• Str Turda - bl. 39, 37, 34 • Str Abrud - bl. 12C";
  const row = [
    "2026-07-01T07:06:36",
    1,
    "6-1 Mai",
    17,
    "Oprire ACC",
    "Depistare si Remediere Avarie Retea Primara",
    "2026-07-01T23:30",
    zone,
  ];
  assertEquals(row.length, OBSERVATION_HEADER.length);

  const payload = formatRow(row);
  assertEquals(payload.split("\n").length, 2); // one row + trailing empty split
  assertEquals(payload.includes(`"${zone}"`), true);
});

Deno.test("parseRows round-trips a nasty formatRow row: quotes, commas, newline, CR, empty fields", () => {
  const nasty = ["a,b", 'say "hi"', "line one\nline two\rline three", "", "plain"];
  const payload = formatRow(nasty);
  assertEquals(parseRows(payload), [nasty]);
});

Deno.test("parseRows parses multiple LF-terminated rows", () => {
  const content = "h1,h2\na,1\nb,2\n";
  assertEquals(parseRows(content), [
    ["h1", "h2"],
    ["a", "1"],
    ["b", "2"],
  ]);
});

Deno.test("parseRows ignores a trailing final newline", () => {
  assertEquals(parseRows("a,b\n"), [["a", "b"]]);
});

Deno.test("parseRows on empty content returns no rows", () => {
  assertEquals(parseRows(""), []);
});

Deno.test("parseRows keeps a genuinely empty final field when there is no trailing newline", () => {
  assertEquals(parseRows("a,b,"), [["a", "b", ""]]);
});
