#!/usr/bin/env -S deno run --allow-run=git --allow-read --allow-write
//
// One-off, run locally: regenerates every monthly observations and scrape-log CSV from
// the entire scrape history, through the same parser the live loop uses.
//
//   deno task backfill [ref]        # ref defaults to main
//
// Full deterministic regeneration -- no cursors, no resume state. The dataset is a pure
// function of (git history x parser version), so a parser fix is deployed by rerunning
// this and pushing the result; rerunning without a parser change is a no-op diff.
// Nothing is written until every validation gate from decision #7 passes.
//
// Caveat carried by the historical data: `data/snapshots/*.csv` records change-commits
// only. Flat commits only when the page changed, so the ~15-minute scrapes that found no
// diff left no commit and are invisible here. The scrape log is a truthful record of
// observed change, not of scrape cadence, for everything before the live loop shipped.

import { bucharestTimestamp } from "../src/clock.ts";
import { parseSnapshot } from "../src/parser.ts";
import { buildArtifacts, SNAPSHOT_PATH, type SnapshotArtifacts } from "../src/snapshot.ts";
import { OBSERVATIONS_DIR, SNAPSHOTS_DIR } from "../src/csv.ts";
import { buildDataset, type SnapshotInput, SPOT_CHECKS, validate } from "../src/backfill.ts";

const PROGRESS_EVERY = 2_000;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface Commit {
  sha: string;
  instant: number;
}

async function git(args: string[]): Promise<string> {
  const { success, stdout, stderr } = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!success) throw new Error(`git ${args.join(" ")} failed: ${decoder.decode(stderr)}`);
  return decoder.decode(stdout);
}

// History simplification gives exactly the commits that changed the snapshot, oldest
// first -- the same enumeration decision #7 locked, with the committer instant attached.
async function enumerateCommits(ref: string): Promise<Commit[]> {
  const text = await git(["log", "--reverse", "--format=%H %ct", ref, "--", SNAPSHOT_PATH]);
  return text.trim().split("\n").filter((l) => l !== "").map((line) => {
    const [sha, instant] = line.split(" ");
    return { sha, instant: Number(instant) };
  });
}

// Reads `git cat-file --batch` framing: a header line, then exactly `size` bytes, then LF.
class BatchReader {
  #buffer = new Uint8Array(0);

  constructor(private readonly stream: ReadableStreamDefaultReader<Uint8Array>) {}

  async #pull(): Promise<boolean> {
    const { value, done } = await this.stream.read();
    if (done || value === undefined) return false;
    const next = new Uint8Array(this.#buffer.length + value.length);
    next.set(this.#buffer);
    next.set(value, this.#buffer.length);
    this.#buffer = next;
    return true;
  }

  async line(): Promise<string> {
    for (;;) {
      const end = this.#buffer.indexOf(0x0a);
      if (end !== -1) {
        const line = decoder.decode(this.#buffer.subarray(0, end));
        this.#buffer = this.#buffer.slice(end + 1);
        return line;
      }
      if (!await this.#pull()) throw new Error("cat-file ended mid-header");
    }
  }

  async bytes(count: number): Promise<Uint8Array> {
    while (this.#buffer.length < count) {
      if (!await this.#pull()) throw new Error("cat-file ended mid-blob");
    }
    const out = this.#buffer.slice(0, count);
    this.#buffer = this.#buffer.slice(count);
    return out;
  }
}

// One long-lived cat-file process for all ~26k blobs: spawning git per commit would cost
// more than the parsing does. stdin is fed concurrently -- writing all the requests up
// front would deadlock once git's stdout pipe fills.
async function* snapshots(
  commits: Commit[],
  captured: Map<string, SnapshotArtifacts>,
): AsyncGenerator<SnapshotInput> {
  const child = new Deno.Command("git", {
    args: ["cat-file", "--batch"],
    stdin: "piped",
    stdout: "piped",
  }).spawn();

  const requests = (async () => {
    const writer = child.stdin.getWriter();
    for (const { sha } of commits) {
      await writer.write(encoder.encode(`${sha}:${SNAPSHOT_PATH}\n`));
    }
    await writer.close();
  })();

  const reader = new BatchReader(child.stdout.getReader());
  const wanted = new Set(SPOT_CHECKS.map((s) => s.sha));

  try {
    for (const [index, { sha, instant }] of commits.entries()) {
      const header = await reader.line();
      const size = Number(header.split(" ")[2]);
      if (!Number.isInteger(size)) throw new Error(`${sha}: unexpected cat-file header ${header}`);

      const html = decoder.decode(await reader.bytes(size));
      await reader.bytes(1); // the LF git appends after the blob

      const ts = bucharestTimestamp(new Date(instant * 1000));
      const artifacts = buildArtifacts(html, ts, parseSnapshot);
      if (wanted.has(sha)) captured.set(sha, artifacts);

      if ((index + 1) % PROGRESS_EVERY === 0) {
        console.error(`  ${index + 1}/${commits.length} snapshots parsed (${ts})`);
      }
      yield { instant, ts, artifacts };
    }
    await requests;
  } finally {
    await child.status;
  }
}

// Wholesale replacement, not an append: a month that no longer has any snapshots, or a
// file left by an older parser version, must not survive a regeneration.
async function write(files: Map<string, string>) {
  for (const dir of [OBSERVATIONS_DIR, SNAPSHOTS_DIR]) {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    await Deno.mkdir(dir, { recursive: true });
  }
  for (const [path, content] of files) await Deno.writeTextFile(path, content);
}

async function main() {
  const ref = Deno.args[0] ?? "main";

  console.error(`Enumerating snapshot commits on ${ref}...`);
  const commits = await enumerateCommits(ref);
  if (commits.length === 0) throw new Error(`no commits touch ${SNAPSHOT_PATH} on ${ref}`);
  console.error(`${commits.length} commits to parse.`);

  const captured = new Map<string, SnapshotArtifacts>();
  const started = performance.now();
  const dataset = await buildDataset(snapshots(commits, captured));
  const { stats } = dataset;

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.error(
    `\nParsed ${stats.snapshots} snapshots into ${stats.observations} observations ` +
      `across ${stats.months.size} months in ${seconds}s.`,
  );
  console.error(
    `  ok ${stats.statusCounts.ok}, empty ${stats.statusCounts.empty}, ` +
      `error ${stats.statusCounts.error}, parse_error ${stats.statusCounts.parse_error}`,
  );

  const failures = validate({ dataset, expectedSnapshots: commits.length, captured });
  if (failures.length > 0) {
    console.error(`\n${failures.length} validation gate(s) failed — nothing written:`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    Deno.exit(1);
  }
  console.error("\nAll validation gates passed.");

  await write(dataset.files);
  console.error(`Wrote ${dataset.files.size} files. current.json untouched.`);
}

main();
