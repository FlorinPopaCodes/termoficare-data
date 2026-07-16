// Writes the three parser-derived artifacts (observations, scrape log, current.json)
// for one snapshot. A throwing parser is caught here and downgraded to a parse_error
// result so a markup change never costs the raw HTML snapshot commit.

import { type ParseResult, parseSnapshot } from "./parser.ts";
import { toCurrentJson } from "./current_json.ts";
import { appendObservations, appendScrapeLog } from "./csv.ts";

export interface SnapshotArtifactPaths {
  currentJson: string;
  observationsDir: string;
  snapshotsDir: string;
}

type ParseFn = (html: string, snapshotTs: string) => ParseResult;

function safeParse(parse: ParseFn, html: string, snapshotTs: string): ParseResult {
  try {
    return parse(html, snapshotTs);
  } catch (err) {
    return {
      status: "parse_error",
      snapshot_ts: snapshotTs,
      observations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function writeSnapshotArtifacts(
  html: string,
  snapshotTs: string,
  paths: SnapshotArtifactPaths,
  parse: ParseFn = parseSnapshot,
): Promise<ParseResult> {
  const result = safeParse(parse, html, snapshotTs);

  await appendObservations(paths.observationsDir, result.observations);
  await appendScrapeLog(paths.snapshotsDir, result);
  await Deno.writeTextFile(paths.currentJson, toCurrentJson(result));

  return result;
}
