# News quality controls

The scheduled digest is an aggregator, not a fact-checker. Public labels describe source coverage rather than certifying truth. The legacy JSON value `confidence: "confirmed"` is retained for compatibility but renders as multiple-publisher coverage, explicitly not fact-checked.

`tools/lib/news-quality.mjs` provides the 48-hour admission window, topic hygiene, parent-publisher grouping and Anthropic newsroom parser. `tools/digest.mjs` uses the harvest timestamp, applies topic caps and limits each publisher group to five items. The wire also rejects stale, future and recognizable non-news items. These controls are heuristics and do not establish the truth of a publisher's claims.

`input/reviewed-leads.json` is a separate, versioned list of source-read additions. Each needs a title, source URL, publication date, review timestamp, beat and contextual note. These additions are not automatically written by the scheduled pipeline. They expire after the same news window and appear in a short homepage briefing only while fresh. Known day-only publication dates are normalized to midnight UTC for ordering, not treated as precise publication times. Preserve uncertainty, availability limits and the historical scope of research findings in the notes.

Anthropic's dated newsroom is collected directly because no first-party RSS source was available in the original feed list. If its dated-row format stops matching, the collector reports a failure instead of inventing dates. METR's official RSS feed adds independent safety-research coverage. Search redirects remain discovery leads and cannot supply publishable source URLs.

Tests: `node --test`. Rebuild: `node tools/harvest.mjs`, `node tools/digest.mjs`, `node tools/build.mjs`. Do not hand-edit generated HTML. Archived authored edition data is not rewritten by these controls, and its historical claims are not certified by a successful schema check.
