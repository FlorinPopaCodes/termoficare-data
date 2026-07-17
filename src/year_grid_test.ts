import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderYearGrid } from "./year_grid.ts";

Deno.test("no data is distinct from an explicit zero", () => {
  const svg = renderYearGrid(2024, {
    value: (date) => {
      if (date === "2024-03-01") return null;
      if (date === "2024-03-02") return 0;
      return 5;
    },
    color: (value) => {
      if (value === null) return "#nodata";
      if (value === 0) return "#zero";
      return "#some";
    },
    tooltip: (date, value) => `${date}=${value === null ? "none" : value}`,
    title: "test title",
    legend: { zeroColor: "#000000", gradientStops: ["#111111", "#222222"] },
  });

  assertStringIncludes(svg, `fill="#nodata" rx="2"><title>2024-03-01=none</title>`);
  assertStringIncludes(svg, `fill="#zero" rx="2"><title>2024-03-02=0</title>`);
});

Deno.test("caller-supplied color scale is honored, not a per-year min-max", () => {
  const svg = renderYearGrid(2024, {
    value: (date) => (date === "2024-07-04" ? 42 : 1),
    color: (value) => (value === 42 ? "#distinctive" : "#8b949e"),
    tooltip: (date, value) => `${date}: ${value}`,
    title: "test title",
    legend: { zeroColor: "#000000", gradientStops: ["#111111", "#222222"] },
  });

  assertStringIncludes(svg, `fill="#distinctive" rx="2"><title>2024-07-04: 42</title>`);
});

Deno.test("legend renders a noData swatch and label when configured", () => {
  const svg = renderYearGrid(2024, {
    value: () => 1,
    color: () => "#some",
    tooltip: (date, value) => `${date}: ${value}`,
    title: "test title",
    legend: {
      zeroColor: "#000000",
      gradientStops: ["#111111", "#222222"],
      noData: { color: "#484f58", label: "No data" },
    },
  });

  assertStringIncludes(svg, `class="legend">No data</text>`);
  assertStringIncludes(svg, `fill="#484f58" rx="2"/>`);
});

Deno.test("legend omits the noData swatch and label when not configured", () => {
  const svg = renderYearGrid(2024, {
    value: () => 1,
    color: () => "#some",
    tooltip: (date, value) => `${date}: ${value}`,
    title: "test title",
    legend: { zeroColor: "#000000", gradientStops: ["#111111", "#222222"] },
  });

  assertEquals(svg.includes("No data</text>"), false);
  assertEquals(svg.includes(`fill="#484f58" rx="2"/>`), false);
});
