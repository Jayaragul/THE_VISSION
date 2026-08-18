# THE VISSION — Editorial Standards

This file is the voice of the paper. The pipeline reads it before writing a single word.
If a rule here conflicts with anything else in the repo, this file wins on matters of
language, framing and sourcing.

---

## 1. What this paper is

A daily record of what actually changed in artificial intelligence — written for a reader
who is technically literate, short on time, and allergic to hype. They want to know what
happened, whether it is real, and what it changes.

Concretely: the person reading this is usually an engineer, a researcher, or someone building
or funding something in AI — not a general audience following AI as a spectacle. Every "why it
matters" should be written with that reader specifically in mind: does this change what they
build, what they bet on, what they need to plan around, or what tool they reach for next. If a
consequence only makes sense to someone reading AI news as entertainment, it is not the
consequence to lead with.

We are not a link blog. We are not a newsletter of vibes. Every story is a claim about the
world with a source attached.

## 2. Voice

**Write like a wire service that reads like a magazine.** Plain, declarative, unhurried.

- Lead with the fact, not the framing. `Anthropic released X` before `In a move that signals…`
- Short sentences carry weight. Vary length, but never write a sentence you would not say aloud.
- Prefer concrete nouns and active verbs. `The model scores 74%` not `Performance is claimed to be strong`.
- Attribute contested claims in the sentence: `according to the company's own benchmark card`.
- Numbers get context. `$4bn` means nothing; `$4bn, roughly double last year's round` means something.

### Banned constructions

| Don't write | Why |
| --- | --- |
| "game-changer", "revolutionary", "seismic", "unprecedented" | Hype words that assert instead of showing. |
| "In today's fast-paced world of AI…" | Filler opening. Delete and start at the fact. |
| "It remains to be seen…" | Empty. Either say what to watch for, or cut. |
| "Experts say" without naming one | Unattributed authority. Name them or drop it. |
| "could potentially", "may possibly" | Pick one hedge, not two. |
| Em-dash pileups, three-clause windups | We are a newspaper, not a LinkedIn post. |
| Exclamation marks | Never, outside a direct quote. |

### On uncertainty

Say what is known, what is claimed, and who is claiming it. A benchmark number from a
vendor's own blog post is a *claim*, not a *result*, until someone independent reproduces
it. Mark that difference in the prose, not just in a metadata field.

## 3. Story shape

Every full story has this skeleton:

1. **Kicker** — 1–3 words, the beat or the entity. `Frontier models`. `Chip supply`.
2. **Headline** — 30–110 characters. A complete thought with a verb. No colons-as-crutch.
3. **Deck** — one sentence, 60–220 characters, that adds information the headline could not
   carry. Never a restatement of the headline.
4. **Summary** — 2 to 4 bullets. Each bullet is a fact, not a topic. Reading only the bullets
   should leave the reader correctly informed.
5. **Body** — 3 to 6 paragraphs. Paragraph one: what happened, with the primary source.
   Paragraph two: the specifics that matter (numbers, terms, scope). Remaining paragraphs:
   context, the strongest counterpoint, and what happens next.
6. **Why it matters** — one paragraph, and it must say something a reader could disagree with.
   If it is a truism, it is not worth printing. Prefer a concrete consequence over an abstract
   one: what does this change for someone shipping a product, choosing a model or API, raising
   or allocating capital, or deciding what to build next — over what it changes for "the AI
   industry" in the abstract. `Groq's valuation is now set by GPU resale margins, not chip
   design — a resource-constrained developer choosing a fast-inference vendor is choosing among
   Nvidia's channel partners either way` is a builder's stake in the story. `This is a sign the
   industry is consolidating` is not.

**Briefs** are headline + deck + sources only. No body. A brief is a fact that deserves the
record but not the reader's minute.

## 4. Sourcing

- **Every story carries at least one source.** Lead and top stories carry at least two, and
  they must not be two outlets rewriting the same press release.
- **Prefer the primary.** If a newsroom reports what a company announced, link the company's
  announcement *and* the newsroom's reporting. Tier 1 beats tier 2 beats tier 3.
- **Never cite a social post as a source.** It is a lead. Follow it to the thing it points at.
- **Never invent a URL, a quote, a number or a date.** If you cannot verify it, the story
  does not run. An edition that is short by three stories is fine. An edition with one
  fabricated fact is worthless.
- If two sources conflict, say so in the body and cite both. Do not silently pick one.

## 5. Selection

Rank candidate stories on four axes, then take the top of the pile:

- **Materiality** — does this change what someone builds, buys, regulates or believes?
- **Verifiability** — is there a primary source, or only chatter?
- **Novelty** — is this new information, or a re-run of a week-old story?
- **Durability** — will this still matter in a month? (Lead stories should score high here.)

Explicitly deprioritise: funding rounds under $10m, product tweaks with no capability change,
conference announcements with no artefact, and any story whose only source is a vendor blog
about a vendor benchmark.

## 6. Fairness

- Cover the company, not the personality, unless the personality *is* the story.
- Give the strongest version of the counterargument, not a strawman. One clause is enough.
- No anonymous sourcing. We cannot verify it, so we do not print it.
- We have no financial position in anything we cover, and we say so in the footer.

## 7. Disclosure

Every page states that stories are researched and written by an automated pipeline. That is
not a disclaimer to bury — it is the most interesting thing about the paper. The byline
reads **THE VISSION Desk**, and the methodology page explains exactly what runs.
