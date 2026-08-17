import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHTML, safeJsonLd, editionHash, hostOf, matchPublisher, slugify,
  hash32, rng, formatMasthead, formatShort, readMinutes, monogram,
} from '../tools/lib/util.mjs';

test('escapeHTML neutralises all five special characters', () => {
  assert.equal(escapeHTML(`<a href="x">O'Brien & Co</a>`), '&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Co&lt;/a&gt;');
});

test('escapeHTML treats null/undefined as empty string, not "null"', () => {
  assert.equal(escapeHTML(null), '');
  assert.equal(escapeHTML(undefined), '');
});

test('safeJsonLd cannot contain a literal </script> even with an adversarial payload', () => {
  const out = safeJsonLd({ headline: 'X says "</script><script>alert(1)</script>"' });
  assert.equal(out.includes('</script>'), false);
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('>'), false);
  // Must still be valid, round-trippable JSON once unescaped by any JSON parser — <
  // is a standard JSON escape, not a custom encoding a JSON-LD consumer wouldn't understand.
  const parsed = JSON.parse(out);
  assert.match(parsed.headline, /<\/script><script>alert\(1\)<\/script>/);
});

test('editionHash changes when story content changes, stable when it does not', () => {
  const a = { stories: [{ id: 'x', headline: 'A' }] };
  const b = { stories: [{ id: 'x', headline: 'A' }] };
  const c = { stories: [{ id: 'x', headline: 'B' }] };
  assert.equal(editionHash(a), editionHash(b));
  assert.notEqual(editionHash(a), editionHash(c));
  assert.equal(editionHash(a).length, 64); // sha256 hex
});

test('hostOf strips scheme and path, matchPublisher matches root and subdomains only', () => {
  assert.equal(hostOf('https://blogs.nvidia.com/blog/x?y=1'), 'blogs.nvidia.com');
  assert.equal(hostOf('not a url'), '');

  const book = [{ host: 'nvidia.com', name: 'NVIDIA', tier: 1 }];
  assert.equal(matchPublisher('nvidia.com', book).name, 'NVIDIA');
  assert.equal(matchPublisher('blogs.nvidia.com', book).name, 'NVIDIA');
  assert.equal(matchPublisher('notnvidia.com', book), null); // must not match by suffix alone
  assert.equal(matchPublisher('evilnvidia.com', book), null);
});

test('slugify produces a permalink-safe, lowercase, hyphenated slug', () => {
  assert.equal(slugify('Gemini 3.7 Flash!'), 'gemini-3-7-flash');
  assert.equal(slugify('  Multiple   Spaces  '), 'multiple-spaces');
  assert.equal(slugify('Café Über'), 'cafe-uber');
});

test('rng(seed) is deterministic: same seed always produces the same sequence', () => {
  const a = rng('story-2026-08-17-example');
  const b = rng('story-2026-08-17-example');
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  // And every draw is a valid probability in [0, 1).
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1);
  }
});

test('hash32 is deterministic and spreads adjacent inputs (the bug this caught once)', () => {
  assert.equal(hash32('plate-family-4'), hash32('plate-family-4'));
  // Adjacent integer suffixes must not collide onto the same bucket in lockstep — this is
  // exactly the failure mode that made one cover-art style never appear across all 100
  // plates before family selection was switched from an RNG's first draw to this.
  const buckets = new Set();
  for (let i = 0; i < 100; i++) buckets.add(hash32(`plate-family-${i}`) % 18);
  assert.ok(buckets.size >= 10, `expected broad spread across 18 buckets, got ${buckets.size}`);
});

test('formatMasthead and formatShort are locale-independent (no Intl, no host timezone)', () => {
  assert.equal(formatMasthead('2026-08-17'), 'Monday, 17 August 2026');
  assert.equal(formatShort('2026-08-17'), '17 Aug 2026');
});

test('readMinutes scales with content length and never returns less than 1', () => {
  const short = readMinutes({ deck: 'One short sentence.', summary: [], body: [] });
  const long = readMinutes({
    deck: 'A deck.',
    summary: ['A bullet point that is reasonably long and detailed.'],
    body: Array(6).fill('A body paragraph. '.repeat(40)),
  });
  assert.equal(short, 1);
  assert.ok(long > short);
});

test('monogram picks two letters sensibly from one or many words', () => {
  assert.equal(monogram('NVIDIA'), 'NV');
  assert.equal(monogram('The Verge'), 'TV');
  assert.equal(monogram('OpenAI'), 'OP');
});
