// Builds the structured artifacts for one scrape. Fault-isolated: a parser crash
// degrades to parse_error, it never costs the snapshot commit.

import { type ParseResult, parseSnapshot, type ScrapeStatus } from "./parser.ts";
import { toCurrentJson } from "./current_json.ts";
import { type CsvValue } from "./csv.ts";

export interface SnapshotArtifacts {
  status: ScrapeStatus;
  currentJson: string;
  observations: CsvValue[][];
  logRow: CsvValue[];
}

export type Parser = (html: string, snapshotTs: string) => ParseResult;

export function buildArtifacts(
  html: string,
  snapshotTs: string,
  parse: Parser = parseSnapshot,
): SnapshotArtifacts {
  let result: ParseResult;
  try {
    result = parse(html, snapshotTs);
  } catch (err) {
    // parseSnapshot already self-catches; this guards the seam itself against a
    // swapped-in Parser that doesn't.
    result = {
      status: "parse_error",
      snapshot_ts: snapshotTs,
      observations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Column order is OBSERVATION_HEADER's; snapshot_test asserts the two stay in step.
  // Nedefinit is null in JSON but an empty CSV field.
  const observations: CsvValue[][] = result.observations.map((o) => [
    o.snapshot_ts,
    o.sector,
    o.pt_name,
    o.blocks,
    o.service,
    o.cause,
    o.estimated_restore ?? "",
    o.zone_raw,
  ]);

  return {
    status: result.status,
    currentJson: toCurrentJson(result),
    observations,
    logRow: [snapshotTs, result.status, observations.length],
  };
}
