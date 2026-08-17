# THE VISSION

**A daily paper about artificial intelligence that no human writes.**

Claude Code researches the day's news, verifies it against primary sources, writes the copy,
scores itself against a rubric, and publishes — every morning, without a person in the loop.

**Live:** https://jayaragul.github.io/THE_VISSION/

---

## How it works

```
   input/          .claude/skills/       evals/
   beats           news-pipeline         rubric.md
   sources         story-research        last-run.json
   editorial.md    editorial-review
        │                 │                  │
        └────────────┬────┴──────────────────┘
                     ↓
            ┌──────────────────┐
            │   Claude Code    │   WebSearch → WebFetch → verify → write
            └────────┬─────────┘
                     ↓
         generated/YYYY-MM-DD.json          ← the only thing that is authored
                     │
       node tools/validate.mjs --strict     ← the gate. fails = nothing publishes
                     │
       node tools/build.mjs                 ← pure function: JSON → site
                     ↓
   index.html · story/*.html · edition/*.html
   rss.xml · sitemap.xml · assets/img/covers/*.svg
                     │
            git commit && git push
                     ↓
              GitHub Pages
```

**`generated/*.json` is the source of truth.** Every HTML file in this repo is build output
and is overwritten on the next run. Delete every `.html` and run `node tools/build.mjs` — you
get byte-identical files back. CI asserts exactly that, which is how the repo guarantees no
page was ever hand-edited into disagreeing with its data.

## Repository layout

| Path | What it is | Who edits it |
| --- | --- | --- |
| `input/` | Beats, source tiers, editorial standards, site config | You |
| `.claude/skills/` | The pipeline's standing instructions | You |
| `evals/` | The rubric, and the last run's honest scores | You write the rubric |
| `schema/` | The contract every edition must satisfy | You |
| `tools/` | Validator, builder, cover art, dev server | You |
| `assets/css`, `assets/js` | Hand-written stylesheet and progressive enhancement | You |
| `generated/` | One JSON file per edition — **the archive** | The pipeline |
| `*.html`, `story/`, `edition/`, `*.xml`, `assets/img/covers/` | Build output | Nobody |

## Running it

Requires Node 20+. **There are no dependencies** — no `npm install`, no lockfile, nothing for
the 6am scheduled job to fail to resolve.

```bash
node tools/edition-info.mjs        # date, next edition number, what already ran
node tools/validate.mjs --strict   # the publish gate
node tools/build.mjs               # render the site from generated/
node tools/serve.mjs               # preview at http://localhost:4173
```

### Publishing an edition by hand

```bash
claude
```

Then: *"Use the news-pipeline skill to publish today's edition."*

### Publishing on a schedule

`.github/workflows/daily-edition.yml` runs at 06:30 UTC. Claude researches and writes the
JSON; the **workflow** validates, builds and pushes. Claude never runs git in CI, so an
edition that fails the gate simply does not publish and yesterday's front page stays up.

To enable it, add one repository secret:

| Secret | Where to get it |
| --- | --- |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |

Then set **Settings → Pages → Source** to *Deploy from a branch*, `main`, `/ (root)`.

You can also trigger a run manually from the Actions tab, optionally passing a date to
backfill a past edition.

## The rules the pipeline cannot break

1. **Nothing is invented.** Not a URL, a quotation, a number, a date, or a publisher name.
   If a source cannot be opened, the story does not run.
2. **Every story carries a source.** Lead and top stories carry two that are genuinely
   independent of each other.
3. **A published story id never changes.** `story/<id>.html` is a permalink; the archive is a
   record, not a working draft.
4. **Fix the journalism, not the checker.** When the validator complains, the answer is
   better sourcing or better prose — never a relabelled tier.
5. **A short edition beats a padded one.** Running three stories light is a normal day.

`tools/validate.mjs` enforces what a machine can: schema conformance, one lead per edition,
source tiers against the blocklist, duplicate URLs across stories, brief/body shape, beat
quotas, publication-date windows, and a house-style linter for hype vocabulary. `--strict`
promotes warnings to errors and is what CI runs.

## On images

Every story carries original cover art, generated deterministically from its story id
(`tools/lib/cover.mjs`). Six compositional styles, coloured from the beat's accent, with a
seeded PRNG so a published cover never changes.

This is a deliberate choice, not a placeholder. The paper has no licence to republish other
outlets' press photography; hotlinked images rot within weeks and take the page's credibility
with them; and a consistent house visual language beats a grid of mismatched stock photos.

## Known limitations

- **Open-graph images are SVG.** Some social platforms will not render them. Fixing it
  properly needs a rasteriser, which means a dependency, which the toolchain deliberately
  refuses. Weigh that trade before changing it.
- **Roughly a third of promising leads die at a 403.** Bloomberg, the WSJ, the FT and
  openai.com all block automated fetches. The pipeline handles this with the blocked-primary
  rule in `evals/rubric.md` rather than by pretending to have read them.
- **An automated pipeline can be confidently wrong.** The mitigations are source tiers, a
  confidence label printed on every story, and every source one click away. Read the sources.

## Adding a beat

Add it to `beats` in `input/beats.json` with an `accent` colour (it drives the cover art),
**and** to `nav` in `input/site.json`. The build reads `nav` for section order and anchors.

---

Researched, written and published by [Claude Code](https://claude.com/claude-code).
No advertising, no sponsorship, no position in anything covered.
