// Serializes a parse result into the data/current.json contract
// Byte-deterministic: fixed key order, 2-space indent, outages in page order.

import type { ParseResult } from "./parser.ts";
import { type PredictionContext, predictOutage } from "./on_time.ts";

export const SCHEMA_VERSION = 2;
export const SOURCE_URL = "https://www.cmteb.ro/functionare_sistem_termoficare.php";

// Every observation shares one snapshot_ts, so it is lifted to the envelope.
// Consumers trust outages only when status is ok or empty.
// The prediction context is optional: without it (derived rate files absent) and for
// outages with no posted estimate, the on-time fields are omitted, never null.
export function toCurrentJson(
  result: ParseResult,
  prediction: PredictionContext | null = null,
): string {
  const doc = {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_URL,
    scraped_at: result.snapshot_ts,
    status: result.status,
    outages: result.observations.map((o) => {
      const p = prediction !== null && o.estimated_restore !== null
        ? predictOutage(o, o.estimated_restore, result.snapshot_ts, prediction)
        : null;
      return {
        sector: o.sector,
        pt_name: o.pt_name,
        blocks: o.blocks,
        service: o.service,
        cause: o.cause,
        estimated_restore: o.estimated_restore,
        ...(p === null ? {} : {
          on_time_probability: p.on_time_probability,
          basis_n: p.basis_n,
          basis_bucket: p.basis_bucket,
        }),
        zone_raw: o.zone_raw,
      };
    }),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}
