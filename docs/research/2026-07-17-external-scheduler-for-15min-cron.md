# External scheduler for punctual 15-minute GitHub Actions dispatch

Date: 2026-07-17
Scope: `FlorinPopaCodes/termoficare-data`, workflow `.github/workflows/flat.yml`

## 1. Problem statement

The repo's Flat Data scraper is meant to run every 15 minutes via:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
  schedule:
    - cron: '*/15 * * * *'
permissions:
  contents: write
```

GitHub Actions' `schedule` trigger is a *best-effort* queue, not a real-time clock — see [§4](#4-github-side-facts) for GitHub's own wording on this. Measured over 18.6 days, this repo actually received ~15.5 runs/day instead of the requested 96/day, a median gap of 76 minutes, a max gap of 4.4 hours, and **zero** gaps ≤20 minutes — i.e. the `schedule` trigger never once fired close to on-time.

Because `workflow_dispatch` is already wired into the workflow, any external process that can `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` with a valid token can trigger a run punctually, sidestepping GitHub's scheduler queue entirely. This document compares external cron/scheduler services that could make that call every 15 minutes, using only primary sources (official docs, pricing pages, first-party API references).

## 2. Comparison table

| Option | Punctuality / SLA (per own docs) | Free tier vs. need (4/hr, ~2,900/mo) | Setup effort | Auth complexity | Ongoing maintenance |
|---|---|---|---|---|---|
| **Cloudflare Workers Cron Triggers** | No SLA published; 1-minute cron granularity, executes on Cloudflare's global network | 100,000 req/day free (need ~96/day = 0.1%); **5** Cron Triggers/account free (need 1) | ~6 steps: CF account, `wrangler` CLI, scaffold Worker, write fetch() call, `wrangler secret put`, `wrangler.toml` crons + deploy | Secret stored via `wrangler secret put`, read from `env` in Worker code — small amount of JS required | Near zero once deployed; Workers is a mature, core CF product |
| **Google Cloud Scheduler** | No timing SLA found; docs only describe timeout/retry behavior | **3 free jobs/billing account** (need 1); job-execution frequency itself isn't quota-limited | ~7-8 steps: GCP project + billing account, enable Scheduler API, create HTTP-target job (console or `gcloud`) with custom header | Static `Authorization` header can be set directly on the HTTP target (no OAuth/OIDC needed for external targets) — simple once GCP is set up, but GCP itself requires a billing account on file even for free jobs | Low day-to-day, but a GCP project + billing account is more infra than a solo maintainer otherwise needs |
| **val.town** (Cron val) | Not documented / no SLA | **15-minute** minimum interval on free tier (exactly meets need); 100k runs/day, 1-min execution cap per run | ~4 steps: account, create val with CRON trigger, write `fetch()` call, add env-var secret | Secret via account Environment Variables, read with `Deno.env.get()` — trivial | Near zero; smaller/newer platform than Cloudflare or Google (higher relative platform-risk) |
| **cron-job.org** | Explicitly "cannot give a promise or a guarantee on punctuality"; supports up to 60 executions/hour (1-minute) | Unlimited jobs, 1-minute interval (need 15-min) — ample | ~3 steps: create account, create **one** job in the web UI with URL/method/headers/body/schedule — **no code, no CLI, no cloud project** | Paste `Authorization: Bearer <PAT>` into a header field in the UI — the simplest of all options | PAT rotation only; trust is placed in a small third-party SaaS (mitigated by using a minimally-scoped fine-grained PAT) |
| **EasyCron** | Not found in primary docs | Free tier: **20-minute** minimum interval — **fails the 15-min-or-better bar**; 1-minute interval requires paid Individual-1 plan ($24/yr) | N/A on free tier | Custom HTTP headers are supported (paid tiers) | N/A — disqualified on free tier |
| **FastCron** | "Start running it according to your schedule"; no explicit SLA found | Free tier: **5** cron jobs, **5-minute** minimum interval — meets the bar | ~3 steps, web UI only | Could **not verify** from FastCron's own docs whether custom headers are available specifically on the free plan (docs page didn't state a plan restriction either way) | Low, but auth-header support on free tier is unverified |
| **Pipedream** | Not documented | Scheduling itself is stated to be free; cron-triggered workflow executions default to 60s timeout. Could **not verify** the exact free-tier daily/monthly credit cap from primary docs (page states only "a daily limit of free credits" without a number) | ~3-4 steps, web UI / low-code workflow | Store as a Pipedream "Connect" / env var, use in an HTTP step — simple | Low, but free-tier credit ceiling for ~2,900 calls/month is unverified |
| **Deno Deploy Cron** *(bonus)* | Not documented | 1M requests/month free (need ~2,900/mo = 0.3%); `Deno.cron()` supports 15-minute expressions; free orgs capped at **10** cron jobs/revision (need 1) | ~5 steps: account, create project, write `Deno.cron()` handler with `fetch()`, set env var, deploy | Env var secret via dashboard, read with `Deno.env.get()` — simple | Low; smaller market share than Cloudflare/Google (moderate platform-risk) |
| **Vercel Cron Jobs** *(investigated, excluded)* | Hobby plan: "Vercel cannot assure a timely cron job invocation" (±59 min precision even on the 1x/day tier) | Hobby (free) plan is **hard-capped at once per day** — deployment fails if the cron expression would run more often. **Disqualifies it outright.** Per-minute precision requires the Pro plan ($20/mo). | N/A | N/A | N/A — disqualified on free tier |

## 3. Per-option detail

### Cloudflare Workers Cron Triggers
- Cron syntax supports full 1-minute granularity (`* * * * *` is a documented example) — [Cron Triggers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- No punctuality SLA is stated; the docs only note that **configuration changes** (not trigger firing) can take up to 15 minutes to propagate globally — [Cron Triggers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- Free-plan limits: 100,000 requests/day, 5 Cron Triggers per account (250 on paid), 10ms CPU time/request, 50 subrequests/invocation — [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/).
- Setup: add a `[triggers]` block with a `crons` array to `wrangler.toml`, implement a `scheduled` handler in the Worker — [Cron Triggers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- Secrets: `wrangler secret put <KEY>` (or via the dashboard under Settings → Variables and Secrets), read through the `env` parameter in the Worker's fetch/scheduled handler — [Secrets docs](https://developers.cloudflare.com/workers/configuration/secrets/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).

### Google Cloud Scheduler
- Pricing: $0.10/job/month ($0.003/day); **3 free jobs per billing account** (account-level, not per-project) — [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing).
- Quotas: 1,000 jobs/region by default (max 5,000), max HTTP-target job duration 30 minutes, 500 write-API requests/minute (job admin operations, not firing rate) — [Quotas and limits](https://docs.cloud.google.com/scheduler/quotas).
- Setup: requires a GCP project (and its billing account, even to stay within the free-jobs quota), the target endpoint must be publicly reachable, and you configure headers directly on the job — "Add any headers you need to the request" — [Creating jobs](https://docs.cloud.google.com/scheduler/docs/creating).
- Auth to an external target like the GitHub API: Cloud Scheduler's built-in "auth" feature generates OIDC/OAuth tokens meant for Google-verified targets ("If your target is outside of Google Cloud, the receiving service must manually verify the token") — [HTTP target auth](https://docs.cloud.google.com/scheduler/docs/http-target-auth). GitHub's API does not verify Google-issued OIDC tokens, so the practical approach is to skip Cloud Scheduler's auth mechanism and instead set a plain static `Authorization` header (as one of the generic custom headers) carrying the GitHub PAT.

### val.town
- Free tier: cron vals can run as often as **every 15 minutes**; Pro tier ($21/mo) allows once per minute — [val.town pricing](https://www.val.town/pricing).
- Free tier also includes 100,000 runs/day and a 1-minute wall-clock execution cap per run, both far above what a single HTTP call needs — [val.town pricing](https://www.val.town/pricing).
- Setup: in the val editor, add a `CRON` trigger, choose a simple interval or cron expression (evaluated in UTC), and implement `export function cronValHandler(interval: Interval)` — [Cron docs](https://docs.val.town/vals/cron/).
- Secrets: stored as account-level Environment Variables, read via `Deno.env.get("VAR_NAME")` inside any val — [Environment variables docs](https://docs.val.town/reference/environment-variables/).
- No punctuality guarantee is documented anywhere in val.town's docs.

### cron-job.org
- Free accounts can run a job "up to 60 times an hour, i.e. every minute" — [FAQ](https://cron-job.org/en/faq/).
- Custom HTTP headers are supported when editing a job (only `User-Agent` and `Connection` are disallowed) — [FAQ](https://cron-job.org/en/faq/).
- Reliability: the FAQ states plainly the service "cannot give a promise or a guarantee on punctuality," that delays can occur for reasons "beyond our influence," and that in rare cases jobs may be deliberately delayed for platform stability. It also notes that displayed execution times are when the job *began*, and the system may start jobs slightly early to hit the target time more precisely — [FAQ](https://cron-job.org/en/faq/).
- No stated cap on number of cron jobs per free account (subject to an anti-abuse policy) — [FAQ](https://cron-job.org/en/faq/).
- Setup requires only an account and a job created through the web dashboard — no code, CLI, or cloud project.

### EasyCron
- Free plan: 200 executions/day, but a **20-minute minimum interval** between executions — this is coarser than the 15-minute need and disqualifies the free tier under this project's bar — [Pricing](https://www.easycron.com/pricing).
- A 1-minute interval (and, per third-party mentions, custom headers) requires the paid "Individual-1" plan at $24/year — [Pricing](https://www.easycron.com/pricing).
- Included for completeness only; not recommended given the free-tier interval floor.

### FastCron
- Free plan: 5 cron jobs, minimum 5-minute interval (meets the 15-minute bar with margin) — [Pricing](https://www.fastcron.com/pricing).
- Could **not verify** from FastCron's own docs page whether custom HTTP header configuration (needed for the `Authorization` header) is available on the free plan specifically — the docs page describes headers, HTTP auth, and API tokens as general product features without a clear free/paid split — [Docs](https://www.fastcron.com/docs). Some third-party comparison sites claim headers are free-tier-available, but that is a secondary source and is not cited here as fact.
- No formal punctuality SLA found in primary docs.

### Pipedream
- Pipedream states scheduling itself ("hosted scheduled jobs") is free — [Triggers docs](https://pipedream.com/docs/workflows/building-workflows/triggers).
- Cron-triggered workflow executions default to a 60-second timeout (extendable on paid tiers to 750s) — [Limits docs](https://pipedream.com/docs/workflows/limits/).
- A 2024-era product announcement describes moving the *previous* 5-minute schedule floor down to as low as once-per-second, but clarifies the sub-minute tier is **paid-plan only** — [Introducing one-second cron jobs](https://pipedream.com/blog/introducing-one-second-cron-jobs/). This implies the free tier's floor was at least 5 minutes previously; a specific, current, numeric free-tier interval floor could not be located in Pipedream's own docs after a reasonable search.
- The free-tier monthly/daily credit ceiling is referenced ("Free workspaces have a daily limit of free credits") but the exact number is not stated on the pages fetched — [Pricing docs](https://pipedream.com/docs/pricing), [Limits docs](https://pipedream.com/docs/workflows/limits/). This should be treated as **unverified** rather than assumed sufficient for ~2,900 calls/month.

### Deno Deploy Cron (bonus option)
- `Deno.cron()` registers a named, scheduled handler; the docs list `*/15 * * * *` ("every 15 minutes") as a standard example expression — [Cron reference](https://docs.deno.com/deploy/reference/cron/).
- Free-organization limit: **at most 10 cron jobs per revision** — [Cron reference](https://docs.deno.com/deploy/reference/cron/).
- Free tier: 1,000,000 requests/month, 15 CPU-hours/month, 20GB egress/month — all far above the ~2,900 tiny HTTP calls/month this job needs — [Deno Deploy pricing](https://deno.com/deploy/pricing).
- Cron invocations are billed "at the same rate as inbound HTTP requests," so they count against the same free request quota — [Cron reference](https://docs.deno.com/deploy/reference/cron/).
- Secrets: environment variables set per-project via the dashboard, read with `Deno.env.get()`.

### Vercel Cron Jobs (investigated, excluded)
- Vercel's own docs state plainly: "Hobby accounts are limited to cron jobs that run **once per day**. Cron expressions that would run more frequently will fail during deployment" — [Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Even on Hobby's once-a-day tier, "Vercel cannot assure a timely cron job invocation" — a job scheduled for 1:00am may fire anywhere in the 1:00–1:59am window — [Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Per-minute precision requires the Pro plan ($20/mo). Excluded from the main comparison because it fails the "15-minute-or-better on a free tier" screening bar per Vercel's own documentation.

## 4. GitHub-side facts

- **Endpoint**: `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` (the `workflow_id` may be the numeric ID *or* the workflow file name, e.g. `flat.yml`) — [Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event).
- **Required token permission**:
  - Fine-grained PAT / GitHub App: **"Actions" repository permission — write** is the permission listed for this endpoint in GitHub's fine-grained-token permissions table — [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2022-11-28).
  - Classic PAT / OAuth token: the endpoint's own reference page states "OAuth tokens and personal access tokens (classic) need the `repo` scope to use this endpoint" — [Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event).
  - Practical implication for this repo: a **fine-grained PAT scoped to only the `Actions: write` repository permission on `termoficare-data`** is the minimal token — it cannot read/write repo contents, issues, etc. A classic PAT cannot be scoped this narrowly; it needs the entire `repo` scope, which is far broader (full read/write on code, issues, PRs, etc.) for the same one job. This is a strong argument for the fine-grained PAT.
- **Fine-grained PAT expiry policy**:
  - When creating one for a **personal-account-owned repo** (no organization/enterprise involved), the token-creation UI's expiration field allows **infinite lifetime** — "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy set by your organization or enterprise owner" — [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
  - This "no expiration" option for fine-grained PATs on personal projects was itself a 2024 policy change: "developers can now create fine-grained tokens with no expiration for personal projects," while organizations/enterprises retain a 366-day default maximum-lifetime policy for fine-grained tokens under their control — [GitHub Changelog, Oct 18 2024](https://github.blog/changelog/2024-10-18-new-pat-rotation-policies-preview-and-optional-expiration-for-fine-grained-pats/).
  - If an expiration is set explicitly (rather than "no expiration"), the allowed custom range is up to 366 days — [Creating a personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token).
  - Rotation burden: for a solo maintainer on their own (non-org) repo, choosing "No expiration" removes rotation entirely at the cost of a longer-lived, non-expiring credential; choosing an expiration means a manual rotation at most once a year.
- **Rate limits**: authenticated PAT (classic or fine-grained) requests count toward the standard **5,000 requests/hour** personal rate limit; GitHub App installation tokens share the installation's minimum of 5,000/hour (scaling to a 12,500/hour cap for large installations); GitHub Enterprise Cloud org-owned Apps/OAuth apps get 15,000/hour — [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28). At ~4 calls/hour, this job uses roughly **0.08%** of the smallest of these limits.
- **Schedule-throttling disclaimer, verbatim from GitHub's own docs**: "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped." The same page states the shortest interval you can schedule is "once every 5 minutes" — [Events that trigger workflows — `schedule`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule). This is the documented root cause of the throttling this repo measured.
- **GitHub App installation tokens as a rotation-free alternative**: installation access tokens "expire after 1 hour" — [Generating an installation access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app). The App's underlying credential (its private key, used to sign a JWT that is exchanged for hour-long installation tokens) does not have a GitHub-enforced expiration in the same way a PAT does, so in principle a GitHub App removes the "PAT rotation" problem at the cost of needing to (a) register a GitHub App, (b) install it on the repo, (c) securely store its private key, and (d) implement JWT-signing + token-exchange logic in whatever calls the API, every single call (tokens live only 1 hour, so a scheduler firing every 15 minutes would need to mint a fresh token nearly every invocation, or cache-and-refresh). **Assessment**: for a solo-maintainer project making 4 calls/hour, this is materially more moving parts (an App registration, a PEM private key to protect, and JWT-signing code) than a single fine-grained PAT string with `Actions: write` scoped to one repo, especially now that such a PAT can be issued with no forced expiration on a personal repo. A GitHub App is the right answer at organizational scale or when many repos/tokens are involved; here it is overkill.

## 5. Recommendation

**Winner: cron-job.org**, on the grounds of lowest setup effort and zero cost/zero code, which best matches a solo-maintainer, low-maintenance project. It clears the bar with margin (1-minute interval vs the 15-minute need, no job-count cap), supports the exact custom headers GitHub's API requires, and needs no cloud account, CLI, or deployed code — only a web form. Its one real weakness is the explicit "no punctuality promise" in its own FAQ and its smaller operator profile versus Cloudflare/Google; both risks are mitigated by scoping the GitHub token to the single `Actions: write` permission on this one repo, so a leak or an errant extra trigger has minimal blast radius (it can only spam/queue workflow runs, not touch code, issues, or other repos).

If reliability/trust in a large, well-known infrastructure vendor matters more than setup simplicity, **Cloudflare Workers Cron Triggers** is the strongest runner-up (no SLA either, but a much larger, more scrutinized platform, and a native `wrangler secret put` secret store) at the cost of writing and deploying ~15 lines of Worker code plus a CLI toolchain.

### Step-by-step setup for the winner (cron-job.org)

1. **Create a GitHub fine-grained PAT** (do this first, GitHub side):
   - Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → "Generate new token."
   - Resource owner: your personal account (owner of `termoficare-data`).
   - Repository access: "Only select repositories" → `FlorinPopaCodes/termoficare-data`.
   - Permissions: under "Repository permissions," set **Actions: Read and write** (this is the only permission needed for the dispatches endpoint per [GitHub's fine-grained permissions table](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2022-11-28)). Leave every other permission at "No access."
   - Expiration: choose "No expiration" for zero rotation burden, or a custom date up to 366 days if you prefer periodic rotation — [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
   - Generate and copy the token (starts with `github_pat_...`).

2. **Create a cron-job.org account** at [cron-job.org](https://cron-job.org/en/) (free signup, no credit card).

3. **Create one job** in the dashboard with these exact settings:
   - **URL**: `https://api.github.com/repos/FlorinPopaCodes/termoficare-data/actions/workflows/flat.yml/dispatches`
   - **Method**: `POST`
   - **Schedule**: every 15 minutes (`*/15 * * * *`, or the UI's "every 15 minutes" preset)
   - **Request headers** (add each as a custom header):
     ```
     Accept: application/vnd.github+json
     Authorization: Bearer <YOUR_FINE_GRAINED_PAT>
     X-GitHub-Api-Version: 2022-11-28
     Content-Type: application/json
     ```
   - **Request body**:
     ```json
     {"ref": "main"}
     ```
   (Body and headers per [Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event); the `ref` must be the branch the workflow runs on.)

4. **Save and enable** the job. cron-job.org's dashboard shows execution history/logs for each run, which doubles as monitoring for missed or failed dispatches.

5. **No ongoing maintenance** beyond eventually rotating the PAT if you chose an expiration date rather than "No expiration."
