# Edition rubric

Five dimensions, scored 1–5. **Pass is a total of 20 or more with no dimension below 3.**

Anything at 1 or 2 is a revise verdict on its own, regardless of the total. A strong score
somewhere else does not buy off a sourcing failure.

Score against the drafted `generated/YYYY-MM-DD.json`, not against your memory of writing it.
Every score needs a quoted example from the edition as evidence.

---

## 1. Sourcing

*Can a sceptical reader verify every claim in under a minute?*

| | |
| --- | --- |
| **5** | Every story has a working primary source. Lead has two genuinely independent ones. Tiers are honest. |
| **4** | One or two stories rest on tier-2 reporting with no primary available, and say so in the copy. |
| **3** | Sourcing is adequate but thin in places; some stories would not survive a determined challenge. |
| **2** | A story runs on a single tier-3 source, or two "independent" sources are the same press release. |
| **1** | A URL does not resolve, a publisher is misattributed, or a source was not actually opened. |

A fabricated source is an automatic 1 and an automatic revise. There is no version of this
paper that survives that.

**Blocked primaries are a separate case.** Bloomberg, the WSJ, OpenAI and several other
important publishers return 403 to an automated fetch. A source that could not be opened for
that reason may still be cited, but only when all three hold:

1. A source you *did* open quotes or cites it directly, so its existence and its content are
   independently attested.
2. The story's `confidence` is capped at `medium`, never `high`.
3. The prose attributes the claim to the reporting you actually read, not to the document you
   could not.

A blocked primary handled that way costs a point on this dimension — it does not fail the
edition. A blocked primary cited as though it had been read is fabrication by another route,
and scores 1.

## 2. Accuracy

*Is every number, date, name and quotation exactly what the source says?*

| | |
| --- | --- |
| **5** | All figures carry units and a basis. Vendor claims are framed as claims. No overstatement anywhere. |
| **4** | Minor imprecision — a rounded figure, a slightly loose paraphrase — that does not mislead. |
| **3** | One number lacks context that a reader would want, or one vendor benchmark reads as a result. |
| **2** | A figure is stated without its basis in a way that changes the impression it gives. |
| **1** | A number, date or attribution contradicts the source. |

## 3. Prose

*Would this survive a copy desk?*

| | |
| --- | --- |
| **5** | Plain, declarative, specific. Decks earn their place. Bullets are facts. Nothing to cut. |
| **4** | Solid throughout; one or two sentences are longer than they need to be. |
| **3** | Readable, but some hedging, some abstraction where a concrete noun belonged. |
| **2** | Filler openings, decks restating headlines, bullets that name topics instead of stating facts. |
| **1** | Hype vocabulary, or copy that could describe any week in AI without changing a word. |

The style linter in `tools/validate.mjs` catches the banned constructions. This dimension is
about the sentences it cannot see.

## 4. Selection

*Is this what actually mattered?*

| | |
| --- | --- |
| **5** | The lead is unarguable. Every story earns its slot. The cuts were right. |
| **4** | Strong edition; one story is more interesting than important. |
| **3** | Defensible, but the lead is arguable and one or two slots went to filler. |
| **2** | A sub-$10m funding round or a product tweak is running at `top`. Something bigger was missed. |
| **1** | The edition repeats a previous edition, or leads on a vendor announcement with no substance. |

Check `generated/index.json` before scoring this. Repeating yesterday is the failure mode
that is hardest to notice from inside a single run.

## 5. Balance

*Does the edition read as a day, or as a list?*

| | |
| --- | --- |
| **5** | Beats near quota, no single company dominating, briefs are real facts, editor's note frames the day. |
| **4** | One beat short of quota with a good reason. |
| **3** | Coverage skews to one beat or one company without the editor's note acknowledging it. |
| **2** | A `minQuota` beat is empty, or more than half the stories are about one company. |
| **1** | The edition is effectively one company's press day. |

---

## Recording the result

Write `evals/<edition-date>.json` in the shape given in the `editorial-review` skill,
including the `edition` binding block (story count, source count, a SHA-256 of the edition's
stories). `tools/validate.mjs` checks that binding against the real edition on every run and
blocks publication if they disagree — an eval that reviewed a different edition than the one
about to ship is not a review, it's a stale claim. Include the evidence, not just the
numbers — a score with no quoted example is not a review either.

## Using the history

Each edition's eval lives at its own dated path; nothing is overwritten, so `evals/` itself is
the archive. The signal worth watching is which dimension scores lowest over a stretch of
editions:

- **Sourcing or accuracy trending down** → tighten `tools/validate.mjs`. A machine check that
  cannot be forgotten beats a rule that can.
- **Prose trending down** → add the specific construction to the banned table in
  `input/editorial.md` and to `STYLE_TRAPS` in the validator.
- **Selection trending down** → the seed queries in `input/beats.json` are stale, or the
  quotas are pushing the pipeline to fill slots it should leave empty.
- **Balance trending down** → adjust quotas, or add a beat.

Fixing the rule is worth more than fixing the edition.
