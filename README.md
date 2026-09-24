<div align="center">

# THE VISSION

### A daily AI newspaper with no model in the loop.

**[📰 Read today's digest →](https://jayaragul.github.io/THE_VISSION/)**

[![Verify](https://github.com/Jayaragul/THE_VISSION/actions/workflows/verify.yml/badge.svg)](https://github.com/Jayaragul/THE_VISSION/actions/workflows/verify.yml)
[![Digest](https://github.com/Jayaragul/THE_VISSION/actions/workflows/digest.yml/badge.svg)](https://github.com/Jayaragul/THE_VISSION/actions/workflows/digest.yml)
[![Wire](https://github.com/Jayaragul/THE_VISSION/actions/workflows/wire.yml/badge.svg)](https://github.com/Jayaragul/THE_VISSION/actions/workflows/wire.yml)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](ARCHITECTURE.md#3-zero-dependencies-on-purpose)

*Free to read. No ads, no sponsors, no tracking, no newsletter popup.*

</div>

---

The front page is built entirely by two deterministic tools — `tools/harvest.mjs` and
`tools/digest.mjs` — clustering and ranking headlines from ~30 public feeds. No API key, no
model, nothing generated. That used to be the fallback state for when an AI-written tier
went down. It is now the whole design: this branch runs the digest and the wire,
permanently, and depends on no vendor's model existing or staying online.

It was not always this way. From 17 August through 12 September 2026 this paper also ran an
AI-written **Edition** tier — 18 of them, researched and drafted by a model, gated by a
validator, and still archived unchanged at
[archive.html](https://jayaragul.github.io/THE_VISSION/archive.html). What ended that was
not a design decision — a `GEMINI_API_KEY` secret expired and stayed expired for **nine
days** before anyone noticed, because the workflow's own failure alert was wired to a job
that only ran when the pipeline *succeeded*. See the postmortem in
[RELIABILITY.md](RELIABILITY.md). Generating new AI editions now lives on the
[`editorial-ai`](https://github.com/Jayaragul/THE_VISSION/tree/editorial-ai) branch, for
anyone who wants to run it with their own key, on their own schedule. This branch does not
depend on it existing at all.

## Why you might care

- **Read it** — a daily AI briefing, free, every headline one click from where it was
  actually reported.
- **Fork it** — the whole pipeline is dependency-free Node, and this branch needs no API key
  at all to run forever. Point the feed list at any beat and you have a self-publishing
  digest on your own subject.
- **Study the AI tier** — a worked example of an autonomous agent with real guardrails lives
  on the [`editorial-ai`](https://github.com/Jayaragul/THE_VISSION/tree/editorial-ai) branch:
  the research job runs with `contents: read` and no credential able to reach the repository,
  a separate job re-validates its output from a clean checkout before anything is committed,
  a publish gate blocks bad output, and a self-improvement loop cannot merge its own rule
  changes or touch the workflow file that would let it. It also ran, undetected, on a dead
  API key for nine days — see [RELIABILITY.md](RELIABILITY.md) for what that taught this
  branch about not depending on it.

## How it works

```
  ┌── TIER 1.5 · DIGEST ─── no AI, no key ──┐
  │  cluster + rank harvested headlines,     │
  │  no prose — a source's own title, always │  ← the front page, permanently
  └──────────────────┬────────────────────┘
  ┌── TIER 1 · WIRE ──────── no AI, no key ──┐
  │  ~30 RSS feeds → hundreds of leads/run   │
  └──────────────────┬───────────────────────┘
                     └──────────┬────────────────
                                ↓
                       node tools/build.mjs   ← pure function, no network
                                ↓
             index.html · digest.html · story/ · rss.xml · covers
                                ↓
                          GitHub Pages
```

The AI-written Edition tier that used to sit above this — research job, gated publish,
`generated/YYYY-MM-DD.json` — moved to the [`editorial-ai`](https://github.com/Jayaragul/THE_VISSION/tree/editorial-ai)
branch. This branch still renders and serves the 18 editions it already published (rule 3:
a published story never changes), but nothing here generates a 19th.

**`generated/*.json` is the source of truth. Every HTML file is build output.** Delete them
all, rebuild, and you get byte-identical files back — CI asserts it on every push, which is
what makes it impossible for a page to drift from its data.

📐 **[Read ARCHITECTURE.md](ARCHITECTURE.md)** for the design reasoning, the trade-offs, and
the honest list of what does not work.

## The tiers, plainly

Two independent processes publish to this site, and a third, archived one is still on it.
None depends on the others being up — that independence is the entire point (see
[ARCHITECTURE.md §1](ARCHITECTURE.md)).

| | The Wire | The Digest | The archived Edition |
| --- | --- | --- | --- |
| What it is | Raw headlines, straight from ~30 public feeds | The same headlines clustered, ranked, source-attributed — still no prose | Researched, verified, model-written stories — 18 of them, 17 Aug – 12 Sep 2026 |
| Needs an API key? | No | No | Yes — and only on `editorial-ai`, not this branch |
| Refreshes | Every 6 hours | 3× a day | Never again, on this branch |
| Where it lives now | Embedded at the bottom of the front page | **The front page itself**, and [digest.html](https://jayaragul.github.io/THE_VISSION/digest.html) | [archive.html](https://jayaragul.github.io/THE_VISSION/archive.html), unchanged |
| Verified? | No — publisher-attributed, unverified | No — but each item is badged **confirmed** only when two independent publishers cover it | Yes — every claim was traced to a primary source before it ran |
| Its history | `generated/wire/<date>.json` → [wire/&lt;date&gt;.html](https://jayaragul.github.io/THE_VISSION/) | `generated/digest/<date>.json` → [digest/&lt;date&gt;.html](https://jayaragul.github.io/THE_VISSION/digest.html) | `generated/<date>.json` → [edition/&lt;date&gt;.html](https://jayaragul.github.io/THE_VISSION/) |

**[archive.html](https://jayaragul.github.io/THE_VISSION/archive.html)** is the one place all
three show up together, one row per date. Every date after 12 September has only a Digest and
a Wire entry, by design, not because a run failed that day — the row says so. Every page also
states exactly when *that specific tier* last updated ("Collected 3 hours ago" on the wire,
"Last refreshed" on the digest) — a shared date isn't enough when two processes run on two
different schedules.

## The rules the pipeline cannot break

1. **Nothing is invented.** Not a URL, a quote, a number, a date, or a publisher name. If a
   source cannot be opened, the story does not run.
2. **Every story carries a source.** Lead and top stories carry two that are genuinely
   independent of each other.
3. **A published story id never changes.** Permalinks are permanent; the archive is a record.
4. **Fix the journalism, not the checker.** When the validator complains, the answer is
   better sourcing — never a relabelled tier.
5. **A short edition beats a padded one.** Running three stories light is a normal day.

Every story shows a **confidence label** and its **source tier**. When a primary source is
paywalled and could not be opened, the story says so by capping its confidence at `medium` —
it does not pretend to have read it.

**On images:** every cover is an original vector illustration, drawn at build time and
matched to the story's beat — a chip die for infrastructure, balance scales for policy, a
neural network for models. No photographs, ever: the paper has no licence to republish press
imagery, hotlinking would rot and would reintroduce third-party requests
[privacy.html](https://jayaragul.github.io/THE_VISSION/privacy.html) says do not happen, and
stock photos of glowing robot hands are the cliché this subject already drowns in.

## Run it yourself

Node 20+. **No `npm install`** — there are no dependencies, and that is a deliberate design
choice, not an oversight.

```bash
git clone https://github.com/Jayaragul/THE_VISSION.git
cd THE_VISSION
node tools/harvest.mjs      # collect leads from 24 public feeds — no API key needed
node tools/build.mjs        # render the site
node tools/serve.mjs        # http://localhost:4173
```

| Command | What it does |
| --- | --- |
| `node --test` | Run the unit tests in `test/` (feed parsing, schema, publisher matching, cover determinism, wire filtering) |
| `node tools/edition-info.mjs` | Date, next edition number, what already ran |
| `node tools/harvest.mjs` | Collect candidate leads (zero cost, no key) |
| `node tools/digest.mjs` | Tier 1.5: cluster + rank the harvest into a no-AI digest edition |
| `node tools/validate.mjs --strict` | The publish gate — errors *and* warnings block |
| `node tools/build.mjs` | Render the whole site from `generated/` |
| `node tools/serve.mjs` | Local preview |

### Publishing an AI edition

Not on this branch — the pipeline that does this lives on
[`editorial-ai`](https://github.com/Jayaragul/THE_VISSION/tree/editorial-ai). Check it out,
follow its own README, and bring your own `GEMINI_API_KEY`.

### Running it on a schedule

| Workflow | Schedule | Needs a key? |
| --- | --- | --- |
| `wire.yml` | every 6h | **no** |
| `digest.yml` | 3×/day | **no** |
| `verify.yml` | every push | no |

Just set **Settings → Pages → Source** to *Deploy from a branch*, `main`, `/ (root)` — no
secret to add, this branch needs none. The `editorial-ai` branch has its own additional
workflows and its own `GEMINI_API_KEY` requirement, documented there.

## Contributing

Contributions are genuinely welcome — especially source-book additions, new feed sources,
and hackathon listings. **[CONTRIBUTING.md](CONTRIBUTING.md)** has the details, and there
are good first issues that need no AI key at all.

Quickest useful contributions:

- **Add a hackathon** → `input/hackathons.json` (open the listing, verify the dates)
- **Add a source** → `input/sources.json` (with the correct tier)
- **Add a feed** → `tools/harvest.mjs` (check it returns 200 first)
- **Improve the design** → `assets/css/site.css` (never edit `.html`)

## Licence

**You can use this. You cannot reproduce it as your own.**

| | |
| --- | --- |
| **Software** (`tools/`, `assets/`, `schema/`, `.claude/`, `input/`) | [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) — run it, modify it, build your own non-commercial paper with it |
| **Published editions** (`generated/`, rendered pages, cover art) | [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) — read, quote with attribution, link freely; no republishing, no derivatives |

Copyright © 2026 **Jayaragul N**. All rights reserved. See [LICENSE](LICENSE) for the full
terms, including what is *not* covered — every linked article belongs to its own publisher.

For a commercial licence, ask the copyright holder.

---

<div align="center">

Founded and owned by **Jayaragul N** · Researched and written by an autonomous editorial pipeline

No advertising · No sponsorship · No position in anything covered

</div>
