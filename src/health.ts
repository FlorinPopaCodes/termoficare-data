// Maps cadence facts to active alert conditions per decision #9. Liveness comes from
// workflow-run history rather than the scrape log, because the log is change-gated:
// postprocess only writes a row when the fetched HTML differs, so a quiet page and a dead
// scraper both look like silence in data/snapshots/*.csv. Silence-based rules
// (source-down, frozen-page) are therefore suppressed while the pipeline itself looks
// down -- change-gated silence is only evidence that the page hasn't moved while the
// scraper is confirmed to still be running.
//
// Pure: no I/O. scripts/health.ts collects HealthFacts and executes what this module
// decides.

import { type ScrapeStatus } from "./parser.ts";

export type ConditionId =
  | "pipeline-down"
  | "parser-broken"
  | "source-down"
  | "frozen-page"
  | "derived-stale";

// Severity order: red conditions first; badge and issue text follow this order.
export const CONDITIONS: ConditionId[] = [
  "pipeline-down",
  "parser-broken",
  "source-down",
  "frozen-page",
  "derived-stale",
];

export interface ScrapeLogRow {
  ts: number; // epoch ms UTC
  status: ScrapeStatus;
}

// All timestamps epoch ms UTC; null = no such event exists.
export interface HealthFacts {
  now: number;
  lastFlatSuccessAt: number | null; // last successful flat.yml run start
  scrapeLog: ScrapeLogRow[]; // trailing rows, oldest -> newest (~2 months)
  lastHtmlChangeAt: number | null; // last commit touching data/termoficare.html
  lastDeriveSuccessAt: number | null; // last successful derive.yml run, or last commit
  // touching data/derived
  latestDeriveConclusion: string | null; // conclusion of the most recent completed
  // derive.yml run
}

const HOUR_MS = 60 * 60 * 1000;

// Spec #9 assumed a punctual 15-min cron and set this to 1h. Measured, GitHub throttles
// the schedule trigger to a median gap of 76 min and a max of 4.4h (see
// docs/research/2026-07-17-external-scheduler-for-15min-cron.md), so 6h clears the
// observed worst case with margin while still alerting the same day a workflow genuinely
// stops running.
export const PIPELINE_DOWN_HOURS = 6;
export const SOURCE_DOWN_HOURS = 12;
export const FROZEN_PAGE_HOURS = 72;
export const DERIVED_STALE_HOURS = 48;

// Detects what the postprocess structurally cannot: a workflow that isn't running at all.
function isPipelineDown(facts: HealthFacts): boolean {
  if (facts.lastFlatSuccessAt === null) return true;
  return facts.now - facts.lastFlatSuccessAt > PIPELINE_DOWN_HOURS * HOUR_MS;
}

// Positive evidence, not silence-based -- reported even while the pipeline looks down.
function isParserBroken(facts: HealthFacts): boolean {
  const last = facts.scrapeLog[facts.scrapeLog.length - 1];
  return last !== undefined && last.status === "parse_error";
}

// The trailing contiguous run of "error" rows, oldest-first; [] if the last row isn't
// "error".
function trailingErrorRun(scrapeLog: ScrapeLogRow[]): ScrapeLogRow[] {
  let start = scrapeLog.length;
  while (start > 0 && scrapeLog[start - 1].status === "error") start--;
  return scrapeLog.slice(start);
}

// Measured to now, not to the last row: an unchanged error page writes one row then goes
// silent, and silence while the scraper is live means the error persists (recovery would
// change the page and write a new row).
function isSourceDown(facts: HealthFacts): boolean {
  if (isPipelineDown(facts)) return false;
  const run = trailingErrorRun(facts.scrapeLog);
  if (run.length === 0) return false;
  return facts.now - run[0].ts >= SOURCE_DOWN_HOURS * HOUR_MS;
}

// The page normally changes every few scrapes even when content is stable; days of
// byte-identical HTML is the only staleness signal available since the page embeds no
// update timestamp.
function isFrozenPage(facts: HealthFacts): boolean {
  if (isPipelineDown(facts)) return false;
  const last = facts.scrapeLog[facts.scrapeLog.length - 1];
  if (last === undefined || (last.status !== "ok" && last.status !== "empty")) return false;
  if (facts.lastHtmlChangeAt === null) return false;
  return facts.now - facts.lastHtmlChangeAt >= FROZEN_PAGE_HOURS * HOUR_MS;
}

// A null lastDeriveSuccessAt (derivation has never happened in any form) does not alert
// on its own -- that's the pre-derivation repo state, not staleness.
function isDerivedStale(facts: HealthFacts): boolean {
  if (facts.latestDeriveConclusion === "failure") return true;
  if (facts.lastDeriveSuccessAt === null) return false;
  return facts.now - facts.lastDeriveSuccessAt > DERIVED_STALE_HOURS * HOUR_MS;
}

export function evaluate(facts: HealthFacts): ConditionId[] {
  const active: ConditionId[] = [];
  if (isPipelineDown(facts)) active.push("pipeline-down");
  if (isParserBroken(facts)) active.push("parser-broken");
  if (isSourceDown(facts)) active.push("source-down");
  if (isFrozenPage(facts)) active.push("frozen-page");
  if (isDerivedStale(facts)) active.push("derived-stale");
  return active;
}

// shields.io endpoint-badge schema: https://shields.io/badges/endpoint-badge
export function badge(active: ConditionId[]): {
  schemaVersion: 1;
  label: "scrape health";
  message: string;
  color: "red" | "yellow" | "green";
} {
  const red = active.includes("pipeline-down") || active.includes("parser-broken");
  const color = red ? "red" : active.length > 0 ? "yellow" : "green";
  return {
    schemaVersion: 1,
    label: "scrape health",
    message: active.length > 0 ? active.join(", ") : "ok",
    color,
  };
}

// The tracker itself -- open GitHub issues -- is the durable alert state; health.json is
// just the badge. planIssueActions is the pure planner scripts/health.ts executes.
export interface OpenIssue {
  number: number;
  condition: ConditionId;
  openedAt: number;
}

export interface IssuePlan {
  open: ConditionId[];
  close: OpenIssue[];
}

// At most one open issue per condition; a recurrence after a close naturally opens a
// fresh issue, giving one incident per issue for the historical record.
export function planIssueActions(active: ConditionId[], openIssues: OpenIssue[]): IssuePlan {
  const openConditions = new Set(openIssues.map((i) => i.condition));
  const activeSet = new Set(active);
  return {
    open: active.filter((c) => !openConditions.has(c)),
    close: openIssues.filter((i) => !activeSet.has(i.condition)),
  };
}

// Trimmed to minutes precision (e.g. 2026-07-17T12:52Z) -- seconds resolution is noise
// against hour-scale thresholds.
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16) + "Z";
}

function hoursAgo(now: number, then: number): string {
  return ((now - then) / HOUR_MS).toFixed(1);
}

export function issueTitle(c: ConditionId): string {
  return `Scrape health: ${c}`;
}

const CLOSING_LINE = "Opened automatically by the health workflow; it will comment and " +
  "close this issue when the condition clears.";

function issueParagraph(c: ConditionId, facts: HealthFacts): string {
  switch (c) {
    case "pipeline-down": {
      if (facts.lastFlatSuccessAt === null) {
        return `No successful Flat run has ever been recorded; threshold ${PIPELINE_DOWN_HOURS}h.`;
      }
      return `Last successful Flat run at ${iso(facts.lastFlatSuccessAt)}, ` +
        `${hoursAgo(facts.now, facts.lastFlatSuccessAt)}h ago, threshold ${PIPELINE_DOWN_HOURS}h.`;
    }
    case "parser-broken": {
      const last = facts.scrapeLog[facts.scrapeLog.length - 1];
      const at = last !== undefined ? iso(last.ts) : "an unknown time";
      return `parse_error at ${at} — likely a markup change, needs a parser fix.`;
    }
    case "source-down": {
      const run = trailingErrorRun(facts.scrapeLog);
      const since = run.length > 0 ? iso(run[0].ts) : "an unknown time";
      return `Error streak since ${since}, threshold ${SOURCE_DOWN_HOURS}h.`;
    }
    case "frozen-page": {
      const at = facts.lastHtmlChangeAt !== null ? iso(facts.lastHtmlChangeAt) : "an unknown time";
      return `HTML last changed at ${at}, threshold ${FROZEN_PAGE_HOURS}h.`;
    }
    case "derived-stale": {
      if (facts.latestDeriveConclusion === "failure") {
        return "The most recent derive.yml run concluded with failure.";
      }
      if (facts.lastDeriveSuccessAt === null) {
        return `No successful derive has ever been recorded; threshold ${DERIVED_STALE_HOURS}h.`;
      }
      return `Last successful derive at ${iso(facts.lastDeriveSuccessAt)}, ` +
        `${
          hoursAgo(facts.now, facts.lastDeriveSuccessAt)
        }h ago, threshold ${DERIVED_STALE_HOURS}h.`;
    }
  }
}

export function issueBody(c: ConditionId, facts: HealthFacts): string {
  return `${issueParagraph(c, facts)}\n\n${CLOSING_LINE}`;
}

export function recoveryComment(openedAt: number, now: number): string {
  const hours = ((now - openedAt) / HOUR_MS).toFixed(1);
  return "Recovered: condition no longer detected.\n\n" +
    `Outage window: ${iso(openedAt)} → ${iso(now)} (~${hours}h).`;
}
