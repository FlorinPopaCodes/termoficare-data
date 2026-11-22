# Scraping runs outside GitHub Actions

Everything that fetches from cmteb.ro runs on a scraper machine we control, not on GitHub
Actions, because CMTEB blocks GitHub's runner IPs. From 2026-10-24 every scheduled Flat run
failed with `connect ETIMEDOUT 80.96.219.200:443`, so the TCP connection never opened, while
the same request from a residential connection returned 200 in 0.1s. That makes the block
network-level, not rate limiting or a page change. The same applies to the registry fetch of
CMTEB's system map, so it moves too. Derive, health and CI never touch cmteb.ro and stay on
Actions.

The earlier research into external schedulers
([2026-07-17](../research/2026-07-17-external-scheduler-for-15min-cron.md)) does not help here:
those services only trigger a GitHub Actions run, and the fetch would still come from a
blocked runner IP. Any cloud host is suspect for the same reason, so a scraper should fetch
from an IP CMTEB has no reason to block.

## Consequences

- The health workflow can no longer infer liveness from flat.yml's run history. Each scraper
  records a **heartbeat** (the time of its most recent fetch that made it into the repo) in a
  repository variable named for that scraper, and `pipeline-down` fires when the newest
  heartbeat is older than its threshold. Liveness is recorded outside git so the history doesn't gain a commit every 15
  minutes.
- Scrapers write to the same files, so a rebase could conflict. Publishing therefore
  fast-forwards to `origin/main` and re-runs postprocess on the fresh tree before each push
  attempt, dropping its own commit when a push is rejected, which also makes more than one
  scraper safe. Scrape and registry run from separate clones so they never share a tree.
- The repo ships the entry points, not the machine setup: scheduling and credentials on the
  scraper are the operator's concern.
