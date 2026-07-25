// CMTEB's system-map registry: the authoritative list of thermal points, with the
// coordinates that serve as identity evidence for ADR 0002. Pure: no file I/O or network.
//
// Only the stable fields are captured. The page also carries live outage state
// (`stare`, `tip`, `remediere`, and `culoare`, which is 1:1 with `tip`), but that
// duplicates data/current.json and lags it -- the map has shown a point green while the
// status page reported it down -- so the status page stays the single source for state.

import { parseRows, sameHeader } from "./csv.ts";

export const REGISTRY_PATH = "data/thermal_points.csv";
export const REGISTRY_HEADER = ["name", "latitude", "longitude"];

// The page splits its points across three arrays by outage state; the registry is their union.
const FEATURE_ARRAYS = ["verde", "galben", "rosu"];

export interface ThermalPoint {
  // Exactly as published, padding included: 172 of the 951 names carry leading or
  // trailing whitespace, and it is load-bearing -- ADR 0002 keeps `Complex Comercial `
  // and `Complex Comercial` apart as points 0.60 km from each other.
  name: string;
  latitude: number;
  longitude: number;
}

// Reads one bracketed JSON array starting at `open`, tracking string literals so a
// bracket inside a name cannot end the scan early.
function readArray(html: string, open: number): string {
  let depth = 0;
  let inString = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return html.slice(open, i + 1);
  }
  throw new Error(`unterminated array at offset ${open}`);
}

// Row order must depend only on the data, or the daily re-scrape commits reordering
// noise. The (name, latitude, longitude) triple is unique across all 951 rows, so it
// is both the sort key and the row key -- name alone is not, since `P.D.` names two
// points 3.71 km apart.
function compare(a: ThermalPoint, b: ThermalPoint): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.latitude !== b.latitude) return a.latitude - b.latitude;
  return a.longitude - b.longitude;
}

export function parseRegistry(html: string): ThermalPoint[] {
  const points: ThermalPoint[] = [];
  for (const name of FEATURE_ARRAYS) {
    const marker = html.indexOf(`passedFeatures_${name}`);
    if (marker === -1) throw new Error(`passedFeatures_${name} not found`);
    const open = html.indexOf("[", marker);
    if (open === -1) throw new Error(`passedFeatures_${name} has no array`);
    for (const f of JSON.parse(readArray(html, open))) {
      points.push({ name: f.denumire, latitude: f.latitudine, longitude: f.longitudine });
    }
  }
  if (points.length === 0) throw new Error("registry parsed to zero points");
  return points.sort(compare);
}

// The name is always quoted, unlike the foundation CSVs' minimal quoting: its padding
// would otherwise sit unmarked at a field boundary, where an editor or a whitespace-
// trimming tool would silently eat the distinction ADR 0002 depends on.
function formatName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function toCsv(points: ThermalPoint[]): string {
  const lines = [REGISTRY_HEADER.join(",")];
  for (const p of points) lines.push(`${formatName(p.name)},${p.latitude},${p.longitude}`);
  return lines.join("\n") + "\n";
}

export function fromCsv(content: string): ThermalPoint[] {
  const rows = parseRows(content);
  if (!sameHeader(rows[0], REGISTRY_HEADER)) throw new Error("unexpected registry header");
  return rows.slice(1).map(([name, lat, lon]) => ({
    name,
    latitude: Number(lat),
    longitude: Number(lon),
  }));
}
