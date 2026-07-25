// Address→thermal-point resolution per the decision on #56, as pure functions over a
// `zone_raw` string and a point label. Reference implementation: no file I/O, no network.
//
// The grammar is #53's, verified across all 6,849,152 segments in the corpus:
//
//   zone_raw  := segment ( "•" segment )*
//   segment   := TYPE " " street " - " blocklist
//   blocklist := token ( ("," | ";") token )*
//
// Splitting on the FIRST " - " extracts the street correctly in every segment -- no
// street name in the corpus contains a spaced hyphen -- so the five segments whose block
// list carries a second " - " keep it rather than losing their tail.

import { foldFoldables } from "../identity-model-delta/identity.ts";

// A genuinely closed set: zero of the 6.85M segments begin with anything else.
export const STREET_TYPES = ["Str", "Ale", "Bld", "Şos", "Cal", "Int", "Drm", "Prl", "Spl", "Pţa"];
const STREET_TYPE_SET = new Set(STREET_TYPES.map(foldFoldables));

// Longest-first: `imobil 3` must not be eaten by the `imob` alternative, and `imob.Nr.56`
// carries two.
const BLOCK_PREFIXES = ["imobil", "imob.", "imob", "Nr.", "nr.", "no.", "Bl.", "BL.", "bl.", "bl"]
  .sort((a, b) => b.length - a.length);

// Institutional entries are out of scope -- the target is flats. `institutie`, `parohie`,
// `vila` and `complex comercial` are matched whole because they are the entry in full;
// the rest are substrings of longer names (`Policlinica Teius`, `Cresa Sf. Stelian`).
const INSTITUTION =
  /^(institutie|parohie|vila|complex comercial)$|gradinit|scoal|liceu|spital|policlinic|camin|cresa|crese|biseric|banc|institut|primari|colegiu|universit|tribunal|politie|farmaci|piata|hotel|restaurant|magazin|sediu|centru|azil|dispensar|comunitat/;

export interface Segment {
  street: string;
  blocks: string[];
  /** True when the segment named a street but carried no block list (`Str Popa Lazăr -`). */
  dangling: boolean;
}

function stripBlockPrefix(token: string): string {
  let s = token.trim();
  for (let more = true; more;) {
    more = false;
    for (const p of BLOCK_PREFIXES) {
      if (s.toLowerCase().startsWith(p.toLowerCase())) {
        s = s.slice(p.length).trim();
        more = true;
        break;
      }
    }
  }
  return s;
}

// A token names a building when it bears a digit or is a single letter. The single-letter
// case is load-bearing: blocks A, B and C are 165,636 observations across 37 thermal
// points, and #53's taxonomy filed them with the institutions.
export function isBlockLabel(core: string): boolean {
  if (!core || INSTITUTION.test(core)) return false;
  if (/^[a-z]$/.test(core)) return true;
  return /\d/.test(core) && !/^[.\s]/.test(core);
}

/** Normalizes a block label. Suffixes are never stripped -- `4` and `4Bis` are different buildings. */
export function normalizeBlock(core: string): string {
  return foldFoldables(core);
}

/** Normalizes a street name, dropping the street type -- `Str Tohani` and `Ale Tohani` are one street. */
export function normalizeStreet(streetPart: string): string | null {
  const words = streetPart.trim().split(/\s+/);
  if (words.length < 2 || !STREET_TYPE_SET.has(foldFoldables(words[0]))) return null;
  return foldFoldables(words.slice(1).join(" ")) || null;
}

export function parseZone(zoneRaw: string): Segment[] {
  const out: Segment[] = [];
  for (const raw of zoneRaw.split("•")) {
    const segment = raw.trim();
    if (!segment) continue;
    const cut = segment.indexOf(" - ");
    if (cut < 0) {
      // No block list at all. Still evidence that this point serves this street.
      const street = normalizeStreet(segment.replace(/\s*-\s*$/, ""));
      if (street) out.push({ street, blocks: [], dangling: true });
      continue;
    }
    const street = normalizeStreet(segment.slice(0, cut));
    if (!street) continue;
    // ` - instituţie` is a droppable suffix on 15 segments; any other second ` - ` lives
    // inside the block list and must survive.
    const tail = segment.slice(cut + 3).trim().replace(/\s*-\s*institu[tţ]ie\s*$/i, "");
    const blocks = tail.split(/[,;]/)
      .map(stripBlockPrefix)
      .map(normalizeBlock)
      .filter(isBlockLabel);
    out.push({ street, blocks, dangling: blocks.length === 0 });
  }
  return out;
}

export function addressKey(street: string, block: string): string {
  return `${street}|${block}`;
}

/**
 * The alias table decided on #56. `street` is empty for a label that resolves the same way
 * everywhere; it is set only for the five shorthand labels that blend the Titan and
 * Militari estates, which no other field on the observation separates.
 */
export interface AliasRow {
  alias: string;
  street: string;
  canonical: string;
}

export function buildAliasIndex(rows: AliasRow[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of rows) index.set(r.street ? `${r.alias}|${r.street}` : r.alias, r.canonical);
  return index;
}

/** Applies the alias table to an already-canonical point label. Street-scoped rows win. */
export function resolveAlias(
  index: Map<string, string>,
  canonical: string,
  streets: readonly string[],
): string {
  for (const street of streets) {
    const scoped = index.get(`${canonical}|${street}`);
    if (scoped) return scoped;
  }
  return index.get(canonical) ?? canonical;
}
