// Pure logic behind the weekly review — kept out of tools/weekly.mjs so it can be tested
// without touching the filesystem, the same reason continuity.mjs's functions are kept out
// of build.mjs. See tools/weekly.mjs for what this is and why it calls no model.

import { collectThreads, collectOpenQuestions, collectCorrections, daysBetween } from './continuity.mjs';

/**
 * The trailing-7-day window ending at the latest edition on or before `asOf`. Same
 * arithmetic as build.mjs's topicOfTheWeek (setUTCDate against an edition date, never
 * against the wall clock), so the two can never silently disagree about what "this week"
 * means. Returns null when no edition exists on or before `asOf` — nothing to review.
 */
export function computeWindow(editions, asOf) {
  const eligible = editions.filter((ed) => ed.edition.date <= asOf);
  if (!eligible.length) return null;

  const to = eligible[eligible.length - 1].edition.date;
  const cutoff = new Date(`${to}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  const from = cutoff.toISOString().slice(0, 10);

  const inWindow = editions.filter((ed) => ed.edition.date >= from && ed.edition.date <= to);
  return { from, to, inWindow, editionDates: inWindow.map((ed) => ed.edition.date) };
}

/**
 * Every place a `resolves.story` value fails to name a real, question-asking story,
 * anywhere in the archive — independent of any window. continuity.mjs's own
 * collectOpenQuestions() looks this up as a bare string key with no existence check
 * (continuity.mjs's answers map), so a dangling or misspelled reference is silently
 * dropped everywhere the archive renders rather than surfacing as an error. This is the
 * first thing in the repository that actually checks it. Returns an array of human-readable
 * problem strings; empty means clean.
 */
export function checkReferentialIntegrity(editions) {
  const allIds = new Set(editions.flatMap((ed) => ed.stories.map((s) => s.id)));
  const askingIds = new Set(editions.flatMap((ed) => ed.stories.filter((s) => s.openQuestion).map((s) => s.id)));
  const problems = [];
  for (const ed of editions) {
    for (const s of ed.stories) {
      if (!s.resolves?.story) continue;
      if (!allIds.has(s.resolves.story)) {
        problems.push(`${s.id} resolves.story="${s.resolves.story}": no story with that id exists in the archive`);
      } else if (!askingIds.has(s.resolves.story)) {
        problems.push(`${s.id} resolves.story="${s.resolves.story}": that story exists but never declared an openQuestion`);
      }
    }
  }
  return problems;
}

/**
 * Builds the weekly review document. Returns null when there is nothing to review (no
 * eligible edition on or before `asOf`) — the caller's floor, matching rule 5 applied to a
 * week rather than a day: skip rather than pad.
 *
 * Assumes checkReferentialIntegrity(editions) has already been checked by the caller —
 * this function does not re-check it, so it can be unit-tested against a deliberately
 * dangling fixture without that fixture being rejected before the interesting assertion.
 */
export function buildWeeklyDoc(editions, asOf, { trigger, runId } = {}) {
  const window = computeWindow(editions, asOf);
  if (!window) return null;
  const { from, to, inWindow, editionDates } = window;
  const inWindowSet = (date) => date >= from && date <= to;

  const threadMap = collectThreads(editions); // oldest-first items, label from newest instalment
  const threads = [...threadMap.values()].map((t) => ({
    id: t.id,
    label: t.label,
    instalmentsTotal: t.items.length,
    openedAt: t.items[0].ed.edition.date,
    instalmentsThisWeek: t.items
      .filter(({ ed }) => inWindowSet(ed.edition.date))
      .map(({ ed, story }) => ({ story: story.id, editionDate: ed.edition.date, prominence: story.prominence })),
  }));

  const allQuestions = collectOpenQuestions(editions); // oldest-first, each carries .answer or null

  const askedThisWeek = allQuestions
    .filter((q) => inWindowSet(q.ed.edition.date))
    .map((q) => ({ story: q.story.id, question: q.question, editionDate: q.ed.edition.date }));

  const answeredThisWeek = allQuestions
    .filter((q) => q.answer && inWindowSet(q.answer.ed.edition.date))
    .map((q) => ({
      story: q.story.id,
      question: q.question,
      askedAt: q.ed.edition.date,
      answerStory: q.answer.story.id,
      answeredAt: q.answer.ed.edition.date,
      outcome: q.answer.story.resolves.outcome,
      afterDays: daysBetween(q.ed.edition.date, q.answer.ed.edition.date),
    }));

  // daysOpen is measured against `to` — this window's own latest-as-of date, never the
  // archive's absolute latest edition — so a backfilled weekly never leaks knowledge from
  // editions that published after the date it is reviewing. Matches build.mjs's
  // renderOpenQuestions, which reads "today" as an edition date, never the wall clock.
  const stillOpen = allQuestions
    .filter((q) => !q.answer)
    .map((q) => ({
      story: q.story.id,
      question: q.question,
      askedAt: q.ed.edition.date,
      daysOpen: daysBetween(q.ed.edition.date, to),
    }));

  const corrections = collectCorrections(editions) // newest-first by .at
    .filter((c) => inWindowSet(String(c.at).slice(0, 10)))
    .map((c) => ({ story: c.story.id, editionDate: c.ed.edition.date, at: c.at, what: c.what }));

  return {
    $schema: '../../schema/weekly.schema.json',
    week: {
      date: asOf,
      from,
      to,
      editionDates,
      stats: {
        editionCount: inWindow.length,
        storyCount: inWindow.reduce((n, ed) => n + ed.stories.length, 0),
        beatCount: new Set(inWindow.flatMap((ed) => ed.stories.map((s) => s.beat))).size,
      },
      generatedAt: new Date().toISOString(),
      ...(trigger || runId ? { generator: { pipeline: 'weekly-review', ...(runId ? { runId } : {}), ...(trigger ? { trigger } : {}) } } : {}),
    },
    threads,
    openQuestions: { askedThisWeek, answeredThisWeek, stillOpen },
    corrections,
  };
}
