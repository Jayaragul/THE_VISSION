---
name: editorial-review
description: Score a drafted edition of THE VISSION against evals/rubric.md before it publishes — checks sourcing, prose quality, selection judgement and edition balance, then writes evals/<date>.json with a pass or revise verdict, bound to the exact edition it reviewed. Use after drafting an edition and before building or pushing, or when asked to review, grade or critique an edition.
---

# The review pass

`tools/validate.mjs` catches what a machine can catch: schema, sourcing policy, banned
phrases, duplicate URLs. This pass catches what it cannot — whether the edition is any good.

Run it on a drafted edition **before** `tools/build.mjs`, and read the edition as a reader
would, front to back, before scoring anything.

## First, the mechanical gate

```bash
node tools/validate.mjs --strict --report evals/last-validate.json
```

If that fails, stop. There is no point grading prose that will not publish.

## Then score

Open `evals/rubric.md` and score each of the five dimensions 1–5. Write the score **and the
sentence of evidence that justifies it** — a score without a quoted example is a guess.

Do not average away a failure. Any dimension at 1 or 2 is a revise verdict on its own,
whatever the total says.

### The questions that actually find problems

Work through these on the actual copy. They are ordered by how often they catch something.

1. **Read only the `summary` bullets of the lead.** Are you correctly informed, or do you
   need the body? Bullets that are topics rather than facts are the single most common defect.
2. **Cover the headline and read the deck.** Does it still tell you something? If it only
   restates the headline, it is dead weight.
3. **For every `high` confidence story, name the primary source out loud.** If you cannot,
   the label is wrong.
4. **Read every `whyItMatters`.** Could a reasonable person disagree with it? If not, it is a
   truism and it should be cut or sharpened.
5. **Check the lead against the other stories.** Is it genuinely the most important thing
   that happened, or just the one with the best sources?
6. **Look for two stories that are the same story.** Overlapping entity plus overlapping
   timeframe usually means a merge.
7. **Read the first sentence of every body paragraph in sequence.** They should form a spine.
   If they wander, the story is unstructured.
8. **Count vendor claims presented as results.** Every one is a correctness bug.

### Balance

- One lead, and it earns the slot.
- No single company in more than about a third of the stories unless the day genuinely
  belonged to them — and if so, `edition.summary` should say so.
- Beats near their quotas, or an honest reason why not.
- Briefs are facts, not teasers for stories you did not write.

## Verdict

Write `evals/<edition-date>.json` — **not** a fixed filename. An eval that does not name
which edition it reviewed is a claim nobody can check, and this repository has already shipped
one that silently drifted: a review recorded 11 stories while 13 were live on the site. The
`edition` block below is what `tools/validate.mjs` checks against the real edition before
publish — get it wrong and the gate blocks, which is the point.

Compute it, don't guess it:

```bash
node --input-type=module -e "
import { readJSON, editionHash } from './tools/lib/util.mjs';
const doc = readJSON('generated/<edition-date>.json');
console.log({
  storyCount: doc.stories.length,
  sourceCount: new Set(doc.stories.flatMap(s => (s.sources||[]).map(x=>x.url))).size,
  sha256: editionHash(doc),
});
"
```

```json
{
  "date": "YYYY-MM-DD",
  "reviewedAt": "ISO-8601",
  "edition": { "date": "YYYY-MM-DD", "storyCount": 13, "sourceCount": 17, "sha256": "<from the command above>" },
  "scores": { "sourcing": 5, "accuracy": 4, "prose": 4, "selection": 4, "balance": 5 },
  "total": 22,
  "verdict": "pass",
  "evidence": [
    { "dimension": "prose", "note": "Lead deck restated the headline; rewritten to add the funding figure." }
  ],
  "revisions": ["..."],
  "notes": "..."
}
```

- **`total` ≥ 20 and no dimension below 3** → `pass`. Build and publish.
- **Anything else** → `revise`. Fix the specific stories named in `revisions`, then score
  again from scratch. Do not carry forward the old scores.

If you revise the edition after scoring, recompute the `edition` block before writing the
file — a binding for the edition you scored an hour ago, not the one you are about to ship,
is exactly the drift this mechanism exists to catch.

Two failed review passes on the same edition means the underlying research is thin. Go back
to Stage 1 and find better stories rather than polishing weak ones.

## Keep the record

Each edition's eval lives at its own path, keyed by date — nothing is overwritten, and the
archive of past scores is the `evals/` directory itself, not git history for one mutable file.
Over time the interesting question is which dimension keeps scoring lowest. When one does, the
fix is usually a rule added to `input/editorial.md` or a new check in `tools/validate.mjs`, so
that the next run cannot make the same mistake. That is how this paper gets better.
