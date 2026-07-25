// Thermal-point identity per ADR 0002, as a pure function over a point label.
//
// Ordered, anchored pipeline -- never a generic split on the last " - ":
//   1. strip a trailing qualifier only by exact match against a closed list
//   2. fold diacritics and casing
//   3. collapse internal whitespace runs and trim
//
// Retained deliberately: the prime marker, the `-T` / `MILITARI - ` estate qualifiers,
// and the `1Placare`/`1 Placare` spacing distinction (whitespace is collapsed, never
// deleted).

export const QUALIFIER_SUFFIXES = [" - Partial", " - Module Termice", " - MODULE TERMICE"];

// Repeats until no suffix matches: 13 labels carry both qualifiers stacked
// ("SC 1/2 - MODULE TERMICE - Partial"), and a single pass leaves those split from their
// base.
export function stripQualifier(label: string): string {
  let s = label;
  for (let more = true; more;) {
    more = false;
    for (const suffix of QUALIFIER_SUFFIXES) {
      if (s.endsWith(suffix)) {
        s = s.slice(0, -suffix.length);
        more = true;
        break;
      }
    }
  }
  return s;
}

export function foldFoldables(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function canonicalName(label: string): string {
  return foldFoldables(stripQualifier(label));
}

// The registry spells the same suffix four ways and pads 172 of its 951 names, so its
// names trim first and match a wider suffix list (ADR 0002, "Joining the registry").
const REGISTRY_SUFFIXES = [
  " - MODULE TERMICE",
  " - Module Termice",
  " -MODULE TERMICE",
  "-module",
];

// ADR 0002 states the widened suffix list is needed only to join the registry, and that
// applying it to the observations corpus "would change nothing" -- unmeasured there.
// This is that variant, so the claim can be tested.
export function wideCanonicalName(label: string): string {
  let s = label.replace(/\s+/g, " ").trim();
  const all = [...QUALIFIER_SUFFIXES, " -MODULE TERMICE", "-module"];
  for (let more = true; more;) {
    more = false;
    for (const suffix of all) {
      if (s.endsWith(suffix)) {
        s = s.slice(0, -suffix.length);
        more = true;
        break;
      }
    }
  }
  return foldFoldables(s);
}

export function canonicalRegistryName(name: string): string {
  let s = name.replace(/\s+/g, " ").trim();
  for (const suffix of REGISTRY_SUFFIXES) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return foldFoldables(s);
}
