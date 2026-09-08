# Proposed study: deterministic daily news with bounded AI assistance

## Assessment

This is a useful engineering project and a possible systems/demo or applied evaluation paper.
It is not yet evidence of a novel news recommendation algorithm or ten-year reliability.
News aggregation and recommendation are established research areas: for example,
[Das et al., WWW 2007](https://research.google/pubs/google-news-personalization-scalable-online-collaborative-filtering/)
and [Wu et al., Personalized News Recommendation: Methods and Challenges](https://arxiv.org/abs/2106.08934).
A fuller related-work review is required before claiming novelty.

The candidate contribution is a measured publication architecture: daily news remains
available without a model, while optional AI spending is bounded by a durable weekly
reservation. Reproducible inputs, explicit source attribution, honest failure behavior and
transparent cost measurements could form a useful case study.

## Research questions

1. How does separating deterministic publication from optional AI change publication
   availability under feed outages, invalid responses and model failures?
2. How much token usage is avoided compared with the prior daily agent pipeline, and
   how does reader-assessed usefulness change?
3. How do fixed ranking and clustering rules affect relevance, source diversity, duplicate
   suppression and missed stories relative to simple chronological selection?

## Protocol to run before writing results

Freeze a versioned, permitted dataset of publisher feed snapshots for at least 30 days.
Use exactly the same input snapshots and dates across systems. Respect publisher rights;
sharing source URLs, hashes and metadata may be preferable to redistributing full text.
Keep a held-out period for evaluation after selecting rules.

Compare (A) chronological Wire, (B) deterministic Digest, (C) Digest plus a weekly briefing,
and, if credentials and measured usage are available, (D) the previous daily AI pipeline.
Do not invent cost figures for missing historical logs or compare unlike workloads as if equal.

Inject timeouts, HTTP 429/503, malformed feeds, oversized bodies, empty collections, invalid
model JSON, missing credentials, interrupted writes, duplicate scheduled runs and failed
reservation pushes. Record denominators, which components failed, retained-content age and
whether new content was actually published. Serving an old page is not fresh-news availability.

Record publication success rate, time to publish, recovery time, byte-identical replay rate,
provider-reported input/output tokens, request count and actual billed cost where available.
For ranking, use blinded human relevance judgements, precision@10, duplicate rate, source
concentration and topic coverage. For briefings, annotate unsupported statements and
attribution accuracy. Describe annotator count, instructions, agreement and uncertainty.

Ablate clustering, source caps, novelty and urgency separately. Report failure examples,
including incorrect geographic classification and independent publishers repeating the same
underlying claim. Evaluate source independence; two URLs do not establish truth.

## Suggested paper structure

Problem and constraints; related work; architecture and budget mechanism; reproducibility
contract; dataset and evaluation protocol; measured results; threats to validity; limitations;
artifact availability. Include implementation commit hashes, rule versions, input hashes,
random seeds where applicable and exact outage scenarios.

No experimental findings are claimed in this document. Passing unit tests is supporting
engineering evidence, not a substitute for the study. Calendar tests reaching 2036 do not
simulate ten years of hosting, model retirement or publisher changes.
