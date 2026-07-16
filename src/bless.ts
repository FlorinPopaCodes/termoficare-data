// Regenerates every golden from the current parser: deno task bless
// Review the git diff before committing -- goldens are a regression net, not an oracle.

import { goldenPath, loadManifest, renderFixture } from "./corpus.ts";

for (const entry of loadManifest()) {
  const path = goldenPath(entry);
  const next = renderFixture(entry);

  let previous: string | null = null;
  try {
    previous = Deno.readTextFileSync(path);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }

  Deno.writeTextFileSync(path, next);

  const state = previous === null ? "new" : previous === next ? "unchanged" : "UPDATED";
  console.log(`${state.padEnd(9)} ${entry.file}`);
}
