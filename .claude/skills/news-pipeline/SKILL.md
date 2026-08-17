---
name: news-pipeline
description: Produce and publish a full edition of THE VISSION — research the day's AI news across every beat, write the stories, validate against the editorial gate, build the static site, commit and push. Use when asked to "run the pipeline", "publish today's edition", "update the site", "generate the news", or when a scheduled run fires. Also use for backfilling a past date.
---

# The daily pipeline

You are the entire newsroom. One run produces one edition and publishes it.

**The rule that outranks every other rule in this file: never invent anything.** Not a URL,
not a quotation, not a number, not a date, not a publisher name. If you cannot open the
source, the story does not run. An edition that comes up three stories short is a normal
Tuesday. An edition with one fabricated source is a dead paper.

---

## Before you start

Read these, in this order. They are the standing instructions and they change over time —
do not work from memory of a previous run.

1. `input/editorial.md` — voice, banned constructions, story shape, sourcing rules.
2. `input/beats.json` — the sections, their quotas and their seed queries.
3. `input/sources.json` — the source tier list and the blocklist.
4. `evals/rubric.md` — what the edition is scored on.
5. `generated/index.json` — what already ran, so today does not repeat yesterday.

Then fix the edition date and number:

```bash
node tools/edition-info.mjs
```

That prints today's date, the next edition number, and the headlines from the last three
editions. **Read those headlines.** A story that already ran is not news; only run it again
if there is a genuine development, and then say what changed in the deck.

---

## Stage 1 — Research

Work the beats in `input/beats.json` top to bottom. For each beat:

1. Run `WebSearch` on the beat's seed queries, plus queries of your own shaped by what you
   have already found. Bias hard toward the last 48 hours.
2. Build a candidate list. Aim for roughly twice the beat's quota so you have something to
   cut.
3. For every candidate you intend to keep, **`WebFetch` the source and read it.** Search
   snippets are leads, not sources. This is where fabrication gets caught, so do not skip it.
4. Follow every claim to its primary source. If a newsroom reports that a company announced
   something, find the announcement and cite both.

Score each candidate on the four axes in `input/editorial.md` §5 — materiality,
verifiability, novelty, durability — and cut everything that does not clear the bar. The
specific things to throw away: funding rounds under $10m, product tweaks with no capability
change, conference talk with no artefact, and vendor benchmark claims with no independent
check.

Reject outright any source whose host appears in `blocked` in `input/sources.json`. A social
post is a lead. Follow it to the thing it points at, and cite that.

Record what you found in a scratch file as you go — you will need the URLs, publishers and
dates exactly, and re-deriving them at the end is how mistakes happen.

## Stage 2 — Select and shape

Choose the shape of the edition:

- **One lead.** Highest materiality × durability. Needs at least two independent sources,
  and should have a tier-1 primary. This is the story the day is remembered for.
- **Three to six `top` stories.** Important, well-sourced, worth a full read.
- **`standard` stories** to fill out the beats toward their quotas.
- **Four to eight `brief`s.** Real facts that deserve the record but not a minute. Headline
  and deck only — no body.

Check the beat quotas in `input/beats.json`. Missing a `quota` is a warning; missing a
`minQuota` blocks the build, so if a floor beat is empty, go back and search harder before
you accept it.

## Stage 3 — Write

Follow `input/editorial.md` exactly. It is not advisory.

Write directly into `generated/YYYY-MM-DD.json`, conforming to `schema/edition.schema.json`.
Field by field:

| Field | What it is |
| --- | --- |
| `id` | `<edition-date>-<slug>`. Permanent. Never reuse or rewrite. |
| `kicker` | 1–3 words. The beat or the entity. |
| `headline` | 30–110 chars, a complete thought with a verb. |
| `deck` | One sentence that adds what the headline could not carry. Never a restatement. |
| `summary` | 2–4 bullets, each a fact. A reader who reads only these is correctly informed. |
| `body` | 3–6 paragraphs. Omit entirely for briefs. |
| `whyItMatters` | One paragraph a reader could disagree with. Cut it if it is a truism. |
| `confidence` | `high` only when a primary source confirms. `medium` for credible reporting with no primary. `low` for single-source or contested. Be honest; the label is printed. |
| `sources` | Every URL you actually opened. Real titles, real publishers, real dates. |

Set `edition.title` to the day in one line and `edition.summary` to two or three sentences
on the state of the day. This is the editor's note and it sits at the top of the front page,
so make it say something.

Do not set `readMinutes` or `signals` — the build computes them.

## Stage 4 — The gate

```bash
node tools/validate.mjs --strict
```

Errors block publication. Warnings block under `--strict`, which is what CI runs, so clear
them here.

Fix problems by **fixing the journalism**, not by gaming the checker. If the validator says
a story has no source above tier 3, the answer is to find a primary source or drop the
story — never to relabel the tier. If the style linter flags a hype word, rewrite the
sentence; do not swap in a synonym for the same empty claim.

Then run the editorial review:

```
Use the editorial-review skill
```

It scores the edition against `evals/rubric.md` and writes `evals/<date>.json`, bound by hash
to the exact edition it reviewed — `tools/validate.mjs` will refuse to publish if that binding
doesn't match. Score below threshold means revise, not publish.

## Stage 5 — Build

```bash
node tools/build.mjs
```

This regenerates every HTML page, every cover, the RSS feed, the sitemap and the manifest
from the JSON. Never hand-edit an HTML file — the next build overwrites it. If a page is
wrong, the fix belongs in `tools/build.mjs`, `tools/lib/render.mjs` or `assets/css/site.css`.

Spot-check the front page before you ship it:

```bash
node tools/serve.mjs
```

## Stage 6 — Publish

```bash
git add -A
git commit -m "Edition No. <n> — <YYYY-MM-DD>"
git push
```

Use the edition number and date in the subject, then list the lead headline and the story
count in the body. GitHub Pages publishes from `main` within a minute or two.

---

## Backfilling a past date

Same pipeline, with two changes: pass the date explicitly, and set
`edition.generator.trigger` to `"backfill"`. Search with that date's window in mind, and do
not let today's knowledge leak into the copy — a backfilled edition reports what was known
then.

## When a run has to stop

Stop and say so plainly rather than shipping something hollow:

- Fewer than `edition.minStories` candidates survive verification.
- A `minQuota` beat cannot be filled with real, verified stories.
- The validator reports errors you cannot fix by improving the journalism.

Leave the previous edition standing. A stale front page is a much smaller problem than a
fabricated one.
