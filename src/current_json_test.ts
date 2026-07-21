import { assertEquals, assertThrows } from "@std/assert";
import { toCurrentJson } from "./current_json.ts";
import { ACTIVE_EPISODES_PATH, parsePredictionContext, RATES_PATH } from "./on_time.ts";
import type { Observation, ParseResult } from "./parser.ts";
import { deriveDatasets } from "./derive.ts";

const RATE_HEADER_LINE = "level,sector,pt_name,cause_class,slip_bucket,hits,n\n";
const ACTIVE_HEADER_LINE = "episode_id,sector,pt_name,utility,slip_count\n";

function outage(over: Partial<Observation> = {}): Observation {
  return {
    snapshot_ts: "2026-07-21T10:00:00",
    sector: 1,
    pt_name: "PT A",
    blocks: 3,
    service: "Oprire ACC",
    cause: "Remediere avarie",
    estimated_restore: "2026-07-22T12:00",
    zone_raw: "• Str Exemplu - Nr.1",
    ...over,
  };
}

function result(observations: Observation[] = [outage()]): ParseResult {
  return { status: "ok", snapshot_ts: "2026-07-21T10:00:00", observations, error: null };
}

function context(rateLines: string[], activeLines: string[] = []) {
  return parsePredictionContext(
    RATE_HEADER_LINE + rateLines.map((l) => `${l}\n`).join(""),
    ACTIVE_HEADER_LINE + activeLines.map((l) => `${l}\n`).join(""),
  );
}

function firstOutage(json: string) {
  return JSON.parse(json).outages[0];
}

Deno.test("schema is version 2; without a prediction context the fields are omitted", () => {
  const json = toCurrentJson(result());
  const doc = JSON.parse(json);
  assertEquals(doc.schema_version, 2);
  assertEquals("on_time_probability" in doc.outages[0], false);
  assertEquals("basis_n" in doc.outages[0], false);
  assertEquals("basis_bucket" in doc.outages[0], false);
});

Deno.test("a thick PT bucket publishes the exact-match rate; a fresh outage conditions on slip 0", () => {
  const json = toCurrentJson(
    result(),
    context(["pt_cause_slip,1,PT A,breakdown,0,15,20"]),
  );

  const o = firstOutage(json);
  assertEquals(o.on_time_probability, 0.75);
  assertEquals(o.basis_n, 20);
  assertEquals(o.basis_bucket, "pt_cause_slip");
});

Deno.test("a thin PT bucket backs off to the sector level", () => {
  const json = toCurrentJson(
    result(),
    context([
      "pt_cause_slip,1,PT A,breakdown,0,14,19",
      "sector_cause_slip,1,,breakdown,0,10,20",
    ]),
  );

  const o = firstOutage(json);
  assertEquals(o.on_time_probability, 0.5);
  assertEquals(o.basis_n, 20);
  assertEquals(o.basis_bucket, "sector_cause_slip");
});

Deno.test("thin PT and sector buckets back off to cause x slip", () => {
  const json = toCurrentJson(
    result(),
    context([
      "pt_cause_slip,1,PT A,breakdown,0,1,2",
      "sector_cause_slip,1,,breakdown,0,3,4",
      "cause_slip,,,breakdown,0,30,40",
    ]),
  );

  const o = firstOutage(json);
  assertEquals(o.on_time_probability, 0.75);
  assertEquals(o.basis_n, 40);
  assertEquals(o.basis_bucket, "cause_slip");
});

Deno.test("the slip-alone level publishes at any basis size", () => {
  const json = toCurrentJson(result(), context(["slip,,,,0,1,3"]));

  const o = firstOutage(json);
  assertEquals(o.on_time_probability, 0.333);
  assertEquals(o.basis_n, 3);
  assertEquals(o.basis_bucket, "slip");
});

Deno.test("no rates for the claim's slip bucket at any level: fields omitted", () => {
  const json = toCurrentJson(result(), context([]));

  const o = firstOutage(json);
  assertEquals("on_time_probability" in o, false);
  assertEquals("basis_n" in o, false);
  assertEquals("basis_bucket" in o, false);
});

Deno.test("an estimate already past scraped_at is a settled 0, whatever the history says", () => {
  const json = toCurrentJson(
    result([outage({ estimated_restore: "2026-07-21T09:59" })]),
    context(["pt_cause_slip,1,PT A,breakdown,0,20,20"]),
  );

  const o = firstOutage(json);
  assertEquals(o.on_time_probability, 0);
  assertEquals(o.basis_n, 0);
  assertEquals(o.basis_bucket, "overdue");
});

Deno.test("a deadline exactly at scraped_at is not yet overdue", () => {
  const json = toCurrentJson(
    result([outage({ estimated_restore: "2026-07-21T10:00" })]),
    context(["slip,,,,0,1,3"]),
  );

  assertEquals(firstOutage(json).basis_bucket, "slip");
});

Deno.test("no posted estimate (Nedefinit): fields omitted even with a thick context", () => {
  const json = toCurrentJson(
    result([outage({ estimated_restore: null })]),
    context(["pt_cause_slip,1,PT A,breakdown,0,20,20", "slip,,,,0,1,3"]),
  );

  assertEquals("on_time_probability" in firstOutage(json), false);
});

Deno.test("the active-episode index supplies the slip count", () => {
  const json = toCurrentJson(
    result(),
    context(
      [
        "pt_cause_slip,1,PT A,breakdown,0,20,20",
        "pt_cause_slip,1,PT A,breakdown,2,5,25",
      ],
      ["e1,1,PT A,ACC,2"],
    ),
  );

  const o = firstOutage(json);
  assertEquals(o.on_time_probability, 0.2);
  assertEquals(o.basis_n, 25);
});

Deno.test("slip counts of 3 and beyond join the 3+ bucket", () => {
  const json = toCurrentJson(
    result(),
    context(["pt_cause_slip,1,PT A,breakdown,3+,4,22"], ["e1,1,PT A,ACC,5"]),
  );

  assertEquals(firstOutage(json).on_time_probability, 0.182);
});

Deno.test("an ACC/INC row inherits the worse slip count of its two episodes", () => {
  const json = toCurrentJson(
    result([outage({ service: "Oprire ACC/INC" })]),
    context(
      [
        "pt_cause_slip,1,PT A,breakdown,0,20,20",
        "pt_cause_slip,1,PT A,breakdown,2,5,25",
      ],
      ["e1,1,PT A,ACC,0", "e2,1,PT A,INC,2"],
    ),
  );

  assertEquals(firstOutage(json).on_time_probability, 0.2);
});

Deno.test("an unrecognized service string degrades to slip 0 instead of breaking the scrape", () => {
  const json = toCurrentJson(
    result([outage({ service: "Ceva Nou" })]),
    context(["slip,,,,0,10,20"], ["e1,1,PT A,ACC,2"]),
  );

  assertEquals(firstOutage(json).on_time_probability, 0.5);
});

Deno.test("the scrape-time cause is classed by the shared taxonomy, diacritics included", () => {
  const json = toCurrentJson(
    result([outage({ cause: "Lucrări de modernizare RTP" })]),
    context([
      "pt_cause_slip,1,PT A,breakdown,0,1,20",
      "pt_cause_slip,1,PT A,planned_works,0,18,24",
    ]),
  );

  const o = firstOutage(json);
  assertEquals(o.on_time_probability, 0.75);
  assertEquals(o.basis_n, 24);
});

Deno.test("prediction fields sit between estimated_restore and zone_raw, and output is byte-deterministic", () => {
  const ctx = () => context(["pt_cause_slip,1,PT A,breakdown,0,15,20"]);

  const first = toCurrentJson(result(), ctx());
  const second = toCurrentJson(result(), ctx());

  assertEquals(first, second);
  assertEquals(Object.keys(firstOutage(first)), [
    "sector",
    "pt_name",
    "blocks",
    "service",
    "cause",
    "estimated_restore",
    "on_time_probability",
    "basis_n",
    "basis_bucket",
    "zone_raw",
  ]);
});

Deno.test("parsePredictionContext rejects files whose headers drifted", () => {
  assertThrows(
    () => parsePredictionContext("level,WRONG\nx,y\n", ACTIVE_HEADER_LINE),
    Error,
    "on_time_rates",
  );
  assertThrows(
    () => parsePredictionContext(RATE_HEADER_LINE, "episode_id,WRONG\nx,y\n"),
    Error,
    "active_episodes",
  );
});

Deno.test("round trip: the files deriveDatasets emits feed straight into toCurrentJson", async () => {
  const { files } = await deriveDatasets([
    {
      ts: "2026-07-20T00:00:00",
      status: "ok",
      observations: [{
        sector: "1",
        pt_name: "PT A",
        service: "Oprire ACC",
        cause: "Remediere avarie",
        estimated_restore: "2026-07-20T06:00",
      }],
    },
    { ts: "2026-07-20T12:00:00", status: "ok", observations: [] },
  ]);

  const ctx = parsePredictionContext(
    files.get(RATES_PATH)!,
    files.get(ACTIVE_EPISODES_PATH)!,
  );
  const o = firstOutage(toCurrentJson(result(), ctx));

  // one scored estimate, a miss, thin everywhere -> the slip-alone level publishes it
  assertEquals(o.on_time_probability, 0);
  assertEquals(o.basis_n, 1);
  assertEquals(o.basis_bucket, "slip");
});
