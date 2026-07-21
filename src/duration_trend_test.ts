import { assertEquals, assertStringIncludes } from "@std/assert";
import { type EpisodeDuration, monthlyDurations, renderDurationTrend } from "./duration_trend.ts";

const INC_COLOR = "#d95926";
const ACC_COLOR = "#3987e5";

// --- small builders ---

// n closed episodes begun in `month`, the i-th lasting hours[i].
function closed(utility: string, month: string, hours: number[]): EpisodeDuration[] {
  return hours.map((h) => {
    const first_seen_ts = `${month}-01T00:00:00`;
    const first_absent_ts = new Date(Date.parse(`${first_seen_ts}Z`) + h * 3600e3)
      .toISOString().slice(0, 19);
    return { utility, first_seen_ts, first_absent_ts };
  });
}

function hoursUpTo(n: number, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => (i + 1) * step);
}

Deno.test("monthlyDurations: a month with fewer than 100 closed episodes is not drawn", () => {
  const points = monthlyDurations([
    ...closed("ACC", "2026-03", hoursUpTo(99)),
    ...closed("ACC", "2026-04", hoursUpTo(100)),
  ]);

  assertEquals(points.map((p) => p.month), ["2026-04"]);
});

Deno.test("monthlyDurations: nearest-rank percentiles, bucketed by month begun and utility", () => {
  // Durations 1..n hours: nearest-rank p50 is the 50th value, p90 the 90th, p99 the 99th.
  const points = monthlyDurations([
    ...closed("ACC", "2026-03", hoursUpTo(100)),
    ...closed("INC", "2026-03", hoursUpTo(200)),
  ]);

  assertEquals(points, [
    { month: "2026-03", utility: "ACC", p50: 50, p90: 90, p99: 99, n: 100, provisional: false },
    { month: "2026-03", utility: "INC", p50: 100, p90: 180, p99: 198, n: 200, provisional: false },
  ]);
});

Deno.test("monthlyDurations: an open episode contributes nothing but marks its month provisional, per utility", () => {
  const open: EpisodeDuration = {
    utility: "ACC",
    first_seen_ts: "2026-03-20T10:00:00",
    first_absent_ts: null,
  };
  const points = monthlyDurations([
    ...closed("ACC", "2026-03", hoursUpTo(100)),
    ...closed("INC", "2026-03", hoursUpTo(100)),
    open,
  ]);

  assertEquals(points.map((p) => `${p.utility} ${p.provisional}`), ["ACC true", "INC false"]);
  assertEquals(points[0].n, 100);
});

Deno.test("monthlyDurations: open episodes alone draw no point", () => {
  const points = monthlyDurations([
    ...closed("ACC", "2026-03", hoursUpTo(100)),
    { utility: "ACC", first_seen_ts: "2026-04-01T10:00:00", first_absent_ts: null },
  ]);

  assertEquals(points.map((p) => p.month), ["2026-03"]);
});

Deno.test("render: settled markers are filled, provisional markers hollow, tooltips name the percentile", () => {
  const svg = renderDurationTrend([
    ...closed("ACC", "2026-02", hoursUpTo(100)),
    ...closed("ACC", "2026-03", hoursUpTo(100)),
    { utility: "ACC", first_seen_ts: "2026-03-20T10:00:00", first_absent_ts: null },
  ])!;

  assertStringIncludes(
    svg,
    `fill="${ACC_COLOR}"><title>2026-02: hot water p50 50h (100 episodes)</title>`,
  );
  assertStringIncludes(
    svg,
    `stroke="${ACC_COLOR}"><title>2026-03: hot water p50 50h (100 episodes, provisional)</title>`,
  );
});

Deno.test("render: a skipped month breaks each percentile line into separate runs", () => {
  const svg = renderDurationTrend([
    ...closed("INC", "2026-01", hoursUpTo(100)),
    ...closed("INC", "2026-02", hoursUpTo(100)),
    ...closed("INC", "2026-04", hoursUpTo(100)), // 2026-03 has nothing: a gap
    ...closed("INC", "2026-05", hoursUpTo(100)),
  ]);

  const p50Lines = svg!.match(new RegExp(`<polyline [^>]*stroke="${INC_COLOR}"`, "g")) ?? [];
  assertEquals(p50Lines.length, 2);
});

Deno.test("render: no drawable month yields null", () => {
  assertEquals(renderDurationTrend(closed("ACC", "2026-03", hoursUpTo(99))), null);
});

Deno.test("renderDurationTrend is byte-identical to the golden fixture", async () => {
  const svg = renderDurationTrend([
    ...closed("INC", "2026-01", hoursUpTo(100)),
    ...closed("INC", "2026-02", hoursUpTo(120, 1.5)),
    ...closed("ACC", "2026-02", hoursUpTo(150, 0.5)),
    ...closed("ACC", "2026-04", hoursUpTo(200, 2)), // 2026-03: a gap for both
    ...closed("INC", "2026-04", hoursUpTo(100, 3)),
    { utility: "INC", first_seen_ts: "2026-04-20T10:00:00", first_absent_ts: null },
  ]);

  const expected = await Deno.readTextFile(
    new URL("./testdata/duration-trend-fixture.svg", import.meta.url),
  );
  assertEquals(svg, expected);
});
