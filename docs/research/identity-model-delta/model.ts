// Builds the four identity models the ladder measures, as label -> (identity, sector)
// rewrite tables over the observation corpus.
//
//   baseline  the derivation as shipped: (sector, raw label)
//   partial   strip " - Partial" once, nothing else, sector kept    (reproduces #54)
//   canon     ADR 0002 canonicalization, sector kept
//   full      canon + shorthand resolution + sector dropped         (the decided model)
//
// Sector is dropped by rewriting it to the identity's canonical sector (most recent
// label wins), which makes it a function of the identity -- so every key that contains
// it collapses exactly as removing it would, while sector_cause_slip stays a real
// backoff level and the sector column stays populated.

import { canonicalName, wideCanonicalName } from "./identity.ts";

export interface Cell {
  sector: string;
  label: string;
  n: number;
  first: string;
  last: string;
}

export type Model = "baseline" | "partial" | "canon" | "canon_shorthand" | "full" | "full_wide";

// (sector, label) -> the rewritten (sector, pt_name) the derivation should key on.
export type RewriteTable = Map<string, { sector: string; pt_name: string }>;

export function cellKey(sector: string, label: string): string {
  return `${sector}${label}`;
}

export interface ShorthandResolution {
  id: string;
  n: number;
  lastSeen: string;
  candidates: string[];
  resolvedTo: string | null;
  reason: "forced" | "street_overlap" | "no_candidate" | "ambiguous" | "degenerate";
}

// A shorthand label resolves when the resolution is forced: exactly one registry name
// contains it. Several candidates break the tie on street-set overlap; no candidate, a
// degenerate (empty) label, or a tie that survives stays its own identity, recorded
// unresolved rather than guessed.
export function resolveShorthand(
  cells: Cell[],
  registryNames: Set<string>,
  streetsOf: (id: string) => Set<string>,
): ShorthandResolution[] {
  const identityObs = new Map<string, { n: number; last: string }>();
  for (const cell of cells) {
    const id = canonicalName(cell.label);
    const entry = identityObs.get(id) ?? { n: 0, last: "" };
    entry.n += cell.n;
    if (cell.last > entry.last) entry.last = cell.last;
    identityObs.set(id, entry);
  }

  const out: ShorthandResolution[] = [];
  for (const [id, entry] of identityObs) {
    if (registryNames.has(id)) continue;
    if (id === "") {
      out.push({
        id,
        n: entry.n,
        lastSeen: entry.last,
        candidates: [],
        resolvedTo: null,
        reason: "degenerate",
      });
      continue;
    }
    const candidates = [...registryNames].filter((n) => n.includes(id)).sort();
    if (candidates.length === 0) continue;
    if (candidates.length === 1) {
      out.push({
        id,
        n: entry.n,
        lastSeen: entry.last,
        candidates,
        resolvedTo: candidates[0],
        reason: "forced",
      });
      continue;
    }
    const own = streetsOf(id);
    const scored = candidates
      .map((c) => {
        const other = streetsOf(c);
        const shared = [...own].filter((s) => other.has(s)).length;
        const union = new Set([...own, ...other]).size;
        return { c, jaccard: union === 0 ? 0 : shared / union };
      })
      .sort((a, b) => b.jaccard - a.jaccard);
    const clear = scored[0].jaccard > 0 && scored[0].jaccard > scored[1].jaccard;
    out.push({
      id,
      n: entry.n,
      lastSeen: entry.last,
      candidates,
      resolvedTo: clear ? scored[0].c : null,
      reason: clear ? "street_overlap" : "ambiguous",
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

export function buildRewriteTable(
  model: Model,
  cells: Cell[],
  shorthand: ShorthandResolution[],
  canonicalSector: Map<string, string>,
): RewriteTable {
  const shorthandMap = new Map(
    shorthand.filter((s) => s.resolvedTo !== null).map((s) => [s.id, s.resolvedTo!]),
  );

  const table: RewriteTable = new Map();
  for (const cell of cells) {
    let pt_name: string;
    if (model === "baseline") {
      pt_name = cell.label;
    } else if (model === "partial") {
      pt_name = cell.label.endsWith(" - Partial")
        ? cell.label.slice(0, -" - Partial".length)
        : cell.label;
    } else {
      pt_name = model === "full_wide" ? wideCanonicalName(cell.label) : canonicalName(cell.label);
      if (model !== "canon") pt_name = shorthandMap.get(pt_name) ?? pt_name;
    }
    const sector = model === "full" || model === "full_wide"
      ? (canonicalSector.get(pt_name) ?? cell.sector)
      : cell.sector;
    table.set(cellKey(cell.sector, cell.label), { sector, pt_name });
  }
  return table;
}
