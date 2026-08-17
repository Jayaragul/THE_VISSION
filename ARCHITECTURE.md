# Architecture

How THE VISSION is built, and — more usefully — why it is built this way.

The design goal is not "an AI writes a newspaper." It is **a publication that keeps
publishing for years without anyone tending it**, including on the days when the interesting
part is broken.

---

## 1. The core decision: tiers that fail independently

Most autonomous-agent projects have one path. The model runs, or nothing happens. That is
fine for a demo and useless for a publication, because the failure mode is a dead site and
nobody notices for a week.

This has **three tiers**. Each is strictly more capable and strictly less reliable than the
one below it. Each keeps working when the tier above it stops.

```
┌──────────────────────────────────────────────────────────────────────┐
│ TIER 2 — EDITORIAL          needs: API key, model, network           │
│ Researches, verifies, writes, self-scores. Produces the actual paper.│
│ Fails on: expired key, spend cap, outage, an edition below standard. │
├──────────────────────────────────────────────────────────────────────┤
│ TIER 1 — WIRE               needs: network only                      │
│ Harvests ~550 leads/run from 24 publisher feeds. Renders headlines,  │
│ labelled unverified. No key, no model, no cost.                      │
│ Fails on: total network loss.                                        │
├──────────────────────────────────────────────────────────────────────┤
│ TIER 0 — ARCHIVE            needs: nothing                           │
│ Static HTML on GitHub Pages. Every past edition, permanently.        │
│ Fails on: GitHub going away.                                         │
└──────────────────────────────────────────────────────────────────────┘
```

**What a reader sees when tier 2 dies:** the last edition stays on the front page, a banner
appears saying no new edition has published, and The Wire below it keeps updating every six
hours. The site is degraded and *says so*. It does not look abandoned, and it does not lie.

This is the single most important property of the system. Everything else is detail.

## 2. Data flows one way

```
input/ + .claude/skills/ + evals/     ← the system (human-authored)
              │
              ▼
     generated/YYYY-MM-DD.json        ← the ONLY authored output
              │
     node tools/build.mjs             ← pure function, no network
              ▼
   index.html, story/, edition/,      ← disposable
   rss.xml, sitemap.xml, covers/
```

**`generated/*.json` is the source of truth. Every HTML file is disposable.** Delete every
`.html` in the repo, run `node tools/build.mjs`, and you get byte-identical files back.

CI asserts exactly this on every push (`.github/workflows/verify.yml`): it builds and fails
if `git diff` is non-empty. That single check enforces a property that is otherwise
impossible to maintain by discipline — **no page can ever be hand-edited into disagreeing
with its data**, because the next build would revert it and CI would catch the drift.

It also means the entire site is reproducible from ~30KB of JSON per edition, and that a
redesign is a change to one stylesheet plus a rebuild, never a migration.

### Why the build must be deterministic

Three things were changed to make this true, and they are easy to accidentally undo:

- `builtAt` in the manifest derives from the newest edition's `generatedAt`, not `Date.now()`
- RSS `lastBuildDate` likewise
- the footer copyright year comes from the edition date
- hackathon expiry and wire staleness compare against the **latest harvest**, not the clock

Anything reading the wall clock at build time breaks the CI guarantee. If you add a feature
that needs "now", derive it from committed data instead.

## 3. Zero dependencies, on purpose

No `package.json`, no lockfile, no `npm install`. Node 20+ and nothing else.

This is a deliberate trade against convenience. A scheduled job that runs unattended every
morning for years fails on dependency rot far more often than on its own logic — a
transitive package is yanked, a registry has an outage, a major version breaks an API, a CVE
forces an upgrade nobody is watching for. None of that can happen here.

The costs paid for it, honestly:

| Hand-rolled | Instead of | Cost |
| --- | --- | --- |
| `tools/lib/schema.mjs` | ajv | Supports only the keywords the schema uses. `assertSupported()` throws loudly if the schema grows one it does not know, so this fails safe. |
| `tools/lib/feed.mjs` | fast-xml-parser | Regex-based. An unusual feed yields zero items rather than crashing — degradation, not failure. |
| `tools/lib/cover.mjs` | an image library | Generates SVG only. Open-graph images are therefore SVG, which some social platforms will not render. |

Each of these is a real limitation. They are worth it because the alternative is a supply
chain the 6am job has to resolve successfully every single day.

## 4. The gate is the product

```
research → write → validate --strict → build → commit → push
                        │
                        └── fails? nothing publishes. yesterday stays up.
```

`tools/validate.mjs` runs before the build, and the build runs before the commit. That order
is the whole safety model — a bad edition cannot reach the site, because it never gets built.

The validator enforces what a machine can:

- schema conformance, exactly one lead, unique ids and slugs
- source hosts against a blocklist, tier floors, duplicate URLs across stories
- brief/body shape, beat quotas, publication-date windows
- a house-style linter for hype vocabulary (`STYLE_TRAPS`)

`--strict` promotes warnings to errors and is what CI runs.

**The rule that makes this work: fix the journalism, not the checker.** When the validator
complains, the answer is better sourcing or better prose — never a relabelled tier or a
loosened threshold. An agent optimising against its own grader will always win, and the
paper will always lose. Every check is written to be hard to satisfy dishonestly.

## 5. The AI job cannot reach git

A prompt instruction ("don't touch the validator", "don't run git") is not a security
boundary. A job with no write credential is. `daily-edition.yml` learned this the hard way —
an early version ran Claude and the publish step in one job, so a prompt-injected page or a
confused run could in principle have had `tools/validate.mjs` or a workflow file edited and
then silently swept up by a blind `git add -A` in the same job.

It is now three jobs with three different trust levels:

```
research            permissions: contents: read
  WebFetch + Write/Edit, no write credential exists in this job at all
      │  produces exactly 3 named files (edition, eval, harvested candidates)
      ▼  — never the whole working tree — handed off as a build artifact
publish              permissions: contents: write
  clean checkout, never sees research's workspace. Extracts only those 3
  files, re-runs validate.mjs and build.mjs from scratch, asserts the diff
  touches only publishable paths, only then commits
      │  on failure —
      ▼
wire-fallback        no AI, no key — the tier-1 failover from section 1
```

**The artifact handoff is the actual boundary, not the allowed-paths check that follows it.**
Even a fully compromised `research` job cannot push, because there is no credential in that
job capable of it — not a scoped one, none. The allowed-paths assertion in `publish` is
defense in depth on top of that, not the load-bearing wall.

`retrospective.yml` has a narrower version of the same problem: its job needs to touch rule
files (`input/editorial.md`, `tools/validate.mjs`, `evals/rubric.md`) — that's the point of
it — so an allowlist doesn't fit. Instead it has a **forbidden**-paths check: it can propose
anything except a change to `.github/workflows/` (which would let it widen its own reach), a
past `generated/` edition, an `evals/` eval, or `LICENSE`. Combined with the fact that it
already opens a PR rather than pushing to `main`, and that Claude's Bash access in that job is
read-only git commands only, a proposed change to a forbidden path is refused before a PR can
even open.

## 6. Self-improvement, with a human gate

`.github/workflows/retrospective.yml` runs weekly. Claude reads the eval score history,
finds the single pattern costing the most points, and proposes a change to **the rules** —
a new validator check, a banned construction, a quota that does not match reality.

It opens a pull request. **It does not merge.**

That boundary is not bureaucracy. An agent permitted to rewrite its own standards will
eventually rewrite them to be easier to pass; eval scores climb while quality falls, and the
metric stops measuring anything. A human merging one small, well-argued rule change a week
is what keeps the loop pointed at the paper instead of at the score.

The loop also has a stated preference: **a machine check beats a written rule**, because a
check cannot be forgotten by the next run and a paragraph in a markdown file can.

## 7. Testing what can be tested

`node --test` (Node's built-in test runner — no dependency, matches section 3) covers
`tools/lib/*.mjs` with real-world fixtures, not textbook ones: `feed.test.mjs` parses RSS/Atom
shaped exactly like the actual publishers in `harvest.mjs` send it, including the messy
parts — CDATA titles, self-closing Atom `<link>` tags with no `rel`, arXiv's namespaced
elements. `cover.test.mjs`, `wire.test.mjs`, `schema.test.mjs` and `util.test.mjs` cover
determinism, filtering, validation and the small hand-rolled utilities respectively. CI runs
the whole suite on every push, before the editorial gate.

This is deliberately narrower than testing the pipeline end to end. `tools/validate.mjs` and
`tools/build.mjs` are exercised constantly by CI running them against real editions — that is
integration coverage, just not unit coverage, and splitting `build.mjs`'s page renderers into
independently testable functions is future work rather than done.

Two bugs were found and fixed by writing these tests, not by review: `slugify('Über')`
produced `u-ber` instead of `uber` (NFKD decomposition left a combining diacritic for the
separator regex to eat), and the lead-story tier-1 warning in `validate.mjs` had an
off-by-one (`bestTier > 2` instead of `> 1`) that let a lead sourced entirely at tier 2 pass
with no warning. Both are exactly the kind of defect a test written *before* the bug is known
about tends to surface — which is the actual argument for having them, more than any coverage
percentage.

## 8. Cost control

Tokens are spent only where judgement is required.

| Stage | Mechanism | Cost |
| --- | --- | --- |
| Discovery | `harvest.mjs` — 24 RSS feeds + HF API | **zero** |
| Verification | WebFetch on shortlisted candidates | moderate |
| Writing | one edition of ~12 stories | moderate |
| Rendering | `build.mjs` | **zero** |
| Wire refresh (4×/day) | `harvest.mjs` + `build.mjs` | **zero** |

Before the harvest layer existed, discovery meant WebSearch across every beat on every run —
the largest single line item, spent on finding things that public feeds already list for
free. Moving discovery to RSS both widened coverage and cut the bill.

## 9. Known limitations

Stated plainly, because a system's failure modes belong in its architecture doc.

- **Open-graph images are SVG.** Some platforms will not render them. Fixing it properly
  needs a rasteriser, which means a dependency. Weigh section 3 before changing this.
- **Roughly a third of promising leads die at a 403.** Bloomberg, WSJ, FT, CNBC and
  openai.com block automated fetches. Handled by the blocked-primary rule in
  `evals/rubric.md` — cite only if an opened source quotes it, cap confidence at `medium` —
  rather than by pretending to have read them.
- **An automated pipeline can be confidently wrong.** Mitigations are source tiers, a
  confidence label printed on every story, and every source one click away. They reduce the
  risk; they do not remove it.
- **The wire is unverified by construction.** It is filtered for AI relevance and stripped of
  aggregator redirects, but nothing on it has been read by anything. It is labelled as such
  everywhere it appears, and it must stay visually subordinate to edited copy.
- **Cover art changes are now locked, not versioned.** Covers are permalinked assets, and
  `tools/lib/cover.mjs` is a pure function of the story id — so changing the algorithm
  regenerates every cover ever published. That happened twice deliberately on 17 Aug 2026:
  first widening the hue range from ±5° to ±52° across the original 10 styles, then replacing
  the whole per-story-random approach with a fixed, auditable library of 100 canonical
  "plates" across 18 style families — geometry keyed to the plate index, colour keyed to the
  story, so exactly which shapes exist is a closed, reviewable set rather than whatever an RNG
  happens to draw (see `tools/gen-cover-sheet.mjs`). `generated/covers.lock.json` records a
  hash per published cover and **the build fails if art changes for a story already in the
  lock**. Accepting a deliberate regeneration takes `node tools/build.mjs --relock`. This
  prevents accidents; it does not preserve old art. If the archive ever needs to keep the art
  it was published with, that still requires a `cover.version` per story and keeping the old
  renderer alongside the new one.
- **Hackathon listings are curated by hand.** Devpost's API returns 403, so entries are added
  only after opening the organiser's listing. Expired entries drop off automatically; new
  ones need a pull request.

## 10. Where to change things

| You want to change | Edit | Do not edit |
| --- | --- | --- |
| What the paper covers | `input/beats.json`, `input/site.json` (both) | — |
| Voice, banned phrases | `input/editorial.md` | — |
| Which sources count | `input/sources.json` | — |
| What blocks publication | `tools/validate.mjs` | — |
| How pages look | `assets/css/site.css` | any `.html` |
| Page structure | `tools/lib/render.mjs`, `tools/build.mjs` | any `.html` |
| Cover art | `tools/lib/cover.mjs` | `assets/img/covers/` |
| Where leads come from | `tools/harvest.mjs` | `generated/candidates/` |
| How the pipeline works | `.claude/skills/*/SKILL.md` | — |

Anything in the right-hand column is build output. The next run overwrites it.
