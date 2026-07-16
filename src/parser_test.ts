import { assertEquals } from "@std/assert";
import { parseSnapshot } from "./parser.ts";

const TS = "2026-07-17T12:00:00";

function parse(html: string) {
  return parseSnapshot(html, TS);
}

function page(rows: string): string {
  return `<html><body><table class='table table-condensed table-hover raport'>
    <tr><th>Sector</th><th>Zone afectate</th><th>Agentul termic afectat</th>
        <th>Cauza</th><th>Data/ora estimării</th></tr>
    ${rows}</table></body></html>`;
}

function row(
  zone: string,
  service = "Oprire ACC",
  cause = "Remediere avarie",
  estimate = "17.07.2026 20:00",
) {
  return `<tr><td>1</td><td>${zone}</td><td>${service}</td><td>${cause}</td><td>${estimate}</td></tr>`;
}

Deno.test("single PT row yields one observation with its street list", () => {
  const result = parse(page(row(
    "Punct termic: <strong>MODUL TERMIC B3</strong> -- 1 blocuri/imobile<br>&bull; Str Hrisovului - bl. B3<br>",
  )));

  assertEquals(result.status, "ok");
  assertEquals(result.observations, [{
    snapshot_ts: TS,
    sector: 1,
    pt_name: "MODUL TERMIC B3",
    blocks: 1,
    service: "Oprire ACC",
    cause: "Remediere avarie",
    estimated_restore: "2026-07-17T20:00",
    zone_raw: "• Str Hrisovului - bl. B3",
  }]);
});

Deno.test("every observation is stamped with the snapshot's own timestamp", () => {
  const result = parse(page(row(
    "Punct termic: <strong>A</strong> -- 1 blocuri/imobile<br>&bull; Str A<br>" +
      "Punct termic: <strong>B</strong> -- 1 blocuri/imobile<br>&bull; Str B<br>",
  )));

  assertEquals(result.snapshot_ts, TS);
  assertEquals(result.observations.map((o) => o.snapshot_ts), [TS, TS]);
});

Deno.test("multi-PT row explodes, duplicating cause/estimate and splitting streets", () => {
  const result = parse(page(row(
    "Punct termic: <strong>2 Prefabricate </strong> -- 6 blocuri/imobile<br>&bull; Cal Griviţei - bl. 1, 2, 3<br>&bull; Str Rucăr - Nr.5<br>" +
      "Punct termic: <strong>6 ACM</strong> -- 7 blocuri/imobile<br>&bull; Str Lainici - Imobil Nr.5<br>",
  )));

  assertEquals(result.observations.length, 2);
  assertEquals(result.observations[0].pt_name, "2 Prefabricate"); // trailing space trimmed
  assertEquals(result.observations[0].blocks, 6);
  assertEquals(result.observations[0].zone_raw, "• Cal Griviţei - bl. 1, 2, 3 • Str Rucăr - Nr.5");
  assertEquals(result.observations[1].pt_name, "6 ACM");
  assertEquals(result.observations[1].blocks, 7);
  assertEquals(result.observations[1].zone_raw, "• Str Lainici - Imobil Nr.5");
  assertEquals(result.observations[0].cause, result.observations[1].cause);
  assertEquals(result.observations[0].estimated_restore, result.observations[1].estimated_restore);
});

Deno.test("literal Nedefinit becomes null, not a string or a guessed time", () => {
  const result = parse(page(row(
    "Punct termic: <strong>Sora</strong> -- 1 blocuri/imobile<br>&bull; Cal Griviţei<br>",
    "Oprire ACC",
    "Revizie",
    "Nedefinit",
  )));

  assertEquals(result.observations[0].estimated_restore, null);
});

Deno.test("negative block counts are kept as scraped", () => {
  const result = parse(page(row(
    "Punct termic: <strong>PT bug</strong> -- -6 blocuri/imobile<br>&bull; Str Test<br>",
  )));

  assertEquals(result.observations[0].blocks, -6);
});

Deno.test("old-era self-closed <br/> markup parses identically to new-era <br>", () => {
  const zone = (br: string) =>
    `Punct termic: <strong>Sora</strong> -- 2 blocuri/imobile${br}&bull; Str A${br}&bull; Str B${br}`;

  assertEquals(
    parse(page(row(zone("<br/>")))).observations,
    parse(page(row(zone("<br>")))).observations,
  );
});

Deno.test("whitespace in cells is collapsed", () => {
  const result = parse(page(row(
    "Punct termic: <strong>  MODUL\n  TERMIC  </strong> -- 1 blocuri/imobile<br>&bull;  Str   Hrisovului \n - bl. B3<br>",
    "Oprire ACC",
    "Remediere avarie circuit primar ",
  )));

  assertEquals(result.observations[0].pt_name, "MODUL TERMIC");
  assertEquals(result.observations[0].cause, "Remediere avarie circuit primar");
  assertEquals(result.observations[0].zone_raw, "• Str Hrisovului - bl. B3");
});

Deno.test("zero-incident banner is empty, not error", () => {
  const html = `<html><body><div id="ST" class="tab-pane fade in active">
    <div class='flag-galben'> Nu există înregistrări pentru niciun sector. </div>
    </div></body></html>`;

  const result = parse(html);

  assertEquals(result.status, "empty");
  assertEquals(result.observations, []);
  assertEquals(result.error, null);
});

Deno.test("backend failure page — no tables, no banner — is error", () => {
  const html = `<html><body><div class='container'>chrome only</div></body>
    </html>Eroare de conexiune: Failed connect to avarii-api.cmteb.ro:443; No route to host`;

  const result = parse(html);

  assertEquals(result.status, "error");
  assertEquals(result.observations, []);
  assertEquals(result.error, null);
});

Deno.test("table present but rows unreadable is parse_error, never empty", () => {
  const result = parse(page(row("Cal Griviţei - bl.Sora")));

  assertEquals(result.status, "parse_error");
  assertEquals(result.observations, []);
});

Deno.test("an unreadable block count fails the snapshot rather than inventing a number", () => {
  const result = parse(page(row(
    "Punct termic: <strong>Sora</strong> -- many blocuri/imobile<br>&bull; Str A<br>",
  )));

  assertEquals(result.status, "parse_error");
});

Deno.test("an unreadable estimate fails the snapshot rather than dropping the column", () => {
  const result = parse(page(row(
    "Punct termic: <strong>Sora</strong> -- 1 blocuri/imobile<br>&bull; Str A<br>",
    "Oprire ACC",
    "Revizie",
    "2026-07-17 20:00",
  )));

  assertEquals(result.status, "parse_error");
});

Deno.test("parse_error carries a diagnostic naming what broke", () => {
  const noBlocks = parse(page(row(
    "Punct termic: <strong>Sora</strong> -- many blocuri/imobile<br>&bull; Str A<br>",
  )));
  const noRows = parse(page(row("Cal Griviţei - bl.Sora")));

  assertEquals(
    noBlocks.error,
    "unparseable block count: Punct termic: Sora -- many blocuri/imobile",
  );
  assertEquals(noRows.error, "table.raport present but yielded no observations");
  assertEquals(
    parse(page(row("Punct termic: <strong>A</strong> -- 1 blocuri/imobile<br>&bull; S<br>"))).error,
    null,
  );
});

Deno.test("only the first table.raport is read", () => {
  const oneRow = row(
    "Punct termic: <strong>Sora</strong> -- 1 blocuri/imobile<br>&bull; Str A<br>",
  );
  const perSector = `<table class='table raport'>${
    row("Punct termic: <strong>Sora</strong> -- 1 blocuri/imobile<br>&bull; Str A<br>")
  }</table>`;

  const result = parse(page(oneRow) + perSector);

  assertEquals(result.observations.length, 1);
});

Deno.test("parsing the same html twice yields identical rows", () => {
  const html = page(row(
    "Punct termic: <strong>Sora</strong> -- 1 blocuri/imobile<br>&bull; Str A<br>",
  ));

  assertEquals(parse(html), parse(html));
});
