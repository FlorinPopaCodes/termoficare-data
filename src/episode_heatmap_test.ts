import { assertEquals, assertStringIncludes } from "@std/assert";
import { type EpisodeSpan, renderEpisodeHeatmaps } from "./episode_heatmap.ts";

const EMPTY_COLOR = "#161b22";
const BLIND_COLOR = "#484f58";

function inc(first_seen_ts: string, last_seen_ts: string): EpisodeSpan {
  return { utility: "INC", first_seen_ts, last_seen_ts };
}

// Inclusive date range as a Set, stepped in UTC to match renderEpisodeHeatmaps' own day
// keys regardless of ambient TZ.
function usableDaysRange(start: string, end: string): Set<string> {
  const days = new Set<string>();
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  for (let t = startMs; t <= endMs; t += 86400000) {
    days.add(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

Deno.test("a multi-day episode lights its active days and leaves the rest zero-dark", () => {
  const usableDays = usableDaysRange("2024-01-01", "2024-01-07");
  const svgs = renderEpisodeHeatmaps(
    [inc("2024-01-02T08:00:00", "2024-01-04T20:00:00")],
    usableDays,
  );
  const svg = svgs.get("images/episodes-inc-2024.svg")!;

  for (const date of ["2024-01-02", "2024-01-03", "2024-01-04"]) {
    assertStringIncludes(svg, `fill="#d7301f" rx="2"><title>${date}: 1 active episode</title>`);
  }
  // before the episode was first seen, and after its last sighting: known zero, not blind
  assertStringIncludes(
    svg,
    `fill="${EMPTY_COLOR}" rx="2"><title>2024-01-01: 0 active episodes</title>`,
  );
  assertStringIncludes(
    svg,
    `fill="${EMPTY_COLOR}" rx="2"><title>2024-01-05: 0 active episodes</title>`,
  );
});

Deno.test("blind vs zero vs active: a nonzero count wins over blindness", () => {
  const usableDays = usableDaysRange("2024-01-01", "2024-01-15");
  usableDays.delete("2024-01-05"); // blind, and no episode covers it
  usableDays.delete("2024-01-10"); // blind, but an episode's seen range covers it

  const svgs = renderEpisodeHeatmaps(
    [inc("2024-01-09T00:00:00", "2024-01-11T00:00:00")],
    usableDays,
  );
  const svg = svgs.get("images/episodes-inc-2024.svg")!;

  assertStringIncludes(svg, `fill="${BLIND_COLOR}" rx="2"><title>2024-01-05: no data</title>`);
  assertStringIncludes(svg, `fill="#d7301f" rx="2"><title>2024-01-10: 1 active episode</title>`);
});

Deno.test("the color scale is global per utility, not per year", () => {
  const usableDays = new Set(["2024-03-01", "2024-03-02", "2025-05-01"]);
  const episodes: EpisodeSpan[] = [
    inc("2024-03-01T00:00:00", "2024-03-01T00:00:00"),
    inc("2024-03-01T00:00:00", "2024-03-01T00:00:00"),
    inc("2024-03-01T00:00:00", "2024-03-01T00:00:00"),
    inc("2024-03-01T00:00:00", "2024-03-01T00:00:00"), // 2024-03-01: count 4, the global max
    inc("2024-03-02T00:00:00", "2024-03-02T00:00:00"),
    inc("2024-03-02T00:00:00", "2024-03-02T00:00:00"), // 2024-03-02: count 2
    inc("2025-05-01T00:00:00", "2025-05-01T00:00:00"),
    inc("2025-05-01T00:00:00", "2025-05-01T00:00:00"), // 2025-05-01: count 2, 2025's own max
  ];

  const svgs = renderEpisodeHeatmaps(episodes, usableDays);
  const svg2024 = svgs.get("images/episodes-inc-2024.svg")!;
  const svg2025 = svgs.get("images/episodes-inc-2025.svg")!;

  const fill2024 = svg2024.match(
    /fill="(#[0-9a-f]{6})" rx="2"><title>2024-03-02: 2 active episodes<\/title>/,
  );
  const fill2025 = svg2025.match(
    /fill="(#[0-9a-f]{6})" rx="2"><title>2025-05-01: 2 active episodes<\/title>/,
  );

  assertEquals(fill2024 !== null, true);
  assertEquals(fill2025 !== null, true);
  // per-year scaling would make 2025's count-2 cell (its own max) brighter than 2024's
  // count-2 cell (well below 2024's max of 4) -- a global scale keeps them equal.
  assertEquals(fill2024![1], fill2025![1]);
});

Deno.test("file enumeration: every year in usableDays gets both utilities, even one with no episodes", () => {
  const usableDays = new Set(["2024-01-01", "2025-01-01"]);
  const svgs = renderEpisodeHeatmaps(
    [inc("2024-01-01T00:00:00", "2024-01-01T00:00:00")],
    usableDays,
  );

  assertEquals(
    [...svgs.keys()].sort(),
    [
      "images/episodes-acc-2024.svg",
      "images/episodes-acc-2025.svg",
      "images/episodes-inc-2024.svg",
      "images/episodes-inc-2025.svg",
    ],
  );
});

Deno.test("empty usableDays yields an empty map", () => {
  const svgs = renderEpisodeHeatmaps(
    [inc("2024-01-01T00:00:00", "2024-01-01T00:00:00")],
    new Set(),
  );
  assertEquals(svgs.size, 0);
});

Deno.test("renderEpisodeHeatmaps is byte-identical to the golden fixture", async () => {
  const usableDays = usableDaysRange("2024-01-01", "2024-01-31");
  usableDays.delete("2024-01-05");

  const episodes: EpisodeSpan[] = [
    inc("2024-01-02T08:00:00", "2024-01-04T20:00:00"),
    inc("2024-01-02T09:00:00", "2024-01-02T21:00:00"),
    inc("2024-01-04T06:00:00", "2024-01-06T12:00:00"),
  ];

  const svgs = renderEpisodeHeatmaps(episodes, usableDays);
  const expected = await Deno.readTextFile(
    new URL("./testdata/episodes-inc-2024-fixture.svg", import.meta.url),
  );
  assertEquals(svgs.get("images/episodes-inc-2024.svg"), expected);
});
