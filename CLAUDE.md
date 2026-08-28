# THE VISSION

An autonomously produced daily paper about artificial intelligence. There is no newsroom.
An automated pipeline researches, writes, checks and publishes every edition.

The model behind that pipeline is deliberately swappable, and as of 26 Aug 2026 it is Gemini
CLI rather than Claude Code — see `.github/workflows/daily-edition.yml`. Nothing in the design
assumes a vendor: the editorial procedure lives as plain markdown in `.claude/skills/`, each
harness is told to read it (`CLAUDE.md` for Claude Code, `GEMINI.md` for Gemini CLI), and every
edition records the model that actually wrote it in `edition.generator.model`. The site's byline
is the desk, so a model change never makes a published page untrue.

## The one thing to understand

**`generated/*.json` is the source of truth. Every HTML file in this repo is build output.**

```
input/ + skills + evals   →   research & writing   →   generated/YYYY-MM-DD.json
                                                              │
                                                     node tools/build.mjs
                                                              ↓
                                        index.html · story/*.html · edition/*.html
                                             rss.xml · sitemap.xml · covers
                                                              ↓
                                                    git commit && git push
                                                              ↓
                                                       GitHub Pages
```

Never hand-edit `index.html`, `archive.html`, `methodology.html`, `404.html`, or anything
under `story/`, `edition/`, or `assets/img/covers/`. The next build overwrites them. If a
page is wrong, the fix belongs in `tools/build.mjs`, `tools/lib/render.mjs`, or
`assets/css/site.css` — those three are hand-written and the build never touches them.

## Layout

| Path | Role | Edited by |
| --- | --- | --- |
| `input/` | Beats, source tiers, editorial standards, site config | Human |
| `.claude/skills/` | The pipeline's standing instructions | Human |
| `evals/` | Rubric and the last run's scores | Human writes the rubric; the pipeline writes the scores |
| `schema/` | The contract every edition must satisfy | Human |
| `tools/` | Validator, builder, cover art, local server | Human |
| `assets/css`, `assets/js` | Hand-written stylesheet and progressive enhancement | Human |
| `generated/` | One JSON file per edition — **the archive** | Pipeline |
| `story/`, `edition/`, `assets/img/covers/`, `*.html`, `*.xml` | Build output | Nobody |

## Commands

```bash
node tools/edition-info.mjs      # date, next edition number, what already ran
node tools/validate.mjs --strict # the publish gate — errors and warnings both block
node tools/build.mjs             # render the whole site from generated/
node tools/serve.mjs             # preview at http://localhost:4173

node tools/linkcheck.mjs         # walk every source ever cited; find rot
node tools/retention.mjs         # storage projection; --prune reclaims scratch
```

Zero dependencies by design. No `npm install`, no lockfile, no build toolchain to rot.
Node 20+ is the only requirement. Keep it that way — a dependency in `tools/` is a
dependency the scheduled job has to resolve at 6am every morning.

## Running for ten years

Three things kill a daily publication slowly, and none of them announce themselves. All
three are now instrumented, which is the only reason the ten-year claim is checkable rather
than aspirational.

**Link rot.** The paper's central promise is that every story carries a source you can
open. Around half of cited links rot within a decade, oldest first, where nobody is
looking — so an archive that never checks quietly stops being true. `tools/linkcheck.mjs`
walks every URL weekly and writes `generated/link-health.json`. It distinguishes *blocked*
(403/429 — the publisher refuses bots but serves readers; **not** rot) from *gone* (404/410
on three consecutive weekly checks). Only the latter is treated as dead. On its first run
it found two dead citations, one of them three hours old.

**Storage.** GitHub Pages stops publishing at 1 GB, with no gradual warning. The archive
adds roughly 350 KB of permanent, never-deletable output every day. `tools/retention.mjs`
projects the crossing date from measured bytes; at edition 8 that was **8.0 years out**, and
the number is re-reported every week so it is never a surprise.

**Feed decay.** Feeds die, move and get paywalled. `tools/harvest.mjs` already tracks
consecutive failures per feed in `generated/feed-health.json` and reports loudly past the
threshold. Left unwatched, the paper narrows to whatever three feeds still answer.

### When the archive outgrows Pages

Do not wait for the deploy to fail. When `tools/retention.mjs` reports past 70% — the
weekly Maintenance job opens an `archive-health` issue at that point — pick one, in
descending order of preference:

1. **Split the archive.** Move `story/`, `edition/` and covers older than ~2 years to a
   second repository published at its own Pages site, and have the main site link across.
   Permalinks must be preserved by redirect; a story id is a promise (rule 3).
2. **Move off Pages** to a host without the 1 GB ceiling. The site is plain static files
   with no server requirement, so this is a DNS and CI change, not a rewrite.
3. **Shrink covers.** ~150 KB per edition is decorative SVG. Reducing coordinate precision
   is worth roughly 40% of it and buys time, but only time.

What must **not** happen: deleting old editions, or dropping cover art for stories that
already have it. The archive is the product. Everything else is negotiable.

## Publishing an edition

Use the `news-pipeline` skill. It is the procedure, and it is not optional reading —
`input/editorial.md` and `input/sources.json` change over time.

The gate runs before the build, and the build runs before the commit. An edition that fails
validation does not publish; the previous edition stays up. That ordering is deliberate.

## Rules that are not negotiable

1. **Nothing is invented.** Not a URL, a quotation, a number, a date, or a publisher name.
   If a source cannot be opened, the story does not run.
2. **Every story carries a source**; lead and top stories carry two that are genuinely
   independent of each other.
3. **A published story id never changes.** `story/<id>.html` is a permalink and the archive
   is a record, not a working draft.
4. **Fix the journalism, not the checker.** When `tools/validate.mjs` complains, the answer
   is better sourcing or better prose — never a relabelled tier or a synonym for the same
   empty claim.
5. **A short edition beats a padded one.** Running three stories light is a normal day.
6. **A correction is added, never applied silently.** Fixing a published story means adding
   a `corrections` entry, not quietly editing the prose. A reader who saw the original has
   to be able to find out it changed. Rule 3 keeps the URL; this keeps the history.
7. **A thread is declared, never inferred.** Two stories sharing an entity are not the same
   story — measured on this archive, "Google" spans five editions without being one. Guessing
   a connection is inventing one.

## Continuity: threads, open questions, corrections

Three optional story fields turn a pile of daily editions into something worth following.
All three are deliberate editorial acts; none is derived.

| Field | What it does | Renders at |
| --- | --- | --- |
| `thread: {id, label}` | Marks an instalment of a continuing story | `thread/<id>.html`, plus a timeline on each story |
| `openQuestion` | The specific thing this story leaves unresolved | `open-questions.html`, plus a marker on the story |
| `resolves: {story, outcome}` | Closes an earlier story's open question | The answer appears on both stories |
| `corrections: [{at, what}]` | A post-publication amendment | `corrections.html`, plus a note on the story |

`openQuestion` is the one that matters most and is easiest to do badly. It must be a
question of fact a later edition could actually answer — *"Does the acquisition get
signed?"* qualifies; *"What happens next in AI?"* does not. It is not a hedge and not a
topic. The point is that a paper publishing an unconfirmed claim and never returning to it
is indistinguishable from one that was quietly wrong; `resolves` is how the paper keeps its
own score, **including when the answer shows it was wrong**. Publish that outcome anyway.
That is the entire value of the mechanism.

## Adding a beat

Add it to `beats` in `input/beats.json` (with an `accent` colour — it drives the cover art)
**and** to `nav` in `input/site.json`. The build reads `nav` for section order and anchors;
a beat missing from `nav` will have stories but no section on the front page.

## Style

Comments explain why, not what. The tone in `input/editorial.md` applies to prose, not to
code. Match the surrounding file.
