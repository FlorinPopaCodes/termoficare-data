import { assertEquals } from "@std/assert";
import {
  badge,
  evaluate,
  type HealthFacts,
  issueBody,
  type IssuePlan,
  issueTitle,
  type OpenIssue,
  planIssueActions,
  recoveryComment,
  type ScrapeLogRow,
} from "./health.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-07-17T12:00:00Z");

// Healthy defaults so each test perturbs exactly one dimension.
function buildFacts(overrides: Partial<HealthFacts> = {}): HealthFacts {
  return {
    now: NOW,
    lastFlatSuccessAt: NOW - HOUR,
    scrapeLog: [{ ts: NOW - HOUR, status: "ok" }],
    lastHtmlChangeAt: NOW - HOUR,
    lastDeriveSuccessAt: NOW - HOUR,
    latestDeriveConclusion: "success",
    ...overrides,
  };
}

// -- pipeline-down --------------------------------------------------------

Deno.test("pipeline-down: 5h59m since last flat success is inactive", () => {
  const facts = buildFacts({ lastFlatSuccessAt: NOW - (5 * HOUR + 59 * MINUTE) });
  assertEquals(evaluate(facts).includes("pipeline-down"), false);
});

Deno.test("pipeline-down: exactly 6h since last flat success is inactive (strict >)", () => {
  const facts = buildFacts({ lastFlatSuccessAt: NOW - 6 * HOUR });
  assertEquals(evaluate(facts).includes("pipeline-down"), false);
});

Deno.test("pipeline-down: 6h01m since last flat success is active", () => {
  const facts = buildFacts({ lastFlatSuccessAt: NOW - (6 * HOUR + MINUTE) });
  assertEquals(evaluate(facts).includes("pipeline-down"), true);
});

Deno.test("pipeline-down: null lastFlatSuccessAt is active", () => {
  const facts = buildFacts({ lastFlatSuccessAt: null });
  assertEquals(evaluate(facts).includes("pipeline-down"), true);
});

// -- parser-broken ----------------------------------------------------------

Deno.test("parser-broken: trailing parse_error row is active", () => {
  const facts = buildFacts({ scrapeLog: [{ ts: NOW - HOUR, status: "parse_error" }] });
  assertEquals(evaluate(facts).includes("parser-broken"), true);
});

Deno.test("parser-broken: parse_error followed by a later ok is inactive", () => {
  const facts = buildFacts({
    scrapeLog: [
      { ts: NOW - 2 * HOUR, status: "parse_error" },
      { ts: NOW - HOUR, status: "ok" },
    ],
  });
  assertEquals(evaluate(facts).includes("parser-broken"), false);
});

Deno.test("parser-broken while pipeline-down: both active, not suppressed", () => {
  const facts = buildFacts({
    lastFlatSuccessAt: null,
    scrapeLog: [{ ts: NOW - HOUR, status: "parse_error" }],
  });
  const active = evaluate(facts);
  assertEquals(active.includes("pipeline-down"), true);
  assertEquals(active.includes("parser-broken"), true);
});

// -- source-down --------------------------------------------------------------

Deno.test("source-down: trailing error streak starting exactly 12h ago is active", () => {
  const facts = buildFacts({ scrapeLog: [{ ts: NOW - 12 * HOUR, status: "error" }] });
  assertEquals(evaluate(facts).includes("source-down"), true);
});

Deno.test("source-down: trailing error streak starting 11h59m ago is inactive", () => {
  const facts = buildFacts({
    scrapeLog: [{ ts: NOW - (11 * HOUR + 59 * MINUTE), status: "error" }],
  });
  assertEquals(evaluate(facts).includes("source-down"), false);
});

Deno.test("source-down: error streak broken by a later ok is inactive", () => {
  const facts = buildFacts({
    scrapeLog: [
      { ts: NOW - 20 * HOUR, status: "error" },
      { ts: NOW - HOUR, status: "ok" },
    ],
  });
  assertEquals(evaluate(facts).includes("source-down"), false);
});

Deno.test("source-down suppressed while pipeline-down: only pipeline-down reported", () => {
  const facts = buildFacts({
    lastFlatSuccessAt: null,
    scrapeLog: [{ ts: NOW - 20 * HOUR, status: "error" }],
  });
  const active = evaluate(facts);
  assertEquals(active.includes("pipeline-down"), true);
  assertEquals(active.includes("source-down"), false);
});

Deno.test("source-down measures from the first error of a multi-row trailing run", () => {
  // First error of the trailing run is exactly 12h ago (>= threshold); the most recent
  // error is only 1h ago -- measuring from the last row instead would wrongly clear this.
  const facts = buildFacts({
    scrapeLog: [
      { ts: NOW - 12 * HOUR, status: "error" },
      { ts: NOW - HOUR, status: "error" },
    ],
  });
  assertEquals(evaluate(facts).includes("source-down"), true);
});

// -- frozen-page ----------------------------------------------------------------

Deno.test("frozen-page: last row ok, html changed exactly 72h ago is active", () => {
  const facts = buildFacts({ lastHtmlChangeAt: NOW - 72 * HOUR });
  assertEquals(evaluate(facts).includes("frozen-page"), true);
});

Deno.test("frozen-page: html changed 71h59m ago is inactive", () => {
  const facts = buildFacts({ lastHtmlChangeAt: NOW - (71 * HOUR + 59 * MINUTE) });
  assertEquals(evaluate(facts).includes("frozen-page"), false);
});

Deno.test("frozen-page: last row error is inactive", () => {
  const facts = buildFacts({
    lastHtmlChangeAt: NOW - 72 * HOUR,
    scrapeLog: [{ ts: NOW - HOUR, status: "error" }],
  });
  assertEquals(evaluate(facts).includes("frozen-page"), false);
});

Deno.test("frozen-page suppressed while pipeline-down", () => {
  const facts = buildFacts({ lastFlatSuccessAt: null, lastHtmlChangeAt: NOW - 72 * HOUR });
  const active = evaluate(facts);
  assertEquals(active.includes("pipeline-down"), true);
  assertEquals(active.includes("frozen-page"), false);
});

Deno.test("frozen-page: last row empty + 72h since html change is active", () => {
  const facts = buildFacts({
    lastHtmlChangeAt: NOW - 72 * HOUR,
    scrapeLog: [{ ts: NOW - HOUR, status: "empty" }],
  });
  assertEquals(evaluate(facts).includes("frozen-page"), true);
});

// -- empty never alerts -----------------------------------------------------------

Deno.test("empty status rows never contribute to any condition, even a 5-day trailing streak", () => {
  const scrapeLog: ScrapeLogRow[] = [];
  for (let d = 5; d >= 0; d--) scrapeLog.push({ ts: NOW - d * DAY, status: "empty" });
  const facts = buildFacts({ scrapeLog });
  assertEquals(evaluate(facts), []);
});

// -- derived-stale ----------------------------------------------------------------

Deno.test("derived-stale: latestDeriveConclusion 'failure' is active", () => {
  const facts = buildFacts({ latestDeriveConclusion: "failure" });
  assertEquals(evaluate(facts).includes("derived-stale"), true);
});

Deno.test("derived-stale: any non-success conclusion (cancelled, timed_out) is active", () => {
  for (const conclusion of ["cancelled", "timed_out", "startup_failure"]) {
    const facts = buildFacts({ latestDeriveConclusion: conclusion });
    assertEquals(evaluate(facts).includes("derived-stale"), true, conclusion);
  }
});

Deno.test("derived-stale: last success exactly 48h ago is inactive (strict >)", () => {
  const facts = buildFacts({ lastDeriveSuccessAt: NOW - 48 * HOUR });
  assertEquals(evaluate(facts).includes("derived-stale"), false);
});

Deno.test("derived-stale: last success 48h01m ago is active", () => {
  const facts = buildFacts({ lastDeriveSuccessAt: NOW - (48 * HOUR + MINUTE) });
  assertEquals(evaluate(facts).includes("derived-stale"), true);
});

Deno.test("derived-stale: both derive facts null is inactive (pre-derivation repo state)", () => {
  const facts = buildFacts({ lastDeriveSuccessAt: null, latestDeriveConclusion: null });
  assertEquals(evaluate(facts).includes("derived-stale"), false);
});

// -- ordering -----------------------------------------------------------------------

Deno.test("evaluate returns active conditions in CONDITIONS order", () => {
  // source-down and frozen-page both key off the trailing scrape-log status, which can
  // only take one value at a time, and both are suppressed by pipeline-down anyway -- so
  // the richest reachable combination is pipeline-down + parser-broken + derived-stale.
  const facts = buildFacts({
    lastFlatSuccessAt: null,
    scrapeLog: [{ ts: NOW - HOUR, status: "parse_error" }],
    lastDeriveSuccessAt: null,
    latestDeriveConclusion: "failure",
  });
  assertEquals(evaluate(facts), ["pipeline-down", "parser-broken", "derived-stale"]);
});

// -- badge --------------------------------------------------------------------------

Deno.test("badge: red with the condition name when pipeline-down is active", () => {
  assertEquals(badge(["pipeline-down"]), {
    schemaVersion: 1,
    label: "scrape health",
    message: "pipeline-down",
    color: "red",
  });
});

Deno.test("badge: yellow when only a non-red condition is active", () => {
  assertEquals(badge(["frozen-page"]), {
    schemaVersion: 1,
    label: "scrape health",
    message: "frozen-page",
    color: "yellow",
  });
});

Deno.test("badge: green and 'ok' when nothing is active", () => {
  assertEquals(badge([]), {
    schemaVersion: 1,
    label: "scrape health",
    message: "ok",
    color: "green",
  });
});

Deno.test("badge: message joins multiple active conditions", () => {
  assertEquals(badge(["pipeline-down", "derived-stale"]).message, "pipeline-down, derived-stale");
});

// -- planIssueActions -----------------------------------------------------------------

Deno.test("planIssueActions: opens a condition with no open issue", () => {
  const plan = planIssueActions(["pipeline-down"], []);
  assertEquals(plan, { open: ["pipeline-down"], close: [] });
});

Deno.test("planIssueActions: does not duplicate an already-open issue", () => {
  const openIssues: OpenIssue[] = [
    { number: 1, condition: "pipeline-down", openedAt: NOW - HOUR },
  ];
  const plan = planIssueActions(["pipeline-down"], openIssues);
  assertEquals(plan, { open: [], close: [] });
});

Deno.test("planIssueActions: closes an open issue whose condition cleared", () => {
  const openIssues: OpenIssue[] = [
    { number: 1, condition: "pipeline-down", openedAt: NOW - HOUR },
  ];
  const plan = planIssueActions([], openIssues);
  assertEquals(plan, { open: [], close: openIssues });
});

Deno.test("planIssueActions: full lifecycle -- open, hold, close, reopen fresh", () => {
  let tracker: OpenIssue[] = [];
  let nextNumber = 1;

  function apply(plan: IssuePlan) {
    for (const condition of plan.open) {
      tracker.push({ number: nextNumber++, condition, openedAt: NOW });
    }
    const closed = new Set(plan.close.map((i) => i.number));
    tracker = tracker.filter((i) => !closed.has(i.number));
  }

  // (1) condition appears -> plan opens
  let plan = planIssueActions(["pipeline-down"], tracker);
  assertEquals(plan.open, ["pipeline-down"]);
  apply(plan);
  assertEquals(tracker, [{ number: 1, condition: "pipeline-down", openedAt: NOW }]);

  // (2) still active next run -> plan opens nothing
  plan = planIssueActions(["pipeline-down"], tracker);
  assertEquals(plan, { open: [], close: [] });
  apply(plan);

  // (3) cleared -> plan closes that issue
  plan = planIssueActions([], tracker);
  assertEquals(plan.close, [{ number: 1, condition: "pipeline-down", openedAt: NOW }]);
  apply(plan);
  assertEquals(tracker, []);

  // (4) reappears -> plan opens a fresh issue, not reusing the old number
  plan = planIssueActions(["pipeline-down"], tracker);
  assertEquals(plan.open, ["pipeline-down"]);
  apply(plan);
  assertEquals(tracker, [{ number: 2, condition: "pipeline-down", openedAt: NOW }]);
});

// -- recoveryComment ------------------------------------------------------------------

Deno.test("recoveryComment states both ISO endpoints and the rounded outage duration", () => {
  const openedAt = Date.parse("2026-07-15T00:00:00Z");
  const now = Date.parse("2026-07-15T02:30:00Z");
  assertEquals(
    recoveryComment(openedAt, now),
    "Recovered: condition no longer detected.\n\n" +
      "Outage window: 2026-07-15T00:00Z → 2026-07-15T02:30Z (~2.5h).",
  );
});

// -- issueTitle / issueBody -------------------------------------------------------------

Deno.test("issueTitle names the condition", () => {
  assertEquals(issueTitle("pipeline-down"), "Scrape health: pipeline-down");
  assertEquals(issueTitle("derived-stale"), "Scrape health: derived-stale");
});

Deno.test("issueBody for pipeline-down cites the last success time, hours-ago, and threshold", () => {
  const facts = buildFacts({ lastFlatSuccessAt: NOW - (6 * HOUR + 30 * MINUTE) });
  const body = issueBody("pipeline-down", facts);
  assertEquals(body.includes("2026-07-17T05:30Z"), true);
  assertEquals(body.includes("6.5h"), true);
  assertEquals(body.includes("6h"), true);
  assertEquals(
    body.includes(
      "Opened automatically by the health workflow; it will comment and close this issue when the condition clears.",
    ),
    true,
  );
});

Deno.test("issueBody for source-down cites the error-streak start", () => {
  const facts = buildFacts({ scrapeLog: [{ ts: NOW - 12 * HOUR, status: "error" }] });
  const body = issueBody("source-down", facts);
  assertEquals(body.includes("2026-07-17T00:00Z"), true);
});

Deno.test("issueBody for frozen-page cites when the HTML last changed", () => {
  const facts = buildFacts({ lastHtmlChangeAt: NOW - 72 * HOUR });
  const body = issueBody("frozen-page", facts);
  assertEquals(body.includes("2026-07-14T12:00Z"), true);
});

Deno.test("issueBody for parser-broken names it a likely markup change needing a parser fix", () => {
  const facts = buildFacts({ scrapeLog: [{ ts: NOW - HOUR, status: "parse_error" }] });
  const body = issueBody("parser-broken", facts);
  assertEquals(body.includes("2026-07-17T11:00Z"), true);
  assertEquals(/markup change/i.test(body), true);
  assertEquals(/parser fix/i.test(body), true);
});

Deno.test("issueBody for derived-stale names the triggering clause", () => {
  const failureBody = issueBody(
    "derived-stale",
    buildFacts({ latestDeriveConclusion: "timed_out" }),
  );
  assertEquals(/timed_out/.test(failureBody), true);

  const staleBody = issueBody(
    "derived-stale",
    buildFacts({
      lastDeriveSuccessAt: NOW - (48 * HOUR + MINUTE),
      latestDeriveConclusion: "success",
    }),
  );
  assertEquals(staleBody.includes("48h"), true);
});
