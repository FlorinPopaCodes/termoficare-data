import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CAUSE_HEADER,
  CAUSES_DIR,
  deriveDatasets,
  EPISODE_HEADER,
  EPISODE_INCIDENT_HEADER,
  EPISODE_INCIDENTS_DIR,
  EPISODES_DIR,
  ESTIMATE_HEADER,
  ESTIMATES_DIR,
  type FoundationSnapshot,
  foundationSnapshots,
  INCIDENT_HEADER,
  INCIDENTS_DIR,
  type KeyObservation,
  type MonthContent,
} from "./derive.ts";
import {
  ACTIVE_EPISODE_HEADER,
  ACTIVE_EPISODES_PATH,
  ESTIMATE_SCORE_HEADER,
  ESTIMATE_SCORES_DIR,
  RATE_HEADER,
  RATES_PATH,
} from "./on_time.ts";

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

function episodeRows(files: Map<string, string>, month: string): string[] {
  return lines(files.get(`${EPISODES_DIR}/${month}.csv`)).slice(1);
}

function episodeIncidentRows(files: Map<string, string>, month: string): string[] {
  return lines(files.get(`${EPISODE_INCIDENTS_DIR}/${month}.csv`)).slice(1);
}

function scoreRows(files: Map<string, string>, month: string): string[] {
  return lines(files.get(`${ESTIMATE_SCORES_DIR}/${month}.csv`)).slice(1);
}

function rateRows(files: Map<string, string>): string[] {
  return lines(files.get(RATES_PATH)).slice(1);
}

function activeRows(files: Map<string, string>): string[] {
  return lines(files.get(ACTIVE_EPISODES_PATH)).slice(1);
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
    ok("2026-01-01T00:00:00", [
      obs({ pt_name: "PT A" }),
      obs({ pt_name: "PT B", service: "Oprire ACC/INC" }),
    ]),
    empty("2026-01-01T00:15:00"),
    ok("2026-01-01T00:30:00", [obs({ pt_name: "PT A" })]),
    // Absence + reappearance within 24h, on top of the Oprire span above -- exercises a
    // bridged gap, not just the plain incident/estimate/cause machinery.
    ok("2026-01-01T00:45:00", []),
    ok("2026-01-01T01:30:00", [obs({ pt_name: "PT A" })]),
  ];

  const first = await deriveDatasets(input());
  const second = await deriveDatasets(input());

  assertEquals([...first.files.entries()].sort(), [...second.files.entries()].sort());

  // Guard the fixture itself: it exists to exercise episodes, so assert it actually does
  // (a bridged gap, and PT B's ACC/INC unpacking into two episodes) alongside the
  // byte-equality check above, so this can't silently rot back into an incidents-only test.
  const rows = episodeRows(first.files, "2026-01");
  assertEquals(rows.some((r) => Number(r.split(",")[8]) >= 1), true); // n_bridged_gaps
  const ptBUtilities = rows.filter((r) => r.split(",")[2] === "PT B").map((r) => r.split(",")[3]);
  assertEquals(ptBUtilities.sort(), ["ACC", "INC"]);
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
  assertEquals(EPISODE_HEADER, [
    "episode_id",
    "sector",
    "pt_name",
    "utility",
    "first_seen_ts",
    "last_seen_ts",
    "first_absent_ts",
    "n_incidents",
    "n_bridged_gaps",
    "bridged_seconds",
  ]);
  assertEquals(EPISODE_INCIDENT_HEADER, ["episode_id", "incident_id"]);
  assertEquals(ESTIMATE_SCORE_HEADER, [
    "episode_id",
    "sector",
    "pt_name",
    "utility",
    "cause_class",
    "slip_count",
    "estimated_restore",
    "posted_ts",
    "restored_ts",
    "hit",
  ]);
  assertEquals(RATE_HEADER, [
    "level",
    "sector",
    "pt_name",
    "cause_class",
    "slip_bucket",
    "hits",
    "n",
  ]);
  assertEquals(ACTIVE_EPISODE_HEADER, ["episode_id", "sector", "pt_name", "utility", "slip_count"]);
});

// --- episodes ---

Deno.test("episodes: an Oprire span bridges a gap under 24h through a Deficienta tail", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T01:00:00", []),
    ok("2026-01-01T20:00:00", [obs({ service: "Deficienta ACC" })]),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 1);
  const [, , , utility, firstSeen, lastSeen, firstAbsent, nIncidents, nBridged, bridgedSeconds] =
    rows[0].split(",");
  assertEquals(utility, "ACC");
  assertEquals(firstSeen, "2026-01-01T00:00:00");
  assertEquals(lastSeen, "2026-01-01T20:00:00");
  assertEquals(firstAbsent, ""); // still open
  assertEquals(nIncidents, "2");
  assertEquals(nBridged, "1");
  assertEquals(bridgedSeconds, "68400");
});

Deno.test("episodes: a gap over 24h closes the episode even after an Oprire span", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T01:00:00", []),
    ok("2026-01-02T02:00:00"),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 2);
  assertEquals(rows[0].split(",")[8], "0");
  assertEquals(rows[1].split(",")[8], "0");
});

Deno.test("episodes: a gap of exactly 24h bridges (inclusive boundary)", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T01:00:00", []),
    ok("2026-01-02T01:00:00"),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].split(",")[9], "86400");
});

Deno.test("episodes: a Deficienta-only span never bridges, even under 24h (nightly flapping)", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ service: "Deficienta ACC" })]),
    ok("2026-01-01T01:00:00", []),
    ok("2026-01-01T02:00:00", [obs({ service: "Deficienta ACC" })]),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 2);
});

Deno.test("episodes: a Deficienta tail bridged into the span does not itself re-bridge", async () => {
  const { files, stats } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T01:00:00", []),
    ok("2026-01-01T05:00:00", [obs({ service: "Deficienta ACC" })]),
    ok("2026-01-01T06:00:00", []),
    ok("2026-01-01T10:00:00", [obs({ service: "Deficienta ACC" })]),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 2);
  const [first, second] = rows;
  assertEquals(first.split(",")[7], "2"); // n_incidents
  assertEquals(first.split(",")[8], "1"); // n_bridged_gaps
  assertEquals(first.split(",")[9], "14400"); // bridged_seconds
  assertEquals(first.split(",")[6], "2026-01-01T06:00:00"); // first_absent_ts
  assertEquals(second.split(",")[7], "1");
  assertEquals(second.split(",")[6], ""); // still open

  assertEquals(stats.episodes, 2);
  assertEquals(stats.openEpisodes, 1);
  assertEquals(stats.bridgedGaps, 1);
});

Deno.test("episodes: an ACC/INC incident belongs to two episodes, one per utility", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ service: "Oprire ACC/INC" })]),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 2);
  const utilities = rows.map((r) => r.split(",")[3]).sort();
  assertEquals(utilities, ["ACC", "INC"]);
  for (const row of rows) assertEquals(row.split(",")[7], "1");

  const linkRows = episodeIncidentRows(files, "2026-01");
  assertEquals(linkRows.length, 2);
  const incidentIds = linkRows.map((r) => r.split(",")[1]);
  assertEquals(incidentIds[0], incidentIds[1]);
  const episodeIds = linkRows.map((r) => r.split(",")[0]);
  assertEquals(episodeIds[0] === episodeIds[1], false);
});

Deno.test("episodes: escalation from Deficienta ACC to ACC/INC heals the ACC episode by contiguity, not bridging", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ service: "Deficienta ACC" })]),
    ok("2026-01-01T00:15:00", [obs({ service: "Deficienta ACC/INC" })]),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 2);
  const accRow = rows.find((r) => r.split(",")[3] === "ACC")!;
  const incRow = rows.find((r) => r.split(",")[3] === "INC")!;
  assertEquals(accRow.split(",")[7], "2"); // n_incidents
  assertEquals(accRow.split(",")[8], "0"); // n_bridged_gaps -- healed by contiguity
  assertEquals(incRow.split(",")[7], "1");
});

Deno.test("episodes: bridged gaps accumulate and a bridged-in Oprire re-arms the bridge", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T01:00:00", []),
    ok("2026-01-01T03:00:00"),
    ok("2026-01-01T04:00:00", []),
    ok("2026-01-01T07:00:00", [obs({ service: "Deficienta ACC" })]),
    ok("2026-01-01T08:00:00", []),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 1);
  const [, , , , , , firstAbsent, nIncidents, nBridged, bridgedSeconds] = rows[0].split(",");
  assertEquals(nIncidents, "3");
  assertEquals(nBridged, "2");
  assertEquals(bridgedSeconds, "18000"); // 7200 + 10800
  assertEquals(firstAbsent, "2026-01-01T08:00:00");
});

Deno.test("episodes: concurrent same-utility incidents share a span, and an Oprire member infects it", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ service: "Deficienta ACC" }),
      obs({ service: "Oprire ACC" }),
    ]),
    ok("2026-01-01T00:15:00", []),
    ok("2026-01-01T01:00:00", [obs({ service: "Deficienta ACC" })]),
  ]);

  const rows = episodeRows(files, "2026-01");
  assertEquals(rows.length, 1);
  const [, , , , , , , nIncidents, nBridged, bridgedSeconds] = rows[0].split(",");
  assertEquals(nIncidents, "3");
  assertEquals(nBridged, "1");
  assertEquals(bridgedSeconds, "2700");
});

Deno.test("episodes: pinned episode id matches the precomputed SHA-1", async () => {
  const { files } = await deriveDatasets([ok("2026-01-01T00:00:00")]);

  const rows = episodeRows(files, "2026-01");
  const accRow = rows.find((r) => r.split(",")[3] === "ACC")!;
  assertEquals(accRow.split(",")[0], "e758de0ee995");
});

Deno.test("episodes: month partitioning follows the episode's first_seen_ts month, not each member's", async () => {
  const { files } = await deriveDatasets([
    ok("2022-01-31T23:00:00"),
    ok("2022-01-31T23:30:00", []),
    ok("2022-02-01T10:00:00", [obs({ service: "Deficienta ACC" })]),
  ]);

  // the bridge fuses the two incidents into one episode opened in January
  assertEquals(episodeRows(files, "2022-01").length, 1);
  assertEquals(episodeIncidentRows(files, "2022-01").length, 2);
  // February's bucket exists (its incident opened it) but gets no episode rows
  assertEquals(files.has(`${EPISODES_DIR}/2022-02.csv`), true);
  assertEquals(files.has(`${EPISODE_INCIDENTS_DIR}/2022-02.csv`), true);
  assertEquals(episodeRows(files, "2022-02").length, 0);
  assertEquals(episodeIncidentRows(files, "2022-02").length, 0);
});

Deno.test("episodes: an unrecognized service value throws, naming the value", async () => {
  await assertRejects(
    () => deriveDatasets([ok("2026-01-01T00:00:00", [obs({ service: "Ceva Nou" })])]),
    Error,
    "Ceva Nou",
  );
});

// --- usableDays / episodeSpans ---

Deno.test("usableDays collects ok and empty snapshot days but not an errored-only day", async () => {
  const { usableDays } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    errored("2026-01-02T00:00:00"),
    empty("2026-01-03T00:00:00"),
  ]);

  assertEquals([...usableDays].sort(), ["2026-01-01", "2026-01-03"]);
});

Deno.test("episodeSpans: an Oprire ACC incident seen at two ts then absent yields one span", async () => {
  const { episodeSpans } = await deriveDatasets([
    ok("2026-01-01T00:00:00"),
    ok("2026-01-01T00:15:00"),
    ok("2026-01-01T00:30:00", []),
  ]);

  assertEquals(episodeSpans, [
    { utility: "ACC", first_seen_ts: "2026-01-01T00:00:00", last_seen_ts: "2026-01-01T00:15:00" },
  ]);
});

Deno.test("episodeSpans: an Oprire ACC/INC incident yields two spans, one per utility", async () => {
  const { episodeSpans } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ service: "Oprire ACC/INC" })]),
  ]);

  const utilities = episodeSpans.map((s) => s.utility).sort();
  assertEquals(utilities, ["ACC", "INC"]);
  for (const span of episodeSpans) {
    assertEquals(span.first_seen_ts, "2026-01-01T00:00:00");
    assertEquals(span.last_seen_ts, "2026-01-01T00:00:00");
  }
});

// --- estimate scores / on-time rates / active-episode index ---

Deno.test("scoring: restoration observed exactly at the deadline is a hit", async () => {
  const { files, stats } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ estimated_restore: "2026-01-01T12:00" })]),
    ok("2026-01-01T12:00:00", []),
  ]);

  const rows = scoreRows(files, "2026-01");
  assertEquals(rows.length, 1);
  const fields = rows[0].split(",");
  assertEquals(fields.slice(1), [
    "1",
    "PT A",
    "ACC",
    "breakdown",
    "0",
    "2026-01-01T12:00",
    "2026-01-01T00:00:00",
    "2026-01-01T12:00:00",
    "1",
  ]);
  assertEquals(stats.scoredEstimates, 1);
});

Deno.test("scoring: restoration first observed after the deadline is a miss", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ estimated_restore: "2026-01-01T12:00" })]),
    ok("2026-01-01T12:15:00", []),
  ]);

  const fields = scoreRows(files, "2026-01")[0].split(",");
  assertEquals(fields[8], "2026-01-01T12:15:00"); // restored_ts
  assertEquals(fields[9], "0"); // hit
});

Deno.test("scoring: a superseded estimate scores as the miss it was, the successor on its own", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ estimated_restore: "2026-01-01T10:00" })]),
    ok("2026-01-01T00:15:00", [obs({ estimated_restore: "2026-01-01T23:00" })]),
    ok("2026-01-01T12:00:00", []),
  ]);

  const rows = scoreRows(files, "2026-01").map((r) => r.split(","));
  assertEquals(rows.length, 2);
  const [first, second] = rows;
  assertEquals(first[5], "0"); // slip_count
  assertEquals(first[6], "2026-01-01T10:00");
  assertEquals(first[7], "2026-01-01T00:00:00"); // posted_ts
  assertEquals(first[9], "0"); // superseded and blown: a miss
  assertEquals(second[5], "1");
  assertEquals(second[6], "2026-01-01T23:00");
  assertEquals(second[7], "2026-01-01T00:15:00");
  assertEquals(second[9], "1");
});

Deno.test("scoring: an episode never observed ended scores nothing and lands in the active index", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ estimated_restore: "2026-01-01T10:00" })]),
    ok("2026-01-01T00:15:00", [obs({ estimated_restore: "2026-01-01T23:00" })]),
  ]);

  assertEquals(scoreRows(files, "2026-01"), []);
  assertEquals(rateRows(files), []);
  const active = activeRows(files);
  assertEquals(active.length, 1);
  const fields = active[0].split(",");
  assertEquals(fields.slice(1), ["1", "PT A", "ACC", "1"]); // slip 1: one estimate superseded
});

Deno.test("scoring: blank estimates (Nedefinit) neither score nor advance the slip count", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ pt_name: "PT A", estimated_restore: "" }),
      obs({ pt_name: "PT B", estimated_restore: "" }),
    ]),
    ok("2026-01-01T00:15:00", [
      obs({ pt_name: "PT A", estimated_restore: "2026-01-02T10:00" }),
      obs({ pt_name: "PT B", estimated_restore: "" }),
    ]),
    ok("2026-01-01T12:00:00", []),
  ]);

  const rows = scoreRows(files, "2026-01").map((r) => r.split(","));
  assertEquals(rows.length, 1); // PT B never made a claim, so nothing to score
  assertEquals(rows[0][2], "PT A");
  assertEquals(rows[0][5], "0"); // the blank did not count as a first estimate
  assertEquals(rows[0][9], "1");
});

Deno.test("scoring: re-posting an earlier estimate value is not a new claim", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ estimated_restore: "2026-01-01T10:00" })]),
    ok("2026-01-01T00:15:00", [obs({ estimated_restore: "2026-01-01T23:00" })]),
    ok("2026-01-01T00:30:00", [obs({ estimated_restore: "2026-01-01T10:00" })]),
    ok("2026-01-01T12:00:00", []),
  ]);

  const rows = scoreRows(files, "2026-01").map((r) => r.split(","));
  assertEquals(rows.length, 2);
  assertEquals(rows.map((r) => r[6]), ["2026-01-01T10:00", "2026-01-01T23:00"]);
});

Deno.test("scoring: each posting is classed by the cause on the page when it appeared", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ cause: "Remediere avarie", estimated_restore: "2026-01-01T10:00" }),
    ]),
    ok("2026-01-01T00:15:00", [
      obs({ cause: "Lucrari de modernizare RTP", estimated_restore: "2026-01-01T23:00" }),
    ]),
    ok("2026-01-01T12:00:00", []),
  ]);

  const rows = scoreRows(files, "2026-01").map((r) => r.split(","));
  assertEquals(rows.map((r) => r[4]), ["breakdown", "planned_works"]);
});

Deno.test("scoring: the cause taxonomy is keyword-driven and diacritic-insensitive", async () => {
  const close = ok("2026-01-01T12:00:00", []);
  const causes: [string, string][] = [
    ["PT A", "Remediere avarie retea primara"],
    ["PT B", "Lipsă parametri furnizați de CET"],
    ["PT C", "Echilibrare hidraulică"],
    ["PT D", "Lucrari de modernizare RTP POIM"],
    ["PT E", "Manevre de golire instalatie"],
    ["PT F", "Surpare in carosabil"],
    ["PT G", "Lucrari de remediere avarie"], // breakdown outranks planned works
    ["PT H", "Parametrii insuficienti livrati de CTE SUD"],
  ];
  const { files } = await deriveDatasets([
    ok(
      "2026-01-01T00:00:00",
      causes.map(([pt_name, cause]) => obs({ pt_name, cause })),
    ),
    close,
  ]);

  const byPt = new Map(
    scoreRows(files, "2026-01").map((r) => {
      const fields = r.split(",");
      return [fields[2], fields[4]];
    }),
  );
  assertEquals(byPt.get("PT A"), "breakdown");
  assertEquals(byPt.get("PT B"), "missing_params");
  assertEquals(byPt.get("PT C"), "balancing");
  assertEquals(byPt.get("PT D"), "planned_works");
  assertEquals(byPt.get("PT E"), "maneuvers");
  assertEquals(byPt.get("PT F"), "other");
  assertEquals(byPt.get("PT G"), "breakdown");
  assertEquals(byPt.get("PT H"), "missing_params");
});

Deno.test("rates: one scored estimate lands in one bucket at every backoff level", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [obs({ estimated_restore: "2026-01-01T10:00" })]),
    ok("2026-01-01T12:00:00", []),
  ]);

  assertEquals(
    files.get(RATES_PATH),
    "level,sector,pt_name,cause_class,slip_bucket,hits,n\n" +
      "pt_cause_slip,1,PT A,breakdown,0,0,1\n" +
      "sector_cause_slip,1,,breakdown,0,0,1\n" +
      "cause_slip,,,breakdown,0,0,1\n" +
      "slip,,,,0,0,1\n",
  );
});

Deno.test("rates: coarser levels pool what the PT level keeps apart", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ pt_name: "PT A", estimated_restore: "2026-01-01T23:00" }), // hit
      obs({ pt_name: "PT B", estimated_restore: "2026-01-01T10:00" }), // miss
    ]),
    ok("2026-01-01T12:00:00", []),
  ]);

  const rows = rateRows(files).map((r) => r.split(","));
  const ptRows = rows.filter((r) => r[0] === "pt_cause_slip");
  assertEquals(ptRows.length, 2);
  for (const row of ptRows) assertEquals(row[6], "1");
  const sectorRow = rows.find((r) => r[0] === "sector_cause_slip")!;
  assertEquals(sectorRow.slice(5), ["1", "2"]); // 1 hit of 2
  const slipRow = rows.find((r) => r[0] === "slip")!;
  assertEquals(slipRow.slice(5), ["1", "2"]);
});

Deno.test("rates: slip counts of 3 and beyond share the 3+ bucket", async () => {
  const estimates = ["10:00", "11:00", "12:00", "13:00", "14:00"];
  const { files } = await deriveDatasets([
    ...estimates.map((hhmm, i) =>
      ok(`2026-01-01T0${i}:00:00`, [obs({ estimated_restore: `2026-01-02T${hhmm}` })])
    ),
    ok("2026-01-01T06:00:00", []),
  ]);

  const slipRows = rateRows(files).map((r) => r.split(",")).filter((r) => r[0] === "slip");
  assertEquals(slipRows.map((r) => [r[4], r[6]]), [["0", "1"], ["1", "1"], ["2", "1"], [
    "3+",
    "2",
  ]]);
});

Deno.test("active index: an open ACC/INC episode yields one row per utility", async () => {
  const { files } = await deriveDatasets([
    ok("2026-01-01T00:00:00", [
      obs({ service: "Oprire ACC/INC", estimated_restore: "2026-01-01T10:00" }),
    ]),
  ]);

  const rows = activeRows(files).map((r) => r.split(","));
  assertEquals(rows.map((r) => r.slice(1)), [
    ["1", "PT A", "ACC", "0"],
    ["1", "PT A", "INC", "0"],
  ]);
  assertEquals(rows[0][0] === rows[1][0], false); // two distinct episodes
});

Deno.test("scores land in the episode's opening month even when restoration comes later", async () => {
  const { files } = await deriveDatasets([
    ok("2022-01-31T23:00:00", [obs({ estimated_restore: "2022-02-01T09:00" })]),
    ok("2022-02-01T10:00:00", []),
  ]);

  const rows = scoreRows(files, "2022-01");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].split(",")[9], "0"); // restored 10:00 > deadline 09:00
  assertEquals(files.has(`${ESTIMATE_SCORES_DIR}/2022-02.csv`), false);
});

Deno.test("trend inputs: scores come back in memory, open episodes' distinct claims as pending", async () => {
  const { estimateScores, pendingEstimates } = await deriveDatasets([
    ok("2026-01-31T22:00:00", [
      obs({ pt_name: "PT A", estimated_restore: "2026-02-01T10:00" }),
      obs({ pt_name: "PT B", estimated_restore: "2026-01-31T23:00" }),
      obs({ pt_name: "PT C", estimated_restore: "" }),
    ]),
    ok("2026-02-01T00:30:00", [
      // PT A restored (a hit); PT B slips to a second estimate; PT C still claim-less
      obs({ pt_name: "PT B", estimated_restore: "2026-02-01T08:00" }),
      obs({ pt_name: "PT C", estimated_restore: "" }),
    ]),
  ]);

  assertEquals(
    estimateScores.map((s) => [s.utility, s.posted_ts, s.hit]),
    [["ACC", "2026-01-31T22:00:00", true]],
  );
  // PT B's two claims are pending, one per posting month; PT C never made a claim
  assertEquals(
    pendingEstimates.map((p) => [p.utility, p.posted_ts]),
    [["ACC", "2026-01-31T22:00:00"], ["ACC", "2026-02-01T00:30:00"]],
  );
});
