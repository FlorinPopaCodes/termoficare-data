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
  /**
   * True when the segment yielded no address: the block list was absent (`Str Popa Lazăr -`,
   * 2.11% of segments) or held nothing indexable (`Str Castranova - Casa Ilie`, 2.44%). Both
   * behave alike downstream -- the street is still evidence that this point serves it.
   */
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

// A staircase reference: `sc.A`, `sc. 7-13`, `scara 2`. As a suffix it rides along on the
// block token (`19 sc.A`); standing alone it names no building of its own.
const STAIRCASE = /\bsc\.?\s*[a-z0-9]|\bscara\b/;
const STAIRCASE_ONLY = /^(sc\.?\s*|scara\s+)[a-z0-9]/;

// A token names a building when it bears a digit or is a single letter. The single-letter
// case is load-bearing: standalone blocks A, B and C are 296,780 token instances, and
// #53's taxonomy filed them with the institutions.
//
// NOT SUFFICIENT ON ITS OWN for a single letter: whether `B` is block B or staircase B of
// the preceding block depends on what came before it, which only `parseZone` sees. Calling
// this predicate directly over a block list reintroduces the phantom addresses parseZone
// exists to exclude.
export function isBlockLabel(core: string): boolean {
  if (!core || INSTITUTION.test(core) || STAIRCASE_ONLY.test(core)) return false;
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
    // A block's staircases are enumerated as bare letters after it -- `bl. 71 sc. A, B, C`
    // is one building, not three. The run opens on a token carrying a staircase marker and
    // closes on the next token that names a building, so those letters are not addresses.
    let inStaircaseRun = false;
    const blocks: string[] = [];
    for (const token of tail.split(/[,;]/)) {
      const core = normalizeBlock(stripBlockPrefix(token));
      if (!isBlockLabel(core)) {
        if (STAIRCASE.test(core)) inStaircaseRun = true;
        continue;
      }
      if (inStaircaseRun && /^[a-z]$/.test(core)) continue;
      inStaircaseRun = STAIRCASE.test(core);
      blocks.push(core);
    }
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
 *
 * Precondition, measured rather than assumed: of the 44 distinct `zone_raw` strings that
 * touch a street-scoped row, none names streets belonging to different estates. Were one
 * to, `resolveAlias` below would pick by street order -- an arbitrary tiebreak. Re-check
 * if the corpus grows.
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
