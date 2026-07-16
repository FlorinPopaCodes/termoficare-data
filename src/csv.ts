// RFC 4180 CSV formatting and month-file routing. Pure: no file I/O -- callers own writes.

export type CsvValue = string | number | null;

// The live loop and the backfill must write the same files, or a regeneration silently
// lands beside the dataset instead of replacing it.
export const OBSERVATIONS_DIR = "data/observations";
export const SNAPSHOTS_DIR = "data/snapshots";

export const OBSERVATION_HEADER = [
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

function formatField(value: CsvValue): string {
  const text = value === null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function formatRow(values: CsvValue[]): string {
  return values.map(formatField).join(",") + "\n";
}

// Exact bytes to append: a month's first snapshot must create the file with its
// header even when that snapshot itself has zero rows (empty/error statuses).
export function appendPayload(fileExists: boolean, header: string[], rows: CsvValue[][]): string {
  if (fileExists && rows.length === 0) return "";
  const headerLine = fileExists ? "" : formatRow(header);
  return headerLine + rows.map(formatRow).join("");
}

export function monthPath(dir: string, month: string): string {
  return `${dir}/${month}.csv`;
}

// Month comes from snapshot_ts, not wall-clock time-of-write.
export function monthFile(dir: string, snapshotTs: string): string {
  return monthPath(dir, snapshotTs.slice(0, 7));
}
