// CSV writer for the observations and scrape-log datasets.
// Dialect per decision #5: UTF-8 no BOM, comma, RFC 4180 quoting, LF (not CRLF),
// header per file, one physical line per row. Monthly files routed by snapshot_ts.

import type { Observation, ParseResult } from "./parser.ts";

export const OBSERVATIONS_HEADER = [
  "snapshot_ts",
  "sector",
  "pt_name",
  "blocks",
  "service",
  "cause",
  "estimated_restore",
  "zone_raw",
];

export const SNAPSHOT_LOG_HEADER = ["snapshot_ts", "status", "observations"];

// Embedded newlines are flattened to a space rather than quote-preserved: "one
// physical line per row" is a hard dialect rule here, stricter than bare RFC 4180.
export function csvField(value: string | number): string {
  const text = String(value).replace(/\r?\n/g, " ");
  if (/[",]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(",");
}

export function monthKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7);
}

export function monthFilePath(dir: string, isoTimestamp: string): string {
  return `${dir}/${monthKey(isoTimestamp)}.csv`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

async function appendRows(
  dir: string,
  isoTimestamp: string,
  header: string[],
  rows: (string | number)[][],
): Promise<void> {
  if (rows.length === 0) return;

  await Deno.mkdir(dir, { recursive: true });
  const path = monthFilePath(dir, isoTimestamp);
  const alreadyExists = await fileExists(path);

  const lines = rows.map(csvRow);
  if (!alreadyExists) lines.unshift(csvRow(header));

  await Deno.writeTextFile(path, lines.join("\n") + "\n", { append: alreadyExists });
}

export async function appendObservations(dir: string, observations: Observation[]): Promise<void> {
  if (observations.length === 0) return;

  const rows = observations.map((o) => [
    o.snapshot_ts,
    o.sector,
    o.pt_name,
    o.blocks,
    o.service,
    o.cause,
    o.estimated_restore ?? "",
    o.zone_raw,
  ]);
  await appendRows(dir, observations[0].snapshot_ts, OBSERVATIONS_HEADER, rows);
}

export async function appendScrapeLog(dir: string, result: ParseResult): Promise<void> {
  await appendRows(dir, result.snapshot_ts, SNAPSHOT_LOG_HEADER, [
    [result.snapshot_ts, result.status, result.observations.length],
  ]);
}
