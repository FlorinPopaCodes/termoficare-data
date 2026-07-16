// Parses a CMTEB termoficare snapshot into observation rows
// Pure: HTML string + snapshot timestamp in, status + rows out. No I/O.

import { DOMParser, type Element, type Node } from "deno-dom";

export type ScrapeStatus = "ok" | "empty" | "error" | "parse_error";

export interface Observation {
  snapshot_ts: string;
  sector: number;
  pt_name: string;
  blocks: number;
  service: string;
  cause: string;
  estimated_restore: string | null;
  zone_raw: string;
}

export interface ParseResult {
  status: ScrapeStatus;
  snapshot_ts: string;
  observations: Observation[];
  error: string | null;
}

const NODE_ELEMENT = 1;

interface Queryable {
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

function elements(root: Queryable, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector)) as unknown as Element[];
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface ZoneLine {
  text: string;
  strong: string | null;
}

// Reading the DOM rather than the raw HTML normalizes away both &bull; and the
// 2022 rewrite of <br/> to <br>.
function zoneLines(cell: Element): ZoneLine[] {
  const lines: ZoneLine[] = [];
  let parts: string[] = [];
  let strong: string | null = null;

  const flush = () => {
    lines.push({ text: collapse(parts.join("")), strong });
    parts = [];
    strong = null;
  };

  for (const node of Array.from(cell.childNodes) as Node[]) {
    const el = node as unknown as Element;
    if (node.nodeType === NODE_ELEMENT && el.tagName === "BR") {
      flush();
      continue;
    }
    if (node.nodeType === NODE_ELEMENT && el.tagName === "STRONG") {
      strong = collapse(el.textContent ?? "");
    }
    parts.push(node.textContent ?? "");
  }
  flush();

  return lines.filter((l) => l.text !== "" || l.strong !== null);
}

interface ZoneEntry {
  pt_name: string;
  blocks: number;
  zone_raw: string;
}

// Cell shape, repeated once per punct termic:
//   Punct termic: <strong>NAME</strong> -- N blocuri/imobile<br>&bull; street<br>...
function parseZoneCell(cell: Element): ZoneEntry[] {
  const entries: ZoneEntry[] = [];
  let current: { pt_name: string; blocks: number; streets: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    entries.push({
      pt_name: current.pt_name,
      blocks: current.blocks,
      zone_raw: current.streets.map((s) => `• ${s}`).join(" "),
    });
  };

  for (const line of zoneLines(cell)) {
    if (line.strong !== null && /Punct termic:/i.test(line.text)) {
      flush();
      // Negatives are CMTEB's own data-entry bug, kept as scraped
      const blocks = /--\s*(-?\d+)\s*blocuri\/imobile/i.exec(line.text);
      if (blocks === null) throw new Error(`unparseable block count: ${line.text}`);
      current = {
        pt_name: line.strong,
        blocks: Number.parseInt(blocks[1], 10),
        streets: [],
      };
      continue;
    }
    const street = line.text.replace(/^•\s*/, "");
    if (current !== null && street !== "") current.streets.push(collapse(street));
  }
  flush();

  return entries;
}

// DD.MM.YYYY HH:MM -> YYYY-MM-DDTHH:MM; literal Nedefinit -> null
function parseEstimate(raw: string): string | null {
  const text = collapse(raw);
  if (/^Nedefinit$/i.test(text)) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(text);
  if (m === null) throw new Error(`unparseable estimate: ${text}`);
  const [, dd, mm, yyyy, hh, min] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseRows(table: Element, snapshotTs: string): Observation[] {
  const observations: Observation[] = [];

  for (const row of elements(table, "tr")) {
    const cells = elements(row, "td");
    if (cells.length === 0) continue; // header row
    if (cells.length !== 5) throw new Error(`expected 5 cells, got ${cells.length}`);

    const [sectorCell, zoneCell, serviceCell, causeCell, estimateCell] = cells;

    const sector = Number.parseInt(collapse(sectorCell.textContent ?? ""), 10);
    if (!Number.isInteger(sector)) {
      throw new Error(`unparseable sector: ${sectorCell.textContent}`);
    }
    const service = collapse(serviceCell.textContent ?? "");
    const cause = collapse(causeCell.textContent ?? "");
    const estimated_restore = parseEstimate(estimateCell.textContent ?? "");

    // One row bundles 1..N puncte termice under a shared cause/estimate
    for (const entry of parseZoneCell(zoneCell)) {
      observations.push({
        snapshot_ts: snapshotTs,
        sector,
        pt_name: entry.pt_name,
        blocks: entry.blocks,
        service,
        cause,
        estimated_restore,
        zone_raw: entry.zone_raw,
      });
    }
  }

  return observations;
}

// Only the first table.raport ("Toate sectoarele") is read -- it is an exact union of
// the six per-sector tables and is the one block always present.
export function parseSnapshot(html: string, snapshotTs: string): ParseResult {
  const failed = (error: string): ParseResult => ({
    status: "parse_error",
    snapshot_ts: snapshotTs,
    observations: [],
    error,
  });

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc === null) return failed("document did not parse");

    const tables = elements(doc, "table.raport");
    if (tables.length === 0) {
      // A zero-incident page still renders the flag-galben banner; a backend failure
      // renders neither it nor any table.
      const banner = doc.querySelector(".flag-galben");
      return {
        status: banner !== null ? "empty" : "error",
        snapshot_ts: snapshotTs,
        observations: [],
        error: null,
      };
    }

    const observations = parseRows(tables[0], snapshotTs);
    if (observations.length === 0) {
      return failed("table.raport present but yielded no observations");
    }
    return { status: "ok", snapshot_ts: snapshotTs, observations, error: null };
  } catch (err) {
    // Never throw: a markup change must not cost the snapshot commit
    return failed(err instanceof Error ? err.message : String(err));
  }
}
