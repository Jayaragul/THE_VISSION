# Reliability and ongoing maintenance

This branch runs Wire and Digest only — no model, no API key, permanently. That is not a
fallback: it is the answer to what actually happened here.

## Postmortem: the nine-day silent failure

From 17 August through 12 September 2026 this repository also ran an AI-written Edition
tier via `daily-edition.yml`, on `main`, on a schedule. On 16 September its `GEMINI_API_KEY`
secret started failing every single run with `API key not valid. Please pass a valid API
key.` — not a rate limit, not a quota cap, not a transient outage. A dead credential. It
failed that way every day for **nine consecutive days**, and nobody was told, because:

- `publish` (the job whose one remaining step was supposed to open a GitHub issue on
  failure) had `needs: research` with no `if: always()`. GitHub Actions skips a job
  entirely when what it needs fails — so the alert step never ran, not once, in nine days.
- `wire-fallback` — the job that *did* run correctly every single day — had no alerting of
  its own. It quietly kept the front page current with a wire-only refresh, which was the
  right behavior for readers and the wrong one for maintainers: it made the failure
  invisible instead of loud.
- The front page (`index.html`) was hard-wired to the latest AI-written edition. The moment
  generation stopped, it would have stayed frozen on 12 September forever — not degraded,
  just silently wrong, the same failure mode as the missing alert, one layer up.

The fix that matters here is not "rotate the key" — that only helps whoever runs the AI
tier, now on the `editorial-ai` branch, and does nothing for a repository built to assume a
model will eventually go quiet again. The fix is this branch: the front page now builds
from `tools/digest.mjs`'s latest snapshot, which needs no key and cannot expire, and this
branch carries no workflow whose failure depends on a job succeeding to be reported. See
`archive.html` for the 18 editions that postmortem does not touch — they are still exactly
as published, per rule 3.

## Failure behavior

- Harvest requests have a 12-second deadline covering headers and body, an 8 MiB decoded
  response limit, and at most two attempts. Network errors, timeouts, HTTP 408/429 and
  server errors retry; permanent HTTP errors and oversized responses do not.
- Empty collections do not replace prior candidates or refresh their timestamp. Feed
  health still records the attempt and harvest exits unsuccessfully. On a new day with
  no successful collection, Wire can rebuild from its existing history; Digest requires
  that day's candidate file and fails visibly if it is absent.
- Candidate, feed-health and digest files are replaced through same-directory temporary
  files. A failed write does not truncate the existing destination. These individual
  replacements are not a transaction across all three files or a disk-failure backup.
- Harvest uses date and URL tie-breaks independent of locale. Digest uses collection time,
  not execution time, so rerunning identical candidates, rules and prior history produces
  identical JSON and does not advertise old leads as newly collected.
- Ordering across the site build, continuity, search index and wire goes through `cmp` in
  `tools/lib/util.mjs`, which case-folds and then falls back to code-unit comparison. It
  does not call `localeCompare`, so it does not vary with the runner's ICU build or its
  LANG. This matters because publication asserts the committed HTML is byte-identical to
  what the JSON builds to: a collation difference would not degrade quietly, it would fail
  that check on a diff nobody wrote. `localeCompare` orders `Nvidia` against `NVIDIA` one
  way under `en` and the other under `tr`, and both spellings appear in the archive.
- `cmp` is a total order. Comparators that ended in a locale comparison now end in one that
  cannot return 0 for distinct strings, so no rendered ordering falls back to whatever order
  the input happened to arrive in.
- Digest resolves one validated calendar date before harvesting, including when a run
  crosses UTC midnight. Impossible dates are rejected before collection.
- Maintenance shares the publication concurrency group. Publication checks include new
  files, as well as modifications and deletions. External pushes can still cause Git
  conflicts; a failed push must be investigated and rerun from a fresh checkout.

## Updates and verification

Dependabot checks GitHub Actions weekly and proposes grouped update pull requests.
Updates need review and merge; this configuration does not automatically deploy untested
workflow changes. Verify runs on pull requests, main pushes, manual requests and weekly,
testing Node 22, Node 24 and the latest LTS runtime. The LTS entry is a compatibility
probe; publishing remains on its explicit Node version until an upgrade is reviewed.

Run locally:

```sh
node --test
node tools/validate.mjs
node tools/build.mjs
```

Check that rebuilding did not change tracked site output. CI also checks for unexpected
new files. Regression coverage includes stalled response bodies, bounded retries,
oversized bodies, empty harvest recovery, failed file replacement, leap-year boundaries,
and byte-identical digest reruns in an isolated repository tree.

## What still needs an owner

Review failed runs and update pull requests, rotate expired provider credentials, repair
retired feeds, and act on the existing storage and citation-health reports. Retention
limits working files but does not shrink Git history; keep an independent repository
backup and periodically practice restoring and rebuilding it.

GitHub schedules can be delayed and public-repository schedules can be disabled after
60 days without activity. An independent uptime/freshness monitor is needed to detect
failure of GitHub itself; a workflow on the same service cannot reliably do that.
See [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
and [Dependabot updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates).

Local checks do not prove that GitHub permissions, secrets or deployments are configured.
Changes must reach the default branch before their schedules and update checks activate.
