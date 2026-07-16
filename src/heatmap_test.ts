import { assertEquals } from "@std/assert";
import { generateSVG, getYearsFromData } from "./heatmap.ts";

Deno.test("getYearsFromData returns distinct years newest-first", () => {
  const years = getYearsFromData({
    "2024-01-01": 1,
    "2024-06-15": 2,
    "2022-03-03": 1,
    "2026-12-31": 5,
  });
  assertEquals(years, [2026, 2024, 2022]);
});

Deno.test("generateSVG is byte-identical to the golden fixture", async () => {
  const data = { "2024-01-01": 3, "2024-01-02": 12, "2024-06-15": 40, "2024-12-31": 1 };
  const expected = await Deno.readTextFile(
    new URL("./testdata/heatmap-2024-fixture.svg", import.meta.url),
  );
  assertEquals(generateSVG(2024, data), expected);
});
