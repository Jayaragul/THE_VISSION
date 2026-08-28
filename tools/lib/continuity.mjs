// Continuity: the machinery that turns a pile of daily editions into something a reader
// can follow, and that keeps the paper's own score.
//
// Three ideas, one problem. A daily paper publishes islands: a reader who cares about a
// developing story has no way to follow it, and a claim the desk marked "unconfirmed" is
// never returned to — which makes an honest hedge indistinguishable from a quiet mistake.
//
// Threads give a story a spine. Open questions record what the paper does not yet know
// and track it until an answer exists. Corrections make amendments permanent and visible.
//
// Pure functions over loaded editions, kept out of build.mjs so they can be tested without
// running a build.

/** Whole days from a to b. Both are ISO dates; the paper measures in days, not hours. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * Continuing stories, grouped by the thread id the desk set by hand.
 *
 * Nothing here is inferred, and that is the whole design. Measured against this archive,
 * shared entities produce mostly false connections: "Google" spans five editions without
 * being a story, and "Hugging Face" links an unrelated Qwen model release to an Nvidia
 * acquisition. A machine-guessed "story so far" would assert a connection nobody checked,
 * which is the one thing this paper cannot do. So a thread exists only where a human or
 * the pipeline deliberately wrote one.
 *
 * Returns a Map of id → { id, label, items }, items oldest first.
 */
export function collectThreads(editions) {
  const threads = new Map();
  for (const ed of editions) {
    for (const story of ed.stories || []) {
      if (!story.thread?.id) continue;
      if (!threads.has(story.thread.id)) {
        threads.set(story.thread.id, { id: story.thread.id, label: story.thread.label, items: [] });
      }
      threads.get(story.thread.id).items.push({ ed, story });
    }
  }
  for (const t of threads.values()) {
    t.items.sort((a, b) => a.ed.edition.date.localeCompare(b.ed.edition.date));
    // The newest instalment names the thread, so it can be renamed as a story turns out to
    // be about something larger than it first appeared.
    t.label = t.items[t.items.length - 1].story.thread.label;
  }
  return threads;
}

/**
 * Every question the paper has left open, oldest first, each carrying the later story that
 * answered it if one has.
 *
 * Oldest-first is deliberate: it puts what the desk has owed longest at the top rather
 * than burying it under fresher, easier items.
 */
export function collectOpenQuestions(editions) {
  const answers = new Map();
  for (const ed of editions) {
    for (const story of ed.stories || []) {
      if (story.resolves?.story) answers.set(story.resolves.story, { ed, story });
    }
  }
  const out = [];
  for (const ed of editions) {
    for (const story of ed.stories || []) {
      if (!story.openQuestion) continue;
      out.push({ ed, story, question: story.openQuestion, answer: answers.get(story.id) || null });
    }
  }
  return out.sort((a, b) => a.ed.edition.date.localeCompare(b.ed.edition.date));
}

/** Every post-publication amendment, newest first. */
export function collectCorrections(editions) {
  const out = [];
  for (const ed of editions) {
    for (const story of ed.stories || []) {
      for (const c of story.corrections || []) out.push({ ed, story, ...c });
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
