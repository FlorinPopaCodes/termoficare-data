import { assertEquals, assertRejects } from "@std/assert";
import { writeSnapshotArtifacts } from "./snapshot_artifacts.ts";
import { withTempDir } from "./test_util.ts";
import type { ParseResult } from "./parser.ts";

function paths(dir: string) {
  return {
    currentJson: `${dir}/current.json`,
    observationsDir: `${dir}/observations`,
    snapshotsDir: `${dir}/snapshots`,
  };
}

Deno.test("a throwing parser is downgraded to parse_error, not propagated", async () => {
  await withTempDir(async (dir) => {
    const throwingParse = () => {
      throw new Error("boom: markup changed");
    };

    const result = await writeSnapshotArtifacts(
      "<html></html>",
      "2026-07-01T07:06:36",
      paths(dir),
      throwingParse,
    );

    assertEquals(result.status, "parse_error");
    assertEquals(result.observations, []);
    assertEquals(result.error, "boom: markup changed");
  });
});

Deno.test("a throwing parser still yields a scrape-log row with zero observations", async () => {
  await withTempDir(async (dir) => {
    const throwingParse = (): ParseResult => {
      throw new Error("boom");
    };

    await writeSnapshotArtifacts("<html></html>", "2026-07-01T07:06:36", paths(dir), throwingParse);

    const log = await Deno.readTextFile(`${dir}/snapshots/2026-07.csv`);
    assertEquals(log, "snapshot_ts,status,observations\n2026-07-01T07:06:36,parse_error,0\n");

    const currentJson = JSON.parse(await Deno.readTextFile(`${dir}/current.json`));
    assertEquals(currentJson.status, "parse_error");
    assertEquals(currentJson.outages, []);

    await assertRejects(
      () => Deno.stat(`${dir}/observations/2026-07.csv`),
      Deno.errors.NotFound,
    );
  });
});

Deno.test("a successful parse writes observations, scrape log, and current.json", async () => {
  await withTempDir(async (dir) => {
    const okParse = (): ParseResult => ({
      status: "ok",
      snapshot_ts: "2026-07-01T07:06:36",
      observations: [{
        snapshot_ts: "2026-07-01T07:06:36",
        sector: 1,
        pt_name: "MODUL TERMIC B3",
        blocks: 1,
        service: "Oprire ACC",
        cause: "Remediere avarie",
        estimated_restore: "2026-07-01T20:00",
        zone_raw: "• Str Hrisovului - bl. B3",
      }],
      error: null,
    });

    await writeSnapshotArtifacts("<html></html>", "2026-07-01T07:06:36", paths(dir), okParse);

    const observations = await Deno.readTextFile(`${dir}/observations/2026-07.csv`);
    assertEquals(observations.split("\n").length, 3); // header + 1 row + trailing empty

    const log = await Deno.readTextFile(`${dir}/snapshots/2026-07.csv`);
    assertEquals(log, "snapshot_ts,status,observations\n2026-07-01T07:06:36,ok,1\n");

    const currentJson = JSON.parse(await Deno.readTextFile(`${dir}/current.json`));
    assertEquals(currentJson.outages.length, 1);
  });
});
