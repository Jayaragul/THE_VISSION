# THE VISSION

**You are on `main`. This branch is deterministic — no model, no API key, permanently.**
There is no `daily-edition.yml` here, no `.claude/skills/news-pipeline`, no `GEMINI.md`. If
you are looking for those, or for anything that "researches and writes an edition," you
want the **`editorial-ai`** branch instead — `git fetch origin editorial-ai` and check it out
there. Do not try to recreate them here; that is precisely the coupling this branch removed.
See `RELIABILITY.md` for why.

What runs on `main`: `tools/harvest.mjs` collects headlines from ~30 public feeds,
`tools/digest.mjs` clusters and ranks them, and `tools/build.mjs` renders the site. The
front page is the digest. No prose is generated anywhere in this branch's pipeline.

This branch also still serves 18 AI-written editions, published 17 Aug – 12 Sep 2026 before
the split, unchanged, at `archive.html` and `edition/*.html` — a published story never
changes (rule 3), so they stay even though nothing here can produce a 19th.

## The one thing to understand

**`generated/*.json` is the source of truth. Every HTML file in this repo is build output.**
On this branch that source is the digest and the wire, not an authored edition:

```
input/beats.json + input/sources.json  →  tools/harvest.mjs  →  tools/digest.mjs
                                                                        │
                                                          generated/digest/<date>.json
                                                                        │
                                                              node tools/build.mjs
                                                                        ↓
                                          index.html (= today's digest) · digest/*.html
                                          wire/*.html · rss.xml · sitemap.xml
                                                                        ↓
                                                        git commit && git push
                                                                        ↓
                                                               GitHub Pages
```

The 18 archived editions have their own, separate flow — `generated/YYYY-MM-DD.json` →
`tools/build.mjs` → `edition/*.html` — which still runs on every build to keep those pages
current, but nothing on this branch writes a new `generated/YYYY-MM-DD.json` file. That flow
is `editorial-ai`'s, documented in its own `CLAUDE.md`.

Never hand-edit `index.html`, `archive.html`, `methodology.html`, `404.html`, or anything
under `story/`, `edition/`, `digest/`, `wire/`, or `assets/img/covers/`. The next build
overwrites them. If a page is wrong, the fix belongs in `tools/build.mjs`,
`tools/lib/render.mjs`, or `assets/css/site.css` — those three are hand-written and the
build never touches them.

## Layout

| Path | Role | Edited by |
| --- | --- | --- |
| `input/beats.json`, `input/sources.json` | Beats and source tiers — read by both the digest and the archived editions | Human |
| `input/site.json`, `input/editorial.md`, `input/hackathons.json` | Site config; the archive's former house style; hackathon listings | Human |
| `.claude/skills/` | Empty on this branch — the AI editorial procedure lives on `editorial-ai` | — |
| `evals/` | The 18 archived editions' review scores. Nothing writes new ones here. | Human wrote the rubric; frozen |
| `schema/` | The contract the 18 archived editions satisfy — still enforced by `validate.mjs` | Human |
| `tools/` | Harvester, digest ranker, validator, builder, cover art, local server | Human |
| `assets/css`, `assets/js` | Hand-written stylesheet and progressive enhancement | Human |
| `generated/digest/`, `generated/wire/` | One JSON file per run — **the live archive** | Pipeline (no model) |
| `generated/*.json` (dated editions) | The 18 AI-written editions — **frozen** | Nobody, ever again on this branch |
| `story/`, `edition/`, `digest/`, `wire/`, `assets/img/covers/`, `*.html`, `*.xml` | Build output | Nobody |

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

There is no `news-pipeline` skill on this branch, and nothing here writes a new
`generated/YYYY-MM-DD.json`. If asked to "publish today's edition" or "run the pipeline"
while working on `main`, that request is almost certainly about `editorial-ai` — say so and
check it out there rather than improvising a replacement here.

What does run on `main`, and can be run by hand at any time:

```bash
node tools/harvest.mjs   # collect leads — writes generated/candidates/<date>.json
node tools/digest.mjs    # cluster + rank — writes generated/digest/<date>.json
node tools/build.mjs     # render the site, including the new front page
```

The gate (`tools/validate.mjs --strict`) still exists and still matters — it is what keeps
the 18 archived editions honest, and `verify.yml` runs it (without `--strict`) on every push
across the whole archive. It has nothing to gate on this branch's own output, because the
digest and wire were never validated against `schema/edition.schema.json` to begin with —
their honesty comes from having no prose to fabricate, not from a gate.

## Rules that are not negotiable

These governed every one of the 18 archived editions and still govern how this branch treats
them — rules 3 and 6 especially, if you are ever asked to touch a past story (add a
correction, fix a typo). Rules 1, 2, 4 and 5 describe how those editions were written; they
have no new subject on this branch, but they explain why the archive reads the way it does.

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
