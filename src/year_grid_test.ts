import { assertStringIncludes } from "@std/assert";
import { renderYearGrid } from "./year_grid.ts";

Deno.test("no data is distinct from an explicit zero", () => {
  const svg = renderYearGrid(
    2024,
    new Map(),
    new Set(["2024-03-02"]),
    { min: 1, max: 5 },
    "test title",
  );

  assertStringIncludes(svg, `fill="#484f58" rx="2"><title>2024-03-01: no data</title>`);
  assertStringIncludes(svg, `fill="#161b22" rx="2"><title>2024-03-02: 0 active episodes</title>`);
});

Deno.test("the supplied color range is honored, not a per-year min-max", () => {
  const counts = new Map([["2024-07-04", 42]]);
  const svg = renderYearGrid(2024, counts, new Set(), { min: 42, max: 100 }, "test title");

  // 42 is the supplied minimum (lightest), even though it is this year's maximum.
  assertStringIncludes(svg, `fill="#fef0d9" rx="2"><title>2024-07-04: 42 active episodes</title>`);
});

Deno.test("legend distinguishes unknown days from zero and positive counts", () => {
  const svg = renderYearGrid(2024, new Map(), new Set(), { min: 1, max: 1 }, "test title");

  assertStringIncludes(svg, `class="legend">No data</text>`);
  assertStringIncludes(svg, `fill="#484f58" rx="2"/>`);
  assertStringIncludes(svg, `fill="#161b22" rx="2"/>`);
  assertStringIncludes(svg, `fill="url(#legend-gradient)" rx="2"/>`);
});
