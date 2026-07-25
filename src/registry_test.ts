import { assertEquals, assertThrows } from "@std/assert";
import { fromCsv, parseRegistry, REGISTRY_HEADER, type ThermalPoint, toCsv } from "./registry.ts";

// The page always emits all three arrays -- its own Leaflet loops iterate them
// unconditionally -- so a colour left out here stands for "no points in that state".
function page(arrays: Record<string, string>): string {
  const lines = ["<html><script>"];
  for (const color of ["verde", "galben", "rosu"]) {
    lines.push(`\tvar passedFeatures_${color} = ${arrays[color] ?? "[]"};`);
  }
  return lines.join("\n") + "\n</script></html>";
}

const feature = (denumire: string, latitudine: number, longitudine: number) =>
  JSON.stringify({
    stare: "Functionare normala",
    culoare: "#008217",
    denumire,
    longitudine,
    latitudine,
    tip: "-",
  });

const THREE_ARRAYS = page({
  verde: `[${feature("1 C3/1", 44.432576444788, 26.164120976753)}]`,
  galben: `[${feature("Galvani Tei ", 44.459736244268, 26.11061765533)}]`,
  rosu: `[${feature("IN CITY", 44.420154, 26.133433)}]`,
});

Deno.test("points are collected from all three state arrays", () => {
  assertEquals(parseRegistry(THREE_ARRAYS).map((p) => p.name), [
    "1 C3/1",
    "Galvani Tei ",
    "IN CITY",
  ]);
});

Deno.test("only name and coordinates are kept", () => {
  assertEquals(parseRegistry(page({ verde: `[${feature("1 C3/1", 44.4, 26.1)}]` })), [
    { name: "1 C3/1", latitude: 44.4, longitude: 26.1 },
  ]);
});

Deno.test("rows sort by the (name, latitude, longitude) triple", () => {
  // `P.D.` names two points 3.71 km apart, so name alone does not order them.
  const html = page({
    verde: `[${feature("P.D.", 44.431139, 26.172722)},${feature("B", 44.4, 26.1)},${
      feature("P.D.", 44.403173, 26.147206)
    }]`,
  });
  assertEquals(parseRegistry(html).map((p) => [p.name, p.latitude]), [
    ["B", 44.4],
    ["P.D.", 44.403173],
    ["P.D.", 44.431139],
  ]);
});

Deno.test("a bracket inside a name does not end the array scan", () => {
  const html = page({
    verde: `[${feature("Sala [Mihai]", 44.4, 26.1)},${feature("Z", 44.5, 26.2)}]`,
  });
  assertEquals(parseRegistry(html).map((p) => p.name), ["Sala [Mihai]", "Z"]);
});

// Either shape means the page changed under us; committing the truncated result would
// silently delete thermal points from the registry.
Deno.test("a missing feature array is an error, never a partial registry", () => {
  const missingRosu =
    "<html><script>var passedFeatures_verde = [];\nvar passedFeatures_galben = [];</script></html>";
  assertThrows(() => parseRegistry(missingRosu), Error, "passedFeatures_rosu not found");
});

Deno.test("three empty arrays are an error, never a silent empty registry", () => {
  assertThrows(() => parseRegistry(page({})), Error, "zero points");
});

Deno.test("names round-trip through CSV with their padding intact", () => {
  // 172 of the 951 published names are whitespace-padded and two carry an internal
  // double space; ADR 0002's canonicalization must see them as CMTEB published them.
  const points: ThermalPoint[] = [
    { name: "4 Pantelimon ", latitude: 44.4, longitude: 26.1 },
    { name: " Ct Marasesti 9-10", latitude: 44.5, longitude: 26.2 },
    { name: "MILITARI -  6 Placare", latitude: 44.6, longitude: 26.3 },
    { name: "ITIB 1,2", latitude: 44.7, longitude: 26.4 },
    { name: 'Liceul Tehnologic "Petru Poni"', latitude: 44.8, longitude: 26.5 },
  ];
  assertEquals(fromCsv(toCsv(points)), points);
});

Deno.test("the CSV carries the declared header and quotes every name", () => {
  const csv = toCsv([{ name: "1 C3/1", latitude: 44.432576444788, longitude: 26.164120976753 }]);
  assertEquals(csv, `${REGISTRY_HEADER.join(",")}\n"1 C3/1",44.432576444788,26.164120976753\n`);
});

Deno.test("fromCsv rejects a file whose header is not the registry's", () => {
  assertThrows(() => fromCsv('name,lat,lon\n"a",1,2\n'));
});
