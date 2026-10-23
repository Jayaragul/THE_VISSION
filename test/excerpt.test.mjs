import test from 'node:test';
import assert from 'node:assert/strict';
import { publisherExcerpt } from '../tools/lib/excerpt.mjs';

test('selects a complete, relevant publisher sentence without rewriting it', () => {
  const summary = 'Welcome to our daily update. Canva released a new image model for designers, with layout planning before generation.';
  assert.equal(
    publisherExcerpt(summary, 'Canva releases image model with layout planning'),
    'Canva released a new image model for designers, with layout planning before generation.'
  );
});

test('leaves truncated, promotional and markup-only feeds without an excerpt', () => {
  assert.equal(publisherExcerpt('Canva released a new model that will', 'Canva releases a model'), null);
  assert.equal(publisherExcerpt('Subscribe to our newsletter to read more about the release.', 'New release'), null);
  assert.equal(publisherExcerpt('<a href="/story">Read more</a>', 'New release'), null);
});
