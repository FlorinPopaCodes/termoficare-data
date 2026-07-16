// Serializes a parse result into the data/current.json contract
// Byte-deterministic: fixed key order, 2-space indent, outages in page order.

import type { ParseResult } from "./parser.ts";

export const SCHEMA_VERSION = 1;
export const SOURCE_URL = "https://www.cmteb.ro/functionare_sistem_termoficare.php";

// Every observation shares one snapshot_ts, so it is lifted to the envelope.
// Consumers trust outages only when status is ok or empty.
export function toCurrentJson(result: ParseResult): string {
  const doc = {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_URL,
    scraped_at: result.snapshot_ts,
    status: result.status,
    outages: result.observations.map((o) => ({
      sector: o.sector,
      pt_name: o.pt_name,
      blocks: o.blocks,
      service: o.service,
      cause: o.cause,
      estimated_restore: o.estimated_restore,
      zone_raw: o.zone_raw,
    })),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}
