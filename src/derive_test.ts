import { assertEquals, assertThrows } from "@std/assert";
import {
  CAUSE_HEADER,
  CAUSES_DIR,
  deriveDatasets,
  ESTIMATE_HEADER,
  ESTIMATES_DIR,
  type FoundationSnapshot,
  foundationSnapshots,
  INCIDENT_HEADER,
  INCIDENTS_DIR,
  type KeyObservation,
  type MonthContent,
} from "./derive.ts";

// --- small builders ---

function obs(over: Partial<KeyObservation> = {}): KeyObservation {
  return {
    sector: "1",
    pt_name: "PT A",
    service: "Oprire ACC",
    estimated_restore: "2026-01-01T12:00",
    cause: "Remediere avarie",
    ...over,
  };
}

function ok(ts: string, observations: KeyObservation[] = [obs()]): FoundationSnapshot {
  return { ts, status: "ok", observations };
}

function empty(ts: string): FoundationSnapshot {
  return { ts, status: "empty", observations: [] };
}

function errored(ts: string): FoundationSnapshot {
  return { ts, status: "error", observations: [] };
}

function parseError(ts: string): FoundationSnapshot {
  return { ts, status: "parse_error", observations: [] };
}

function lines(content: string | undefined): string[] {
  if (content === undefined) return [];
  return content.split("\n").filter((l) => l !== "");
}

function incidentRows(files: Map<string, string>, month: string): string[] {
  return lines(files.get(`${INCIDENTS_DIR}/${month}.csv`)).slice(1);
}

function estimateRows(files: Map<string, string>, month: string): string[] {
  return lines(files.get(`${ESTIMATES_DIR}/${month}.csv`)).slice(1);
}

function causeRows(files: Map<string, string>, month: string): string[] {
  return lines(files.get(`${CAUSES_DIR}/${month}.csv`)).slice(1);
}

// --- lifecycle ---

Deno.test("strict close: present then absent on an ok page closes the incident", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T00:15:00", []),
  ]);

  const rows = incidentRows(files, "2026-01");
  assertEquals(rows.length, 1);
  const [, sector, pt_name, service, firstSeen, lastSeen, firstAbsent, present] = rows[0].split(
    ",",
  );
  assertEquals(sector, "1");
  assertEquals(pt_name, "PT A");
  assertEquals(service, "Oprire ACC");
  assertEquals(firstSeen, "2026-01-01T00:00:00");
  assertEquals(lastSeen, "2026-01-01T00:00:00");
  assertEquals(firstAbsent, "2026-01-01T00:15:00");
  assertEquals(present, "1");
});

Deno.test("reappearance after a close is a brand-new incident with a different id", async () => {
  const { files, stats } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T00:15:00", []),
    ok("2026-01-01T00:30:00"),
  ]);

  assertEquals(stats.incidents, 2);
  const rows = incidentRows(files, "2026-01");
  assertEquals(rows.length, 2);
  const id1 = rows[0].split(",")[0];
  const id2 = rows[1].split(",")[0];
  assertEquals(id1 === id2, false);
  assertEquals(rows[1].includes("2026-01-01T00:30:00"), true);
});

Deno.test("error-status snapshots are not evidence of absence: one incident spans across it", async () => {
  const { files, stats } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    errored("2026-01-01T00:15:00"),
    ok("2026-01-01T00:30:00"),
  ]);

  assertEquals(stats.incidents, 1);
  const rows = incidentRows(files, "2026-01");
  assertEquals(rows.length, 1);
  const [, , , , firstSeen, lastSeen, firstAbsent, present] = rows[0].split(",");
  assertEquals(firstSeen, "2026-01-01T00:00:00");
  assertEquals(lastSeen, "2026-01-01T00:30:00");
  assertEquals(firstAbsent, ""); // still open
  assertEquals(present, "2");
  // the error ts appears nowhere in the incident's bracket
  assertEquals(rows[0].includes("2026-01-01T00:15:00"), false);
});

Deno.test("parse_error snapshots are not evidence of absence either", async () => {
  const { files, stats } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    parseError("2026-01-01T00:15:00"),
    ok("2026-01-01T00:30:00"),
  ]);

  assertEquals(stats.incidents, 1);
  const rows = incidentRows(files, "2026-01");
  assertEquals(rows.length, 1);
  const [, , , , , lastSeen, firstAbsent, present] = rows[0].split(",");
  assertEquals(lastSeen, "2026-01-01T00:30:00");
  assertEquals(firstAbsent, "");
  assertEquals(present, "2");
});

Deno.test("an empty page closes every open incident with first_absent_ts = the empty snapshot's ts", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ pt_name: "PT A" }), obs({ pt_name: "PT B" })]),
    empty("2026-01-01T00:15:00"),
  ]);

  const rows = incidentRows(files, "2026-01");
  assertEquals(rows.length, 2);
  for (const row of rows) {
    assertEquals(row.split(",")[6], "2026-01-01T00:15:00");
  }
});

Deno.test("an incident still open at the end of input renders first_absent_ts as an empty field", async () => {
  const { files } = await deriveDatasets([ok("2026-01-01T00:00:00")]);

  const row = incidentRows(files, "2026-01")[0];
  const fields = row.split(",");
  assertEquals(fields[6], "");
  assertEquals(fields[7], "1");
});

Deno.test("within-snapshot collision alone: one incident, snapshots_present 1, two overlapping estimate runs", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ estimated_restore: "2026-01-01T10:00" }),
      obs({ estimated_restore: "2026-01-01T11:00" }),
    ]),
  ]);

  const incRows = incidentRows(files, "2026-01");
  assertEquals(incRows.length, 1);
  assertEquals(incRows[0].split(",")[7], "1");
  assertEquals(estimateRows(files, "2026-01").length, 2);
});

Deno.test("within-snapshot collision: two rows sharing a key produce two overlapping estimate runs but one presence count", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ estimated_restore: "2026-01-01T10:00" }),
      obs({ estimated_restore: "2026-01-01T11:00" }),
    ]),
    ok("2026-01-01T00:15:00", [obs({ estimated_restore: "2026-01-01T10:00" })]),
  ]);

  const incRows = incidentRows(files, "2026-01");
  assertEquals(incRows.length, 1);
  // present in both snapshots, but the collision snapshot's duplicate rows count once
  assertEquals(incRows[0].split(",")[7], "2");

  const estRows = estimateRows(files, "2026-01");
  assertEquals(estRows.length, 2);
  const [firstEstimate, secondEstimate] = estRows;
  assertEquals(firstEstimate.includes("2026-01-01T10:00"), true);
  assertEquals(secondEstimate.includes("2026-01-01T11:00"), true);

  // the run that survives into the second snapshot extends...
  const survivorLastSeen = firstEstimate.split(",")[3];
  assertEquals(survivorLastSeen, "2026-01-01T00:15:00");
  // ...the run that drops out stays pinned at the collision snapshot's ts
  const droppedLastSeen = secondEstimate.split(",")[3];
  assertEquals(droppedLastSeen, "2026-01-01T00:00:00");
});

Deno.test("DST duplicate ts: key present only in the first of two identical-ts snapshots closes with first_absent_ts equal to last_seen_ts", async () => {
  const { files } = await deriveDatasets([
    ok("2025-10-26T03:30:00"),
    ok("2025-10-26T03:30:00", []),
  ]);

  const row = incidentRows(files, "2025-10")[0];
  const fields = row.split(",");
  assertEquals(fields[4], "2025-10-26T03:30:00"); // first_seen_ts
  assertEquals(fields[5], "2025-10-26T03:30:00"); // last_seen_ts
  assertEquals(fields[6], "2025-10-26T03:30:00"); // first_absent_ts
});

Deno.test("a service change at the same PT closes the old incident and opens a new one", async () => {
  const { stats, files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ service: "Deficienta ACC" })]),
    ok("2026-01-01T00:15:00", [obs({ service: "Deficienta ACC/INC" })]),
  ]);

  assertEquals(stats.incidents, 2);
  const rows = incidentRows(files, "2026-01");
  assertEquals(rows.length, 2);
  assertEquals(rows[0].includes("Deficienta ACC") && !rows[0].includes("Deficienta ACC/INC"), true);
  assertEquals(rows[1].includes("Deficienta ACC/INC"), true);
  // the first is closed (absent once the service changed), the second still open
  assertEquals(rows[0].split(",")[6], "2026-01-01T00:15:00");
  assertEquals(rows[1].split(",")[6], "");
});

Deno.test("keys that would collide under naive field concatenation stay distinct incidents", async () => {
  // sector "1" + pt_name "2 Test" vs sector "12" + pt_name " Test" concatenate to the same
  // string without a separator; both stay open across every snapshot since they're
  // distinct keys.
  const { stats } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ sector: "1", pt_name: "2 Test" }),
      obs({ sector: "12", pt_name: " Test" }),
    ]),
  ]);

  assertEquals(stats.incidents, 2);
});

Deno.test("a cause edit mid-incident produces two cause runs, every published variant present", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ cause: "Avarie retea primara" })]),
    ok("2026-01-01T00:15:00", [obs({ cause: "Remediere avarie" })]),
  ]);

  const rows = causeRows(files, "2026-01");
  assertEquals(rows.length, 2);
  assertEquals(rows.some((r) => r.includes("Avarie retea primara")), true);
  assertEquals(rows.some((r) => r.includes("Remediere avarie")), true);
});

Deno.test("Nedefinit (empty estimate string) produces a run row with an empty value field", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ estimated_restore: "" })]),
  ]);

  const row = estimateRows(files, "2026-01")[0];
  const fields = row.split(",");
  assertEquals(fields[1], ""); // estimated_restore column
});

Deno.test("month partitioning: an incident opened at month end keeps its row and runs in the opening month even if it's still present next month", async () => {
  const { files } = await deriveDatasets([
    ok("2022-01-31T23:00:00"),
    ok("2022-02-01T00:00:00"),
  ]);

  assertEquals(incidentRows(files, "2022-01").length, 1);
  assertEquals(estimateRows(files, "2022-01").length, 1);
  assertEquals(causeRows(files, "2022-01").length, 1);
  assertEquals(files.has(`${INCIDENTS_DIR}/2022-02.csv`), false);
  assertEquals(files.has(`${ESTIMATES_DIR}/2022-02.csv`), false);
  assertEquals(files.has(`${CAUSES_DIR}/2022-02.csv`), false);
});

Deno.test("deterministic: two runs over the same input produce byte-identical files", async () => {
  const input = () => [
    ok("2026-01-01T00:00:00", [obs({ pt_name: "PT A" }), obs({ pt_name: "PT B" })]),
    empty("2026-01-01T00:15:00"),
    ok("2026-01-01T00:30:00", [obs({ pt_name: "PT A" })]),
  ];

  const first = await deriveDatasets(input());
  const second = await deriveDatasets(input());

  assertEquals([...first.files.entries()].sort(), [...second.files.entries()].sort());
});

Deno.test("pinned incident id matches the precomputed SHA-1", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ sector: "1", pt_name: "PT A", service: "Oprire ACC" }),
    ]),
  ]);

  const row = incidentRows(files, "2026-01")[0];
  assertEquals(row.split(",")[0], "0870bf778399");
});

Deno.test("stats: counts snapshots, incidents, open incidents, runs, and months", async () => {
  const { stats } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ pt_name: "PT A" }), obs({ pt_name: "PT B" })]),
    empty("2026-01-01T00:15:00"),
    ok("2026-02-01T00:00:00", [obs({ pt_name: "PT C" })]),
  ]);

  assertEquals(stats.snapshots, 3);
  assertEquals(stats.incidents, 3);
  assertEquals(stats.openIncidents, 1); // PT C, still open
  assertEquals(stats.estimateRuns, 3);
  assertEquals(stats.causeRuns, 3);
  assertEquals(stats.months, 2);
});

// --- foundationSnapshots ---

function monthContent(over: Partial<MonthContent>): MonthContent {
  return {
    month: "2026-01",
    log: "snapshot_ts,status,observations\n",
    observations: "snapshot_ts,sector,pt_name,blocks,service,cause,estimated_restore,zone_raw\n",
    ...over,
  };
}

Deno.test("foundationSnapshots aligns a tiny synthetic month, including a quoted comma field", () => {
  const log = "snapshot_ts,status,observations\n" +
    "2026-01-01T00:00:00,ok,1\n";
  const observations =
    "snapshot_ts,sector,pt_name,blocks,service,cause,estimated_restore,zone_raw\n" +
    '2026-01-01T00:00:00,1,"PT A, Sector 1",3,Oprire ACC,Remediere avarie,2026-01-01T12:00,zone\n';

  const snaps = [...foundationSnapshots([monthContent({ log, observations })])];
  assertEquals(snaps.length, 1);
  assertEquals(snaps[0].ts, "2026-01-01T00:00:00");
  assertEquals(snaps[0].status, "ok");
  assertEquals(snaps[0].observations.length, 1);
  assertEquals(snaps[0].observations[0].pt_name, "PT A, Sector 1");
  assertEquals(snaps[0].observations[0].sector, "1");
  assertEquals(snaps[0].observations[0].service, "Oprire ACC");
  assertEquals(snaps[0].observations[0].cause, "Remediere avarie");
  assertEquals(snaps[0].observations[0].estimated_restore, "2026-01-01T12:00");
});

Deno.test("foundationSnapshots throws on a row-count misalignment", () => {
  const log = "snapshot_ts,status,observations\n2026-01-01T00:00:00,ok,2\n";
  const observations =
    "snapshot_ts,sector,pt_name,blocks,service,cause,estimated_restore,zone_raw\n" +
    "2026-01-01T00:00:00,1,PT A,3,Oprire ACC,Remediere avarie,2026-01-01T12:00,zone\n"; // only 1, log claims 2

  assertThrows(
    () => [...foundationSnapshots([monthContent({ log, observations })])],
    Error,
    "2026-01",
  );
});

Deno.test("foundationSnapshots throws on a ts mismatch between log and observations", () => {
  const log = "snapshot_ts,status,observations\n2026-01-01T00:00:00,ok,1\n";
  const observations =
    "snapshot_ts,sector,pt_name,blocks,service,cause,estimated_restore,zone_raw\n" +
    "2026-01-01T00:15:00,1,PT A,3,Oprire ACC,Remediere avarie,2026-01-01T12:00,zone\n"; // wrong ts

  assertThrows(
    () => [...foundationSnapshots([monthContent({ log, observations })])],
    Error,
    "2026-01",
  );
});

Deno.test("foundationSnapshots throws on a header mismatch", () => {
  const log = "snapshot_ts,status,WRONG_HEADER\n2026-01-01T00:00:00,ok,0\n";

  assertThrows(
    () => [...foundationSnapshots([monthContent({ log })])],
    Error,
    "2026-01",
  );
});

Deno.test("foundationSnapshots: error/parse_error/empty log rows yield snapshots with zero observations", () => {
  const log = "snapshot_ts,status,observations\n" +
    "2026-01-01T00:00:00,error,0\n" +
    "2026-01-01T00:15:00,parse_error,0\n" +
    "2026-01-01T00:30:00,empty,0\n";

  const snaps = [...foundationSnapshots([monthContent({ log })])];
  assertEquals(snaps.length, 3);
  for (const s of snaps) assertEquals(s.observations.length, 0);
  assertEquals(snaps.map((s) => s.status), ["error", "parse_error", "empty"]);
});

// header shape sanity, so a future column reorder gets caught here rather than downstream
Deno.test("headers match the spec exactly", () => {
  assertEquals(INCIDENT_HEADER, [
    "incident_id",
    "sector",
    "pt_name",
    "service",
    "first_seen_ts",
    "last_seen_ts",
    "first_absent_ts",
    "snapshots_present",
  ]);
  assertEquals(ESTIMATE_HEADER, [
    "incident_id",
    "estimated_restore",
    "first_seen_ts",
    "last_seen_ts",
  ]);
  assertEquals(CAUSE_HEADER, ["incident_id", "cause", "first_seen_ts", "last_seen_ts"]);
});
