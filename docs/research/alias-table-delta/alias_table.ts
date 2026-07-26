// ADR 0002 step 4 as a lookup, and the four-step pipeline that ends in it.
//
// Steps 1-3 are `wideCanonicalName` from the #61 harness, which #64 left as the reference
// implementation of the decided pipeline. Step 4 is `aliases.csv` read through
// `buildAliasIndex`/`resolveAlias` from the #56 harness, which is where the street-scoped
// lookup was decided. Nothing new is invented here: this file only wires the two together
// and canonicalizes the table's target column, which stores registry names as published.

import { wideCanonicalName } from "../identity-model-delta/identity.ts";
import {
  type AliasRow,
  buildAliasIndex,
  parseZone,
  resolveAlias,
} from "../address-resolution/address.ts";
import { parseRows } from "../../../src/csv.ts";

export type { AliasRow };

export function loadAliasRows(path: string): AliasRow[] {
  return parseRows(Deno.readTextFileSync(path)).slice(1)
    .filter((r) => r.length >= 3)
    .map((r) => ({ alias: r[0], street: r[1], canonical: r[2] }));
}

/** The table with its targets put through steps 1-3, which is the form the seam needs. */
export function decidedAliasIndex(rows: AliasRow[]): Map<string, string> {
  return buildAliasIndex(
    rows.map((r) => ({ ...r, canonical: wideCanonicalName(r.canonical) })),
  );
}

/** The five labels the table keys on `(label, street)` -- the only ones that read zone_raw. */
export function streetScopedAliases(rows: AliasRow[]): Set<string> {
  return new Set(rows.filter((r) => r.street !== "").map((r) => r.alias));
}

/**
 * How a street-scoped resolution is carried from `prepare.ts` to the seam. One definition,
 * because the two sides silently agree to disagree if it drifts: a mismatched separator
 * makes every lookup miss and every blended label fall through to itself, which is a
 * plausible-looking measurement of nothing.
 */
export function scopedKey(ts: string, sector: string, label: string): string {
  return `${ts}|${sector}|${label}`;
}

export interface Step4Result {
  identity: string;
  /** True when a street-scoped label found no matching street and fell through to itself. */
  fellThrough: boolean;
}

/**
 * ADR 0002 steps 1-4 over one observation row. The empty identity is the degenerate case
 * the ADR drops at this seam; callers decide, so that the cost of dropping it stays
 * measurable.
 */
export function decidedIdentity(
  index: Map<string, string>,
  streetScoped: Set<string>,
  label: string,
  zoneRaw: string,
): Step4Result {
  const canon = wideCanonicalName(label);
  if (canon === "" || !streetScoped.has(canon)) {
    return { identity: index.get(canon) ?? canon, fellThrough: false };
  }
  const identity = resolveAlias(index, canon, parseZone(zoneRaw).map((s) => s.street));
  return { identity, fellThrough: identity === canon };
}
