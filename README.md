<div align="center">

# THE VISSION

### A daily AI newspaper that writes itself — and keeps publishing when the AI stops.

**[📰 Read today's edition →](https://jayaragul.github.io/THE_VISSION/)**

[![Verify](https://github.com/Jayaragul/THE_VISSION/actions/workflows/verify.yml/badge.svg)](https://github.com/Jayaragul/THE_VISSION/actions/workflows/verify.yml)
[![Daily edition](https://github.com/Jayaragul/THE_VISSION/actions/workflows/daily-edition.yml/badge.svg)](https://github.com/Jayaragul/THE_VISSION/actions/workflows/daily-edition.yml)
[![Wire](https://github.com/Jayaragul/THE_VISSION/actions/workflows/wire.yml/badge.svg)](https://github.com/Jayaragul/THE_VISSION/actions/workflows/wire.yml)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](ARCHITECTURE.md#3-zero-dependencies-on-purpose)

*Free to read. No ads, no sponsors, no tracking, no newsletter popup.*

</div>

---

There is no newsroom. Claude Code researches the day's AI news, traces every claim to a
primary source, writes the copy, scores itself against a published rubric, and ships — every
morning, with no human in the loop.

Then it does the thing most agent projects skip: **it survives its own failure.** If the API
key expires or the model is down, a second tier with no AI in it at all keeps harvesting
publisher feeds and updating the front page. The site degrades, says so on the page, and
keeps going.

## Why you might care

- **Read it** — a daily AI briefing, free, with every claim one click from its source.
- **Fork it** — the whole pipeline is ~2,000 lines of dependency-free Node. Point it at any
  beat and you have a self-publishing paper on your own subject.
- **Study it** — a worked example of an autonomous agent with real guardrails: a publish
  gate that blocks bad output, a deterministic build CI can verify, and a self-improvement
  loop that cannot merge its own rule changes.

## How it works

```
  ┌── TIER 2 · EDITORIAL ──────────────── needs API key ──┐
  │  research → verify → write → SELF-SCORE               │
  │                          ↓                            │
  │              generated/YYYY-MM-DD.json                │
  └───────────────────────────┬───────────────────────────┘
                              │  validate --strict  ← fails? nothing publishes
  ┌── TIER 1 · WIRE ──────── no AI, no key ──┐   │
  │  24 RSS feeds → ~550 leads/run           │   │
  └──────────────────┬───────────────────────┘   │
                     └──────────┬────────────────┘
                                ↓
                       node tools/build.mjs   ← pure function, no network
                                ↓
                  index.html · story/ · rss.xml · covers
                                ↓
                          GitHub Pages
```

**`generated/*.json` is the source of truth. Every HTML file is build output.** Delete them
all, rebuild, and you get byte-identical files back — CI asserts it on every push, which is
what makes it impossible for a page to drift from its data.

📐 **[Read ARCHITECTURE.md](ARCHITECTURE.md)** for the design reasoning, the trade-offs, and
the honest list of what does not work.

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
| `node tools/validate.mjs --strict` | The publish gate — errors *and* warnings block |
| `node tools/build.mjs` | Render the whole site from `generated/` |
| `node tools/serve.mjs` | Local preview |

### Publishing an edition

```bash
claude
```
Then: *"Use the news-pipeline skill to publish today's edition."*

### Running it on a schedule

| Workflow | Schedule | Needs a key? |
| --- | --- | --- |
| `wire.yml` | every 6h | **no** |
| `daily-edition.yml` | 06:30 UTC | yes |
| `retrospective.yml` | Mondays 08:00 UTC | yes |
| `verify.yml` | every push | no |

Add `ANTHROPIC_API_KEY` in **Settings → Secrets → Actions** for the AI tiers, then set
**Settings → Pages → Source** to *Deploy from a branch*, `main`, `/ (root)`. The wire runs
without any of that.

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

Founded and owned by **Jayaragul N** · Researched and written by [Claude Code](https://claude.com/claude-code)

No advertising · No sponsorship · No position in anything covered

</div>
