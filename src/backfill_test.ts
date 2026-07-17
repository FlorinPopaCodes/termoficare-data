import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { type Observation, type ParseResult } from "./parser.ts";
import { buildArtifacts, type SnapshotArtifacts } from "./snapshot.ts";
import {
  buildDataset,
  type Catalog,
  type Dataset,
  type SnapshotInput,
  validate,
} from "./backfill.ts";

// A catalog small enough to satisfy in a test; the real one is cross-checked against
// half a million rows.
const CATALOG: Catalog = {
  cutoff: "2026-07-15",
  errors: 1,
  empty: 1,
  emptyTolerance: 0,
  minObservations: 1,
  parseErrors: 0,
};

function observation(over: Partial<Observation> = {}): Observation {
  return {
    snapshot_ts: "ignored -- buildArtifacts reads the row's own fields",
    sector: 1,
    pt_name: "PT TEST",
    blocks: 3,
    service: "Oprire ACC",
    cause: "Remediere avarie",
    estimated_restore: "2026-01-01T12:00",
    zone_raw: "• Str Test - bl. 1",
    ...over,
  };
}

// Goes through the real buildArtifacts + CSV formatting; only the parse step is faked,
// via the Parser seam.
function input(instant: number, ts: string, over: Partial<ParseResult> = {}): SnapshotInput {
  const result: ParseResult = {
    status: "ok",
    snapshot_ts: ts,
    observations: [],
    error: null,
    ...over,
  };
  return { instant, ts, artifacts: buildArtifacts("<ignored>", ts, () => result) };
}

function ok(instant: number, ts: string, rows: number): SnapshotInput {
  const observations = Array.from({ length: rows }, () => observation({ snapshot_ts: ts }));
  return input(instant, ts, { status: "ok", observations });
}

async function* stream(inputs: SnapshotInput[]): AsyncGenerator<SnapshotInput> {
  for (const i of inputs) yield i;
}

function build(inputs: SnapshotInput[]): Promise<Dataset> {
  return buildDataset(stream(inputs), CATALOG);
}

function lines(content: string): string[] {
  return content.split("\n").filter((l) => l !== "");
}

Deno.test("routes rows into the month named by snapshot_ts", async () => {
  const dataset = await build([
    ok(1, "2022-01-31T23:59:59", 1),
    ok(2, "2022-02-01T00:00:01", 2),
  ]);

  assertEquals(lines(dataset.files.get("data/observations/2022-01.csv")!).length, 1 + 1);
  assertEquals(lines(dataset.files.get("data/observations/2022-02.csv")!).length, 1 + 2);
});

Deno.test("writes each month's header exactly once, at the top", async () => {
  const dataset = await build([ok(1, "2022-01-01T00:00:00", 2), ok(2, "2022-01-02T00:00:00", 2)]);

  const content = dataset.files.get("data/observations/2022-01.csv")!;
  assert(content.startsWith("snapshot_ts,sector,pt_name,blocks,service,cause"));
  assertEquals(lines(content).filter((l) => l.startsWith("snapshot_ts,")).length, 1);
  assertEquals(lines(content).length, 1 + 4);
});

Deno.test("a month of only empty snapshots still gets a header-only observations file", async () => {
  const dataset = await build([
    input(1, "2025-01-01T00:00:00", { status: "empty" }),
    input(2, "2025-01-01T00:15:00", { status: "empty" }),
  ]);

  assertEquals(
    dataset.files.get("data/observations/2025-01.csv"),
    "snapshot_ts,sector,pt_name,blocks,service,cause,estimated_restore,zone_raw\n",
  );
  assertEquals(lines(dataset.files.get("data/snapshots/2025-01.csv")!).length, 1 + 2);
});

Deno.test("logs one row per snapshot regardless of status", async () => {
  const dataset = await build([
    ok(1, "2022-01-01T00:00:00", 2),
    input(2, "2022-01-01T00:15:00", { status: "empty" }),
    input(3, "2022-01-01T00:30:00", { status: "error" }),
    input(4, "2022-01-01T00:45:00", { status: "parse_error", error: "boom" }),
  ]);

  assertEquals(lines(dataset.files.get("data/snapshots/2022-01.csv")!), [
    "snapshot_ts,status,observations",
    "2022-01-01T00:00:00,ok,2",
    "2022-01-01T00:15:00,empty,0",
    "2022-01-01T00:30:00,error,0",
    "2022-01-01T00:45:00,parse_error,0",
  ]);
  assertEquals(dataset.stats.snapshots, 4);
  assertEquals(dataset.stats.statusCounts, { ok: 1, empty: 1, error: 1, parse_error: 1 });
});

Deno.test("appends rows in stream order -- physical file order is the chronology", async () => {
  // The DST fall-back repeats a wall-clock hour: same ts, later instant, order preserved.
  const dataset = await build([
    input(100, "2025-10-26T03:30:00", {
      observations: [observation({ snapshot_ts: "2025-10-26T03:30:00", pt_name: "FIRST" })],
    }),
    input(3700, "2025-10-26T03:30:00", {
      observations: [observation({ snapshot_ts: "2025-10-26T03:30:00", pt_name: "SECOND" })],
    }),
  ]);

  const rows = lines(dataset.files.get("data/observations/2025-10.csv")!).slice(1);
  assertStringIncludes(rows[0], "FIRST");
  assertStringIncludes(rows[1], "SECOND");
  assertEquals(dataset.stats.outOfOrder, []);
});

Deno.test("renders Nedefinit as an empty CSV field", async () => {
  const dataset = await build([
    input(1, "2022-02-15T12:00:01", {
      observations: [
        observation({ snapshot_ts: "2022-02-15T12:00:01", estimated_restore: null }),
      ],
    }),
  ]);

  const row = lines(dataset.files.get("data/observations/2022-02.csv")!)[1];
  assertStringIncludes(row, "Remediere avarie,,• Str Test - bl. 1");
});

Deno.test("is deterministic -- same history, byte-identical files", async () => {
  const inputs = () => [ok(1, "2022-01-01T00:00:00", 3), ok(2, "2022-02-01T00:00:00", 2)];

  const first = await build(inputs());
  const second = await build(inputs());

  assertEquals([...first.files.entries()].sort(), [...second.files.entries()].sort());
});

Deno.test("counts only in-window snapshots against the catalog", async () => {
  const dataset = await build([
    input(1, "2026-07-15T23:59:59", { status: "error" }),
    input(2, "2026-07-16T00:00:00", { status: "error" }), // past the catalog's cutoff
  ]);

  assertEquals(dataset.stats.statusCounts.error, 2);
  assertEquals(dataset.stats.window.errors, 1);
});

// --- validation gates ---

function healthy(): Promise<Dataset> {
  return build([
    ok(1, "2022-01-01T00:00:00", 2),
    input(2, "2022-01-01T00:15:00", { status: "empty" }),
    input(3, "2022-01-01T00:30:00", { status: "error" }),
  ]);
}

function check(dataset: Dataset, over: Partial<Parameters<typeof validate>[0]> = {}) {
  return validate(
    { dataset, expectedSnapshots: dataset.stats.snapshots, captured: new Map(), ...over },
    CATALOG,
  );
}

Deno.test("validate passes a healthy dataset", async () => {
  assertEquals(check(await healthy(), { captured: spotArtifacts() }), []);
});

Deno.test("validate catches a snapshot dropped between rev-list and the log", async () => {
  const failures = check(await healthy(), { expectedSnapshots: 4, captured: spotArtifacts() });
  assertEquals(failures.length, 1);
  assertStringIncludes(failures[0], "4");
});

Deno.test("validate catches a non-ok snapshot that emitted observation rows", async () => {
  const dataset = await build([
    input(1, "2022-01-01T00:00:00", {
      status: "empty",
      observations: [observation({ snapshot_ts: "2022-01-01T00:00:00" })],
    }),
  ]);

  assertStringIncludes(
    check(dataset, { captured: spotArtifacts() }).join("\n"),
    "zero observation",
  );
});

Deno.test("validate catches history that runs backwards", async () => {
  const dataset = await build([ok(9, "2022-01-02T00:00:00", 1), ok(1, "2022-01-01T00:00:00", 1)]);

  assertStringIncludes(check(dataset, { captured: spotArtifacts() }).join("\n"), "order");
});

Deno.test("validate catches a catalog mismatch on the error count", async () => {
  const dataset = await build([ok(1, "2022-01-01T00:00:00", 2)]); // zero errors, catalog wants 1

  assertStringIncludes(check(dataset, { captured: spotArtifacts() }).join("\n"), "error scrapes");
});

Deno.test("validate catches an observation total below the catalog floor", async () => {
  const dataset = await build([
    input(1, "2022-01-01T00:00:00", { status: "empty" }),
    input(2, "2022-01-01T00:30:00", { status: "error" }),
  ]);

  assertStringIncludes(check(dataset, { captured: spotArtifacts() }).join("\n"), "observations");
});

// The observation floor clears reality by 4.6x, so it would not notice most of the
// history rotting; this is the gate that actually catches a parser regression.
Deno.test("validate catches a parser regression against history it used to read", async () => {
  const dataset = await build([
    ok(1, "2022-01-01T00:00:00", 2),
    input(2, "2022-01-01T00:15:00", { status: "empty" }),
    input(3, "2022-01-01T00:30:00", { status: "error" }),
    input(4, "2022-01-01T00:45:00", { status: "parse_error", error: "markup drifted" }),
  ]);

  assertStringIncludes(check(dataset, { captured: spotArtifacts() }).join("\n"), "failed to parse");
});

// A page CMTEB mangles after the cutoff is a fact about their HTML, not a regression in
// ours, and must not wedge every future regeneration.
Deno.test("validate tolerates a parse_error past the catalog's cutoff", async () => {
  const dataset = await build([
    ok(1, "2022-01-01T00:00:00", 2),
    input(2, "2022-01-01T00:15:00", { status: "empty" }),
    input(3, "2022-01-01T00:30:00", { status: "error" }),
    input(4, "2026-07-16T00:00:00", { status: "parse_error", error: "markup drifted" }),
  ]);

  assertEquals(check(dataset, { captured: spotArtifacts() }), []);
});

Deno.test("validate catches a month whose file went missing", async () => {
  const dataset = await healthy();
  dataset.files.delete("data/observations/2022-01.csv");

  assertStringIncludes(
    check(dataset, { captured: spotArtifacts() }).join("\n"),
    "no observations file",
  );
});

// The spot-check SHAs are pinned in backfill.ts; a run that never fetched them must fail
// rather than quietly skip the checks.
Deno.test("validate catches a spot-check snapshot that was never captured", async () => {
  assertStringIncludes(check(await healthy()).join("\n"), "not captured");
});

function spotArtifacts(): Map<string, SnapshotArtifacts> {
  const captured = new Map<string, SnapshotArtifacts>();
  const artifacts = (ts: string, observations: Observation[]) =>
    buildArtifacts("<ignored>", ts, () => ({
      status: "ok",
      snapshot_ts: ts,
      observations,
      error: null,
    }));

  captured.set(
    "20e267f80181f8438b0f8c17aa97b5a0400d60e0",
    artifacts(
      "2023-08-03T19:00:01",
      Array.from({ length: 518 }, () => observation({ snapshot_ts: "2023-08-03T19:00:01" })),
    ),
  );
  captured.set(
    "eb87d333c5f2f0dc355cde108230c211d32470f6",
    artifacts("2022-02-15T12:00:01", [
      observation({ snapshot_ts: "2022-02-15T12:00:01", estimated_restore: null }),
    ]),
  );
  captured.set(
    "e1ef8331f9f905f8cc1f7935ffccfe4d5a62844c",
    artifacts("2026-02-06T09:32:38", [
      observation({ snapshot_ts: "2026-02-06T09:32:38", blocks: -6 }),
    ]),
  );
  return captured;
}

Deno.test("validate catches a spot-check snapshot whose shape drifted", async () => {
  const captured = spotArtifacts();
  captured.set(
    "e1ef8331f9f905f8cc1f7935ffccfe4d5a62844c",
    buildArtifacts("<x>", "2026-02-06T09:32:38", () => ({
      status: "ok",
      snapshot_ts: "2026-02-06T09:32:38",
      observations: [observation({ snapshot_ts: "2026-02-06T09:32:38", blocks: 6 })], // no longer negative
      error: null,
    })),
  );

  assertStringIncludes(check(await healthy(), { captured }).join("\n"), "negative");
});
