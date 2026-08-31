// Tests for the weekly review's pure logic (tools/lib/weekly.mjs).
//
// The load-bearing case here is the window arithmetic itself: every design proposed for
// this feature computed it slightly wrong in its own worked example (from = latest minus 6
// days, but two independent worked examples silently dropped an eligible edition). The
// first test below is that exact regression, run against the real archive's own dates.
//
// The second load-bearing case is the standing ledger: a thread whose only instalment falls
// outside this week's window must still appear in the full thread list, just with an empty
// instalmentsThisWeek — that is what lets a quiet week show a scoreboard instead of an
// empty page. And corrections window on their OWN timestamp, never on the story's edition
// date, because this archive already has a correction landing several editions after the
// story it corrects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindow, checkReferentialIntegrity, buildWeeklyDoc } from '../tools/lib/weekly.mjs';

const ed = (date, stories) => ({ edition: { date }, stories });
const story = (id, extra = {}) => ({ id, headline: `Headline ${id}`, beat: 'models', prominence: 'standard', entities: [], ...extra });

// Mirrors the real archive's gap-riddled dates as of 2026-08-28 (17,18,19,20,21,22,26,28) —
// deliberately not a clean weekly cadence.
const archive = [
  ed('2026-08-17', [story('a1')]),
  ed('2026-08-18', [story('a2', { thread: { id: 'grok-4-6', label: 'Grok 4.6, launch' } })]),
  ed('2026-08-19', [story('a3')]),
  ed('2026-08-20', [
    story('a4', { thread: { id: 'grok-4-6', label: 'Grok 4.6, bedrock' } }),
    story('a5', { corrections: [{ at: '2026-08-28T15:10:00Z', what: 'A link was fixed after the original ran.' }] }),
  ]),
  ed('2026-08-21', [story('a6', { thread: { id: 'grok-4-6', label: 'Grok 4.6, leak' } })]),
  ed('2026-08-22', [story('a7')]),
  ed('2026-08-26', [story('a8')]),
  ed('2026-08-28', [
    story('a9', {
      thread: { id: 'anthropic-pentagon', label: 'Anthropic versus the Pentagon' },
      openQuestion: 'Does the appeal overturn the ruling, and how does the parallel case land?',
    }),
    story('a10', {
      thread: { id: 'nvidia-hugging-face', label: "Nvidia's bid for Hugging Face" },
      openQuestion: 'Does the reported acquisition reach a signed agreement, or fall apart?',
    }),
  ]),
];

test('window arithmetic: from = latest eligible edition minus 6 days, matching build.mjs topicOfTheWeek exactly', () => {
  const w = computeWindow(archive, '2026-08-31');
  assert.equal(w.to, '2026-08-28');
  assert.equal(w.from, '2026-08-22'); // NOT 2026-08-25 — the mistake every proposed design's own worked example made
  assert.deepEqual(w.editionDates, ['2026-08-22', '2026-08-26', '2026-08-28']);
});

test('computeWindow returns null when nothing is eligible on or before the given date', () => {
  assert.equal(computeWindow(archive, '2026-08-01'), null);
  assert.equal(computeWindow([], '2026-08-31'), null);
});

test('backfilling a past date only sees editions on or before it, never the future', () => {
  const w = computeWindow(archive, '2026-08-19');
  assert.equal(w.to, '2026-08-19');
  assert.equal(w.from, '2026-08-13');
  assert.deepEqual(w.editionDates, ['2026-08-17', '2026-08-18', '2026-08-19']);
});

test('a thread whose only instalment falls outside the window still appears, with an empty instalmentsThisWeek', () => {
  const doc = buildWeeklyDoc(archive, '2026-08-31');
  const grok = doc.threads.find((t) => t.id === 'grok-4-6');
  assert.ok(grok, 'grok-4-6 must be in the standing thread list');
  assert.equal(grok.instalmentsTotal, 3);
  assert.deepEqual(grok.instalmentsThisWeek, []);
  // And a thread whose instalment IS inside the window shows it.
  const pentagon = doc.threads.find((t) => t.id === 'anthropic-pentagon');
  assert.equal(pentagon.instalmentsThisWeek.length, 1);
  assert.equal(pentagon.instalmentsThisWeek[0].story, 'a9');
});

test('a correction windows on its own `at` timestamp, not the edition date of the story it corrects', () => {
  const doc = buildWeeklyDoc(archive, '2026-08-31');
  // The story ran on 08-20, well before the 08-22..08-28 window, but its correction is
  // dated 08-28T15:10 — inside the window — and must appear.
  assert.equal(doc.corrections.length, 1);
  assert.equal(doc.corrections[0].story, 'a5');
  assert.equal(doc.corrections[0].editionDate, '2026-08-20');
});

test('open questions: asked this week, still open, and daysOpen measured against the window\'s own `to`', () => {
  const doc = buildWeeklyDoc(archive, '2026-08-31');
  assert.equal(doc.openQuestions.askedThisWeek.length, 2);
  assert.equal(doc.openQuestions.answeredThisWeek.length, 0);
  assert.equal(doc.openQuestions.stillOpen.length, 2);
  // Asked on 08-28, window `to` is 08-28 — zero days open, not "3 days" as of some later
  // wall-clock run date. This must never depend on when the script actually ran.
  assert.deepEqual(doc.openQuestions.stillOpen.map((q) => q.daysOpen), [0, 0]);
});

test('an answered question reports afterDays and is windowed on the ANSWER\'s edition date', () => {
  const withAnswer = [
    ...archive,
    ed('2026-08-27', [story('b1', { openQuestion: 'Will the deal close?' })]),
    ed('2026-08-28', [
      ...archive[archive.length - 1].stories,
      story('b2', { resolves: { story: 'b1', outcome: 'It closed, for less than first reported.' } }),
    ]),
  ];
  const doc = buildWeeklyDoc(withAnswer, '2026-08-31');
  assert.equal(doc.openQuestions.answeredThisWeek.length, 1);
  const a = doc.openQuestions.answeredThisWeek[0];
  assert.equal(a.story, 'b1');
  assert.equal(a.answerStory, 'b2');
  assert.equal(a.afterDays, 1);
  assert.equal(a.outcome, 'It closed, for less than first reported.');
  // Answered means it must NOT also appear in stillOpen.
  assert.equal(doc.openQuestions.stillOpen.some((q) => q.story === 'b1'), false);
});

test('checkReferentialIntegrity is clean on the real fixture (no dangling resolves)', () => {
  assert.deepEqual(checkReferentialIntegrity(archive), []);
});

test('checkReferentialIntegrity catches a resolves.story pointing at a nonexistent id', () => {
  const broken = [...archive, ed('2026-08-29', [story('c1', { resolves: { story: 'does-not-exist', outcome: '...' } })])];
  const problems = checkReferentialIntegrity(broken);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does-not-exist/);
  assert.match(problems[0], /no story with that id exists/);
});

test('checkReferentialIntegrity catches a resolves.story pointing at a real story that never asked a question', () => {
  const broken = [...archive, ed('2026-08-29', [story('c2', { resolves: { story: 'a1', outcome: '...' } })])];
  const problems = checkReferentialIntegrity(broken);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /a1/);
  assert.match(problems[0], /never declared an openQuestion/);
});

test('a week with zero threads, questions or corrections still produces a valid, sparse document', () => {
  const quiet = [ed('2026-08-25', [story('q1')]), ed('2026-08-28', [story('q2')])];
  const doc = buildWeeklyDoc(quiet, '2026-08-31');
  assert.deepEqual(doc.threads, []);
  assert.deepEqual(doc.openQuestions, { askedThisWeek: [], answeredThisWeek: [], stillOpen: [] });
  assert.deepEqual(doc.corrections, []);
  assert.equal(doc.week.stats.editionCount, 2);
});

test('buildWeeklyDoc returns null, not a throw, when nothing is eligible', () => {
  assert.equal(buildWeeklyDoc(archive, '2020-01-01'), null);
});

test('generator metadata is present only when a trigger or runId is actually given', () => {
  const withoutMeta = buildWeeklyDoc(archive, '2026-08-31');
  assert.equal('generator' in withoutMeta.week, false);
  const withMeta = buildWeeklyDoc(archive, '2026-08-31', { trigger: 'schedule', runId: '12345' });
  assert.deepEqual(withMeta.week.generator, { pipeline: 'weekly-review', runId: '12345', trigger: 'schedule' });
});
