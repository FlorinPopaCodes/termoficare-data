import { assertEquals, assertStringIncludes } from "@std/assert";
import { type EstimateScore, monthlyTrend, renderOnTimeTrend } from "./on_time_trend.ts";

const INC_COLOR = "#d95926";
const ACC_COLOR = "#3987e5";

// --- small builders ---

function score(over: Partial<EstimateScore> = {}): EstimateScore {
  return { utility: "ACC", posted_ts: "2026-03-05T08:00:00", hit: true, ...over };
}

// n scores in one utility+month, the first `hits` of them hits.
function scores(utility: string, month: string, hits: number, n: number): EstimateScore[] {
  return Array.from({ length: n }, (_, i) =>
    score({
      utility,
      posted_ts: `${month}-10T0${i % 10}:00:00`,
      hit: i < hits,
    }));
}

Deno.test("monthlyTrend: a month with fewer than MIN_BASIS scored estimates is not drawn", () => {
  const points = monthlyTrend(
    [...scores("ACC", "2026-03", 10, 19), ...scores("ACC", "2026-04", 10, 20)],
    [],
  );

  assertEquals(points.map((p) => p.month), ["2026-04"]);
});

Deno.test("monthlyTrend: a pending estimate marks its posting month provisional, per utility", () => {
  const points = monthlyTrend(
    [...scores("ACC", "2026-03", 12, 20), ...scores("INC", "2026-03", 20, 25)],
    [{ utility: "ACC", posted_ts: "2026-03-20T10:00:00" }],
  );

  assertEquals(points.map((p) => `${p.utility} ${p.provisional}`), ["ACC true", "INC false"]);
});

Deno.test("monthlyTrend: pending estimates alone draw no point", () => {
  const points = monthlyTrend(
    scores("ACC", "2026-03", 12, 20),
    [{ utility: "ACC", posted_ts: "2026-04-01T10:00:00" }],
  );

  assertEquals(points.map((p) => p.month), ["2026-03"]);
});

Deno.test("monthlyTrend: scores bucket by posting month and utility", () => {
  const points = monthlyTrend(
    [...scores("ACC", "2026-03", 12, 20), ...scores("INC", "2026-03", 20, 25)],
    [],
  );

  assertEquals(points, [
    { month: "2026-03", utility: "ACC", rate: 0.6, n: 20, provisional: false },
    { month: "2026-03", utility: "INC", rate: 0.8, n: 25, provisional: false },
  ]);
});

Deno.test("render: settled points are filled, provisional points are hollow, tooltips name both", () => {
  const svg = renderOnTimeTrend(
    [...scores("ACC", "2026-02", 12, 20), ...scores("ACC", "2026-03", 18, 24)],
    [{ utility: "ACC", posted_ts: "2026-03-20T10:00:00" }],
  )!;

  assertStringIncludes(
    svg,
    `fill="${ACC_COLOR}"><title>2026-02: hot water 60% on time (20 estimates)</title>`,
  );
  assertStringIncludes(
    svg,
    `stroke="${ACC_COLOR}"><title>2026-03: hot water 75% on time (24 estimates, provisional)</title>`,
  );
});

Deno.test("render: a skipped month breaks the line into separate runs", () => {
  const svg = renderOnTimeTrend(
    [
      ...scores("INC", "2026-01", 10, 20),
      ...scores("INC", "2026-02", 10, 20),
      ...scores("INC", "2026-04", 10, 20), // 2026-03 has nothing: a gap
      ...scores("INC", "2026-05", 10, 20),
    ],
    [],
  );

  const polylines = svg!.match(new RegExp(`<polyline [^>]*stroke="${INC_COLOR}"`, "g")) ?? [];
  assertEquals(polylines.length, 2);
});

Deno.test("render: no drawable month yields null", () => {
  assertEquals(renderOnTimeTrend(scores("ACC", "2026-03", 5, 19), []), null);
});

Deno.test("renderOnTimeTrend is byte-identical to the golden fixture", async () => {
  const svg = renderOnTimeTrend(
    [
      ...scores("INC", "2026-01", 10, 20),
      ...scores("INC", "2026-02", 14, 20),
      ...scores("ACC", "2026-02", 15, 20),
      ...scores("ACC", "2026-04", 18, 24), // 2026-03: a gap for both
      ...scores("INC", "2026-04", 12, 20),
    ],
    [{ utility: "INC", posted_ts: "2026-04-20T10:00:00" }],
  );

  const expected = await Deno.readTextFile(
    new URL("./testdata/on-time-trend-fixture.svg", import.meta.url),
  );
  assertEquals(svg, expected);
});
