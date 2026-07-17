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

// Inverse of formatRow: reads a foundation CSV back into rows of raw strings. RFC 4180
// enough for what this repo writes -- LF row endings, quotes doubled, quoted fields may
// hold commas/newlines/CR. A field only enters quoted mode as its very first character,
// matching how formatRow always quotes the whole field or none of it.
export function parseRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Only a dangling final row (no trailing newline) needs flushing; a well-formed file
  // ends with \n, which already flushed the last row above.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function monthPath(dir: string, month: string): string {
  return `${dir}/${month}.csv`;
}

// Month comes from snapshot_ts, not wall-clock time-of-write.
export function monthFile(dir: string, snapshotTs: string): string {
  return monthPath(dir, snapshotTs.slice(0, 7));
}
