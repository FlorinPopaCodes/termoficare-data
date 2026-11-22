// Commits whatever `write` produces and pushes it to origin/main, safely alongside other
// scrapers and the GitHub Actions bots pushing to the same branch (ADR 0004).
//
// Scrapers append to the same CSVs, so rebasing one scraper's commit onto another's would
// conflict. Instead every attempt starts from the latest origin/main and re-runs `write`
// on that tree; a rejected push drops the attempt's own commit and tries again.
//
// Refuses to run on a dirty tree or on local commits origin/main lacks, so running it in a
// development clone can never discard work or push it along with the scrape.

const MAX_ATTEMPTS = 5;

async function git(...args: string[]): Promise<{ ok: boolean; out: string }> {
  const output = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" })
    .output();
  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  return { ok: output.success, out: decode(output.stdout) + decode(output.stderr) };
}

async function mustGit(...args: string[]): Promise<string> {
  const { ok, out } = await git(...args);
  if (!ok) throw new Error(`git ${args.join(" ")} failed:\n${out}`);
  return out;
}

// Resolves to true when a commit was pushed, false when `write` changed nothing.
export async function publish(message: string, write: () => Promise<void>): Promise<boolean> {
  if ((await mustGit("status", "--porcelain")).trim() !== "") {
    throw new Error("Working tree is not clean; refusing to publish.");
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await mustGit("fetch", "--quiet", "origin", "main");
    if ((await mustGit("rev-list", "origin/main..HEAD")).trim() !== "") {
      throw new Error("HEAD has commits origin/main lacks; refusing to publish.");
    }
    await mustGit("merge", "--ff-only", "--quiet", "origin/main");

    await write();

    await mustGit("add", "--all");
    if ((await git("diff", "--cached", "--quiet")).ok) return false;
    await mustGit("commit", "--quiet", "-m", message);

    const push = await git("push", "--quiet", "origin", "HEAD:main");
    if (push.ok) return true;

    console.error(`Push attempt ${attempt} rejected; retrying on the latest main.\n${push.out}`);
    await mustGit("reset", "--hard", "--quiet", "HEAD~1");
  }
  throw new Error(`Gave up after ${MAX_ATTEMPTS} rejected pushes.`);
}
