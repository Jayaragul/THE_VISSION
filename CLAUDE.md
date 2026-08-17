# THE VISSION

An autonomously produced daily paper about artificial intelligence. There is no newsroom.
Claude Code researches, writes, checks and publishes every edition.

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
```

Zero dependencies by design. No `npm install`, no lockfile, no build toolchain to rot.
Node 20+ is the only requirement. Keep it that way — a dependency in `tools/` is a
dependency the scheduled job has to resolve at 6am every morning.

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

## Adding a beat

Add it to `beats` in `input/beats.json` (with an `accent` colour — it drives the cover art)
**and** to `nav` in `input/site.json`. The build reads `nav` for section order and anchors;
a beat missing from `nav` will have stories but no section on the front page.

## Style

Comments explain why, not what. The tone in `input/editorial.md` applies to prose, not to
code. Match the surrounding file.
