// The four models the ladder measures, as a rewrite at the observation -> derivation-key
// seam ADR 0002 names.
//
//   baseline            the derivation as shipped: (sector, raw label), nothing dropped
//   steps123_keepempty  ADR 0002 steps 1-3, sector dropped -- the model #64 left behind
//   steps123            + drop the row whose pt_name is empty
//   full                + step 4, the alias table                 (the decided model)
//
// Sector is dropped the way #61 dropped it: rewritten to the identity's canonical sector
// (most recent label wins), which makes it a function of the identity, so every key
// containing it collapses exactly as removing it would while `sector_cause_slip` stays a
// real backoff level and the sector column stays populated.

import { wideCanonicalName } from "../identity-model-delta/identity.ts";
import {
  type AliasRow,
  decidedAliasIndex,
  decidedIdentity,
  loadAliasRows,
  scopedKey,
  streetScopedAliases,
} from "./alias_table.ts";

export type Model = "baseline" | "steps123_keepempty" | "steps123" | "full";

export interface Context {
  rows: AliasRow[];
  index: Map<string, string>;
  streetScoped: Set<string>;
  /** (snapshot_ts, sector, label) -> target, for street-scoped rows only. From prepare.ts. */
  scoped: Map<string, string>;
  sectorOfCanon: Map<string, string>;
  sectorOfTarget: Map<string, string>;
  canonOf: Map<string, string>;
}

export function loadContext(work: string, aliasesPath: string): Context {
  const rows = loadAliasRows(aliasesPath);
  const read = (name: string) =>
    new Map<string, string>(JSON.parse(Deno.readTextFileSync(`${work}/${name}`)));
  return {
    rows,
    index: decidedAliasIndex(rows),
    streetScoped: streetScopedAliases(rows),
    scoped: read("street_scoped.json"),
    sectorOfCanon: read("sector_of_canon.json"),
    sectorOfTarget: read("sector_of_target.json"),
    canonOf: new Map(),
  };
}

export function canonical(ctx: Context, label: string): string {
  let canon = ctx.canonOf.get(label);
  if (canon === undefined) {
    canon = wideCanonicalName(label);
    ctx.canonOf.set(label, canon);
  }
  return canon;
}

export interface Key {
  sector: string;
  pt_name: string;
}

/** The seam. `null` means the row names no thermal point and is dropped. */
export function rewriteRow(
  model: Model,
  ctx: Context,
  ts: string,
  sector: string,
  label: string,
): Key | null {
  if (model === "baseline") return { sector, pt_name: label };
  const canon = canonical(ctx, label);
  if (canon === "") {
    if (model !== "steps123_keepempty") return null;
    return { sector: ctx.sectorOfCanon.get("") ?? sector, pt_name: "" };
  }
  if (model !== "full") {
    return { sector: ctx.sectorOfCanon.get(canon) ?? sector, pt_name: canon };
  }
  const target = ctx.streetScoped.has(canon)
    ? (ctx.scoped.get(scopedKey(ts, sector, label)) ?? canon)
    : (ctx.index.get(canon) ?? canon);
  return { sector: ctx.sectorOfTarget.get(target) ?? sector, pt_name: target };
}

/**
 * The seam over a live `current.json` row, which still carries its zone_raw and so needs
 * no lookup: the street-scoped rows resolve exactly, the way the derivation will.
 */
export function rewriteLive(
  model: Model,
  ctx: Context,
  sector: string,
  label: string,
  zoneRaw: string,
): Key | null {
  if (model === "baseline") return { sector, pt_name: label };
  const canon = canonical(ctx, label);
  if (canon === "") {
    if (model !== "steps123_keepempty") return null;
    return { sector: ctx.sectorOfCanon.get("") ?? sector, pt_name: "" };
  }
  if (model !== "full") {
    return { sector: ctx.sectorOfCanon.get(canon) ?? sector, pt_name: canon };
  }
  const target = decidedIdentity(ctx.index, ctx.streetScoped, label, zoneRaw).identity;
  return { sector: ctx.sectorOfTarget.get(target) ?? sector, pt_name: target };
}

/**
 * Where a claim carrying `(sector, pt_name)` under `from` can land under `to`. A list, not
 * a value: an estimate record carries no zone_raw, so the five street-scoped labels have
 * two possible destinations and the caller resolves by looking for the one that exists.
 */
export function candidateKeys(from: Model, to: Model, ctx: Context, key: Key): Key[] {
  if (to === "baseline") return [key];
  const canon = from === "baseline" ? canonical(ctx, key.pt_name) : key.pt_name;
  if (canon === "") return [{ sector: ctx.sectorOfCanon.get("") ?? key.sector, pt_name: "" }];
  if (to !== "full") {
    return [{ sector: ctx.sectorOfCanon.get(canon) ?? key.sector, pt_name: canon }];
  }
  const targets = ctx.streetScoped.has(canon)
    ? [
      ...new Set(
        ctx.rows.filter((r) => r.alias === canon).map((r) =>
          ctx.index.get(`${r.alias}|${r.street}`)!
        ),
      ),
    ]
    : [ctx.index.get(canon) ?? canon];
  return targets.map((t) => ({ sector: ctx.sectorOfTarget.get(t) ?? key.sector, pt_name: t }));
}
