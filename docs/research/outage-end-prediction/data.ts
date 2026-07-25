// Loading and time helpers shared by the measurements in this folder. Timestamps in the
// archive are Bucharest-naive strings; every comparison here is string-lexicographic or
// via `${ts}Z`, the same convention src/duration_trend.ts uses.

import { parseRows } from "../../../src/csv.ts";

const WORK = Deno.env.get("WORK") ?? ".";

export interface Episode {
  episode_id: string;
  sector: string;
  pt_name: string;
  utility: string;
  first_seen_ts: string;
  last_seen_ts: string;
  first_absent_ts: string | null; // null = still open at end of archive
  cause_class: string; // "" = never carried an estimate
  n_postings: number;
}

export interface Posting {
  episode_id: string;
  utility: string;
  cause_class: string;
  slip_count: number;
  episode_first_seen_ts: string;
  posted_ts: string;
  estimated_restore: string;
  restored_ts: string;
  hit: boolean;
}

export function hours(from: string, to: string): number {
  return (Date.parse(`${to}Z`) - Date.parse(`${from}Z`)) / 3600e3;
}

// Estimates are minute-precision; widen to seconds so they compare as fixed-width strings
// against snapshot timestamps (src/on_time.ts does the same).
export function deadline(estimate: string): string {
  return estimate.length === 16 ? `${estimate}:00` : estimate;
}

export function loadEpisodes(): Episode[] {
  const rows = parseRows(Deno.readTextFileSync(`${WORK}/episodes.csv`));
  return rows.slice(1).map((r) => ({
    episode_id: r[0],
    sector: r[1],
    pt_name: r[2],
    utility: r[3],
    first_seen_ts: r[4],
    last_seen_ts: r[5],
    first_absent_ts: r[6] === "" ? null : r[6],
    cause_class: r[9],
    n_postings: Number(r[10]),
  }));
}

export function loadPostings(): Posting[] {
  const rows = parseRows(Deno.readTextFileSync(`${WORK}/postings.csv`));
  return rows.slice(1).map((r) => ({
    episode_id: r[0],
    utility: r[1],
    cause_class: r[2],
    slip_count: Number(r[3]),
    episode_first_seen_ts: r[4],
    posted_ts: r[5],
    estimated_restore: r[6],
    restored_ts: r[7],
    hit: r[8] === "1",
  }));
}

// Nearest-rank, matching src/duration_trend.ts.
export function quantile(sorted: number[], p: number): number {
  return sorted[Math.ceil(p * sorted.length) - 1];
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}
