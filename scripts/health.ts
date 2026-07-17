#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git,gh
//
// Collects cadence facts (workflow-run history + foundation data) and turns them into
// alert state per src/health.ts. Owns detection/alerting for the whole pipeline: the
// tracker of open GitHub issues (label scrape-health) is the durable alert state,
// data/health.json is just the shields.io badge endpoint.
//
//   deno task health              # collects, evaluates, opens/closes issues, writes health.json
//   deno task health --dry-run    # collects + evaluates + prints the plan; mutates nothing
//
// Same script runs locally and on a schedule via .github/workflows/health.yml.

import {
  badge,
  type ConditionId,
  CONDITIONS,
  evaluate,
  type HealthFacts,
  issueBody,
  issueTitle,
  type OpenIssue,
  planIssueActions,
  recoveryComment,
  type ScrapeLogRow,
} from "../src/health.ts";
import { bucharestToInstant } from "../src/clock.ts";
import { parseRows, SNAPSHOTS_DIR } from "../src/csv.ts";
import { type ScrapeStatus } from "../src/parser.ts";

// Unlike postprocess's runGit, failures carry stderr: this runs unattended on a cron, so
// a gh auth/rate-limit error must be diagnosable from the workflow log alone.
async function run(cmd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`${cmd} ${args[0]} failed with code ${output.code}: ${stderr}`);
  }
  return new TextDecoder().decode(output.stdout);
}

interface GhWorkflowRun {
  run_started_at?: string;
  conclusion?: string | null;
}

async function ghApi(query: string): Promise<{ workflow_runs: GhWorkflowRun[] }> {
  return JSON.parse(await run("gh", ["api", query]));
}

async function lastWorkflowSuccessAt(workflow: string): Promise<number | null> {
  const { workflow_runs } = await ghApi(
    `repos/{owner}/{repo}/actions/workflows/${workflow}/runs?status=success&per_page=1`,
  );
  const startedAt = workflow_runs[0]?.run_started_at;
  return startedAt !== undefined ? Date.parse(startedAt) : null;
}

async function latestDeriveConclusion(): Promise<string | null> {
  const { workflow_runs } = await ghApi(
    "repos/{owner}/{repo}/actions/workflows/derive.yml/runs?status=completed&per_page=1",
  );
  return workflow_runs[0]?.conclusion ?? null;
}

// git log's committer-date ISO output; "" (empty log, i.e. the path never existed) means
// no such event.
async function lastCommitTouching(path: string): Promise<number | null> {
  const text = (await run("git", ["log", "-1", "--format=%cI", "--", path])).trim();
  return text === "" ? null : Date.parse(text);
}

// Derivation predates derive.yml running on a schedule, so a repo that has only ever
// derived locally still has a valid staleness signal via the commit history.
async function lastDeriveSuccessAt(): Promise<number | null> {
  const viaWorkflow = await lastWorkflowSuccessAt("derive.yml");
  if (viaWorkflow !== null) return viaWorkflow;
  return await lastCommitTouching("data/derived");
}

// The trailing ~2 months of scrape-log rows, oldest -> newest, across both files if the
// month boundary falls inside the window all the thresholds below care about.
async function scrapeLog(): Promise<ScrapeLogRow[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(SNAPSHOTS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".csv")) names.push(entry.name);
  }
  names.sort();

  const rows: ScrapeLogRow[] = [];
  for (const name of names.slice(-2)) {
    const content = await Deno.readTextFile(`${SNAPSHOTS_DIR}/${name}`);
    for (const row of parseRows(content).slice(1)) { // slice(1) drops the header row
      rows.push({ ts: bucharestToInstant(row[0]).getTime(), status: row[1] as ScrapeStatus });
    }
  }
  return rows;
}

async function collectFacts(): Promise<HealthFacts> {
  const [lastFlatSuccessAt, lastDerive, conclusion, log, lastHtmlChangeAt] = await Promise.all([
    lastWorkflowSuccessAt("flat.yml"),
    lastDeriveSuccessAt(),
    latestDeriveConclusion(),
    scrapeLog(),
    lastCommitTouching("data/termoficare.html"),
  ]);
  return {
    now: Date.now(),
    lastFlatSuccessAt,
    scrapeLog: log,
    lastHtmlChangeAt,
    lastDeriveSuccessAt: lastDerive,
    latestDeriveConclusion: conclusion,
  };
}

interface GhIssue {
  number: number;
  labels: { name: string }[];
  createdAt: string;
}

// An issue's condition is the first CONDITIONS entry present among its labels; an issue
// carrying none of them (shouldn't happen given how they're opened, but not this script's
// job to enforce) is skipped rather than guessed at.
export async function openIssues(): Promise<OpenIssue[]> {
  const text = await run("gh", [
    "issue",
    "list",
    "--label",
    "scrape-health",
    "--state",
    "open",
    "--json",
    "number,labels,createdAt",
    "--limit",
    "100",
  ]);
  const issues: GhIssue[] = JSON.parse(text);
  const result: OpenIssue[] = [];
  for (const issue of issues) {
    const labels = new Set(issue.labels.map((l) => l.name));
    const condition = CONDITIONS.find((c) => labels.has(c));
    if (condition === undefined) continue;
    result.push({ number: issue.number, condition, openedAt: Date.parse(issue.createdAt) });
  }
  return result;
}

export async function openIssueFor(condition: ConditionId, facts: HealthFacts) {
  console.error(`Opening issue: ${condition}`);
  await run("gh", [
    "issue",
    "create",
    "--title",
    issueTitle(condition),
    "--body",
    issueBody(condition, facts),
    "--label",
    "scrape-health",
    "--label",
    condition,
  ]);
}

export async function closeIssue(issue: OpenIssue, now: number) {
  console.error(`Closing issue #${issue.number}: ${issue.condition}`);
  await run("gh", [
    "issue",
    "close",
    String(issue.number),
    "--comment",
    recoveryComment(issue.openedAt, now),
  ]);
}

async function main() {
  const dryRun = Deno.args.includes("--dry-run");

  const facts = await collectFacts();
  const active = evaluate(facts);
  const plan = planIssueActions(active, await openIssues());
  const badgeJson = badge(active);

  console.error("Facts:", JSON.stringify(facts, null, 2));
  console.error(`Active conditions: ${active.length > 0 ? active.join(", ") : "none"}`);
  console.error("Issue plan:", JSON.stringify(plan, null, 2));
  console.error("Badge:", JSON.stringify(badgeJson, null, 2));

  if (dryRun) {
    console.error("--dry-run: no writes, no gh mutations");
    return;
  }

  for (const condition of plan.open) await openIssueFor(condition, facts);
  for (const issue of plan.close) await closeIssue(issue, facts.now);

  await Deno.writeTextFile("data/health.json", JSON.stringify(badgeJson, null, 2) + "\n");
  console.error("Wrote data/health.json");
}

// Guarded (unlike sibling scripts) so the tracker executors above stay importable by a
// lifecycle drill without side effects.
if (import.meta.main) main();
