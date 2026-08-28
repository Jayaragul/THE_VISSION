// Tests for threads, open questions and corrections.
//
// The load-bearing rule here is that a thread is never inferred. An earlier design grouped
// stories by shared entities, and measured against the real archive it was wrong more often
// than right: "Google" spanned five editions without being a story, and "Hugging Face"
// linked a Qwen model release to an Nvidia acquisition bid. Presenting either as "the story
// so far" would assert a connection nobody checked — the exact failure rule 1 forbids. The
// tests below encode that only an explicit thread id groups anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectThreads,
  collectOpenQuestions,
  collectCorrections,
  daysBetween,
} from '../tools/lib/continuity.mjs';

const ed = (date, stories) => ({ edition: { date }, stories });
const story = (id, extra = {}) => ({ id, headline: `Headline ${id}`, entities: [], ...extra });

// Editions arrive newest-first from the build, which is what makes ordering worth testing.
const archive = [
  ed('2026-08-21', [
    story('c', { thread: { id: 'grok', label: 'Grok 4.6, from launch to leak' } }),
    story('spare', { entities: ['Google'] }),
  ]),
  ed('2026-08-20', [story('b', { thread: { id: 'grok', label: 'Grok 4.6' } })]),
  ed('2026-08-18', [
    story('a', { thread: { id: 'grok', label: 'Grok 4.6' } }),
    story('other', { entities: ['Google'] }),
  ]),
];

test('a thread collects only stories that explicitly carry its id, oldest first', () => {
  const threads = collectThreads(archive);
  assert.equal(threads.size, 1);
  const grok = threads.get('grok');
  assert.deepEqual(grok.items.map((i) => i.story.id), ['a', 'b', 'c']);
});

test('shared entities do NOT create a thread — the anti-inference rule', () => {
  // Two stories both tagged "Google" across different editions, neither with a thread id.
  const threads = collectThreads(archive);
  assert.equal(threads.has('google'), false);
  // And the entity-only stories appear in no thread at all.
  const threaded = [...threads.values()].flatMap((t) => t.items.map((i) => i.story.id));
  assert.equal(threaded.includes('other'), false);
  assert.equal(threaded.includes('spare'), false);
});

test('the newest instalment names the thread, so it can be renamed as it grows', () => {
  const grok = collectThreads(archive).get('grok');
  assert.equal(grok.label, 'Grok 4.6, from launch to leak');
});

test('an open question is unanswered until a later story resolves it by id', () => {
  const eds = [
    ed('2026-08-28', [story('q1', { openQuestion: 'Does the deal get signed?' })]),
  ];
  const [q] = collectOpenQuestions(eds);
  assert.equal(q.answer, null);

  const withAnswer = [
    ed('2026-09-04', [story('a1', { resolves: { story: 'q1', outcome: 'It was signed on 3 September.' } })]),
    ...eds,
  ];
  const [resolved] = collectOpenQuestions(withAnswer);
  assert.equal(resolved.answer.story.id, 'a1');
  assert.match(resolved.answer.story.resolves.outcome, /signed/);
});

test('open questions come back oldest first — what is owed longest leads', () => {
  const eds = [
    ed('2026-08-28', [story('new', { openQuestion: 'A newer unresolved thing?' })]),
    ed('2026-08-18', [story('old', { openQuestion: 'An older unresolved thing?' })]),
  ];
  assert.deepEqual(collectOpenQuestions(eds).map((q) => q.story.id), ['old', 'new']);
});

test('a resolution pointing at an unknown story never invents an answer', () => {
  const eds = [
    ed('2026-08-28', [story('a1', { resolves: { story: 'does-not-exist', outcome: 'x' } })]),
    ed('2026-08-18', [story('q1', { openQuestion: 'Still open?' })]),
  ];
  const [q] = collectOpenQuestions(eds);
  assert.equal(q.answer, null);
});

test('corrections flatten across editions, newest first', () => {
  const eds = [
    ed('2026-08-28', [
      story('x', {
        corrections: [
          { at: '2026-08-28T10:00:00Z', what: 'Fixed a quote.' },
          { at: '2026-08-28T15:00:00Z', what: 'Fixed a link.' },
        ],
      }),
    ]),
    ed('2026-08-20', [story('y', { corrections: [{ at: '2026-08-20T09:00:00Z', what: 'Fixed a figure.' }] })]),
  ];
  const out = collectCorrections(eds);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((c) => c.what), ['Fixed a link.', 'Fixed a quote.', 'Fixed a figure.']);
  // Each correction keeps the story it belongs to, so the page can link back to it.
  assert.equal(out[0].story.id, 'x');
});

test('an archive with no continuity metadata produces empty results, not a throw', () => {
  const bare = [ed('2026-08-18', [story('a'), story('b')])];
  assert.equal(collectThreads(bare).size, 0);
  assert.deepEqual(collectOpenQuestions(bare), []);
  assert.deepEqual(collectCorrections(bare), []);
  // And an edition with no stories array at all — a shape the loader can hand us on a
  // partially written file — must not crash the build.
  assert.equal(collectThreads([{ edition: { date: '2026-08-18' } }]).size, 0);
});

test('daysBetween counts whole days in the direction given', () => {
  assert.equal(daysBetween('2026-08-18', '2026-08-28'), 10);
  assert.equal(daysBetween('2026-08-28', '2026-08-28'), 0);
});
