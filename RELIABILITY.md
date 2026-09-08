# Reliability and ongoing maintenance

The editorial AI is optional; Wire and Digest can continue without a model or API key.
This is a maintained system, not a guarantee of ten unattended years.

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
- `buildWeeklyDoc` accepts an injected clock. Weekly output is reproducible when one is
  supplied; omitting it stamps the wall clock as before.
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
