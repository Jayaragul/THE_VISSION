# Contributing to THE VISSION

Contributions are welcome. Most of the useful ones need **no API key and no AI** — they are
edits to configuration files, and they make the paper measurably better.

Before anything else, two rules that are not negotiable:

1. **Never hand-edit an HTML file.** Everything outside the table in the next section is
   build output. The next run overwrites it and CI will fail your PR.
2. **Never invent a fact.** Not a URL, a date, a prize figure, a publisher name. If you
   cannot open the page, it does not go in.

## What you can edit

| File | What it controls | Needs a key? |
| --- | --- | --- |
| `input/hackathons.json` | The hackathons page | no |
| `input/sources.json` | Which publishers count, and at what tier | no |
| `input/beats.json` | Sections, quotas, seed queries | no |
| `input/editorial.md` | Voice, banned constructions, story shape | no |
| `input/site.json` | Site name, nav, description | no |
| `tools/harvest.mjs` | Which feeds get harvested | no |
| `tools/validate.mjs` | What blocks publication | no |
| `assets/css/site.css` | How every page looks | no |
| `tools/lib/render.mjs` | Page structure | no |
| `.claude/skills/*/SKILL.md` | How the pipeline behaves | yes, to test |

Anything not listed — `index.html`, `story/`, `edition/`, `assets/img/covers/`, `rss.xml`,
`sitemap.xml`, `generated/index.json` — is generated. Do not touch it.

---

## Good first contributions

### Add a hackathon

The highest-value contribution, because this page is curated by hand — Devpost's API returns
403, so nothing can harvest it automatically.

1. Open the organiser's own listing page and read it. Not a roundup article, the listing.
2. Add an entry to `hackathons` in `input/hackathons.json`:

```json
{
  "name": "Exact name as the organiser writes it",
  "url": "https://the-listing-page-you-actually-opened",
  "organiser": "Who runs it",
  "format": "online",
  "starts": "2026-09-01",
  "deadline": "2026-09-30",
  "prize": "$10,000 in prizes",
  "eligibility": "One short line. Say plainly if it is students-only.",
  "verifiedAt": "2026-08-17"
}
```

3. `node tools/build.mjs` and check `hackathons.html`.

Expired entries drop off automatically — the build filters on `deadline`, so you never need
to come back and clean up.

### Add a source

`input/sources.json` decides which publishers the pipeline may cite. Tier honestly:

- **Tier 1 — primary.** The organisation, the filing, the paper, the dataset itself.
- **Tier 2 — newsroom.** Established outlet, named reporters, corrections policy.
- **Tier 3 — secondary.** Credible but derivative. Never stands alone.
- **Tier 4 — unvetted.** Anything unlisted. Needs a tier 1 or 2 alongside it.

Lab and regulator domains belong at tier 1 — they are primary sources by definition. If you
are arguing yourself into a higher tier for a publisher, it belongs at the lower one.

### Add a feed

`FEEDS` in `tools/harvest.mjs`. Check it works first:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -L "https://example.com/feed.xml"
```

A 200 with `<item>` or `<entry>` elements is all the parser needs. Then run
`node tools/harvest.mjs` and confirm your feed reports a non-zero count.

Feeds that are general-interest rather than AI-specific are fine — the wire filters for
relevance at display time, and broad harvesting helps the research stage.

### Improve the design

`assets/css/site.css` is hand-written and the build never touches it. Rebuild and preview:

```bash
node tools/build.mjs && node tools/serve.mjs
```

Check both themes. The site follows `prefers-color-scheme` and has a manual toggle, so a
colour defined in only one of them is a bug.

### Add a validator check

The most valuable code contribution. If you spot a defect the pipeline keeps producing, a
check in `tools/validate.mjs` prevents it permanently — a machine check cannot be forgotten
by the next run, and a paragraph in a markdown file can.

Errors block publication; warnings block under `--strict`. Put prose and style judgements in
warnings, and factual or structural defects in errors.

---

## Before you open a pull request

```bash
node tools/validate.mjs --strict   # must pass
node tools/build.mjs               # must succeed
git diff --stat                    # review what changed
```

CI runs the same two commands and then asserts that the committed HTML matches a fresh
build. If you edited a generated file, this is where it fails.

**If you changed anything in `tools/` or `assets/css/`, commit the rebuilt output too.** The
repository stores build output deliberately — GitHub Pages serves it directly.

### Commit messages

Explain why, not what. The diff shows what changed.

## What will get turned down

- Hand-edited HTML.
- A source, hackathon or figure that cannot be verified by opening the page.
- Loosening a validator check to make an edition pass. Fix the journalism instead.
- Adding an npm dependency. See
  [ARCHITECTURE.md §3](ARCHITECTURE.md#3-zero-dependencies-on-purpose) — this one is
  load-bearing, and a PR that adds a `package.json` will be closed.
- Editing a published edition in `generated/` to change what it said. The archive is a
  record. Corrections are welcome as a new edition or an explicit correction note.

## Licence and ownership

By contributing you agree your contribution is distributed under the terms in
[LICENSE](LICENSE) — PolyForm Noncommercial for software — and that copyright in the
combined work remains with Jayaragul N. **You keep the copyright in your own contribution.**

## Questions

Open an issue. If you are unsure whether something belongs, asking first is cheaper for both
of us than a rejected PR.
