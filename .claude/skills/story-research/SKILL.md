---
name: story-research
description: Research and verify a single news story to THE VISSION's sourcing standard — find the primary source, confirm every number and date, assign a source tier and a confidence label. Use when adding one story to an edition, checking a claim, chasing a lead, or when a story fails the sourcing checks in tools/validate.mjs.
---

# Verifying one story

This is the unit of work the whole paper is built from. The pipeline calls it in bulk; you
can also call it on its own when a single story needs chasing down.

## The order of operations

**1. Start from the claim, not the article.** Write down, in one sentence, the thing you are
asserting is true. `Anthropic released Claude Opus 5 with a 74.2% score on SWE-bench Verified.`
That sentence is what needs sourcing — not "there's news about Claude".

**2. Find who would know.** For each kind of claim there is exactly one place the truth
lives, and it is rarely the first search result:

| Claim | Primary source |
| --- | --- |
| A model shipped, or its capabilities | The lab's own release post, model card or docs |
| A benchmark number | The benchmark's own leaderboard, or the paper — not the vendor's blog |
| Money raised or spent | The company's announcement, or an SEC / regulator filing |
| A research result | The arXiv or journal paper itself, never the write-up |
| A law, rule or ruling | The register, the regulator's page, the court docket |
| An outage, breach or incident | The provider's status page or post-mortem |

**3. Open it.** `WebFetch` the page and read it. A search snippet is not a source, and a
headline is not a fact. Roughly one lead in five turns out to say something meaningfully
different from what the snippet implied — that gap is the entire reason this step exists.

**3b. When the primary is locked.** Bloomberg, the WSJ, the FT, CNBC and openai.com all return
403 to an automated fetch. That is bot protection, not evidence the page is fake — but you
have still not read it, and you must not pretend otherwise. You may cite a blocked primary
only if a source you *did* open quotes or cites it directly; the story's `confidence` is then
capped at `medium`, and the prose attributes the claim to the reporting you actually read
("Bloomberg reported", "quoted by Help Net Security"). Never write around a 403 by describing
the locked page as though you had opened it.

**4. Corroborate.** Find a second, independent source. Two outlets rewriting the same press
release are one source wearing two hats; check whether the second one did any reporting of
its own. A lead story needs two genuinely independent sources.

**5. Reconcile.** If sources disagree on a number or a date, do not silently pick the one you
like. Say so in the body and cite both. Contradiction is information.

## Tiers

Assign the tier from `input/sources.json` by looking up the host — do not assign by feel, and
never upgrade a tier to get a story past the validator.

- **Tier 1 — primary.** The organisation, the filing, the paper, the dataset.
- **Tier 2 — newsroom.** Established outlet, named reporters, corrections policy.
- **Tier 3 — secondary.** Credible but derivative. Corroboration only, never alone.
- **Tier 4 — unvetted.** Anything not on the list. Needs a tier 1 or 2 alongside it.

Hosts in `blocked` are not sources at any tier. A post on a social platform, an aggregator
thread or a self-published newsletter is a **lead**: follow it to what it points at.

## Confidence

This label is printed on the story, so it has to be honest.

- **`high`** — a primary source confirms the central claim, and you opened it.
- **`medium`** — credible reporting, no primary source available yet. Most breaking stories
  live here for a few hours.
- **`low`** — a single source, or sources that conflict, or a claim that rests on an
  unnamed informant. Low-confidence stories do not lead the paper.

If you find yourself reaching for a justification to move a story up a level, that is the
signal it belongs at the lower one.

## Numbers

Every number gets checked against the source and given a unit and a basis. `40% faster` is
not a fact until you can say faster than what, measured how, by whom. If the source does not
say, the story says the source does not say.

Vendor benchmark numbers are **claims**, not results, until someone independent reproduces
them. Write them that way: `the company reports 74.2%, on its own evaluation harness`.

## What kills a story

Drop it, and do not negotiate with yourself:

- You cannot open the source, or the URL 404s.
- The only sources are tier 3 or 4.
- The central claim traces back to an anonymous account and nothing else.
- The "news" is a restatement of something already in a previous edition — check
  `generated/index.json`.
- The story is a product announcement with no capability, price or availability change.

A dropped story costs one slot. A wrong story costs the paper.
