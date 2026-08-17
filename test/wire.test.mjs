import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectWireItems } from '../tools/lib/wire.mjs';

const sourceBook = {
  blocked: [{ host: 'x.com', reason: 'social posts are leads, not sources' }],
};

function candidates(items) {
  return { items };
}

test('drops discoveryOnly items — those are aggregator redirects, never a display source', () => {
  const out = selectWireItems(
    candidates([{ title: 'OpenAI releases GPT model', url: 'https://x.com/y', discoveryOnly: true, publishedAt: '2026-08-17T00:00:00Z' }]),
    { sourceBook }
  );
  assert.equal(out.length, 0);
});

test('drops items on a blocked host even without discoveryOnly set', () => {
  const out = selectWireItems(
    candidates([{ title: 'AI model rumour', url: 'https://x.com/status/1', publishedAt: '2026-08-17T00:00:00Z' }]),
    { sourceBook }
  );
  assert.equal(out.length, 0);
});

test('filters to AI-relevant titles — a general tech story without an AI term is dropped', () => {
  const out = selectWireItems(
    candidates([
      { title: 'Court rules on mortgage fraud case', url: 'https://example.com/a', publishedAt: '2026-08-17T00:00:00Z' },
      { title: 'Google releases new Gemini model', url: 'https://example.com/b', publishedAt: '2026-08-17T00:00:00Z' },
    ]),
    { sourceBook }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Google releases new Gemini model');
});

test('excludes Hugging Face trending-model entries — repo names are leads, not headlines', () => {
  const out = selectWireItems(
    candidates([
      { source: 'Hugging Face — trending models', title: 'Qwen/Qwen3.8-27B', url: 'https://huggingface.co/Qwen/Qwen3.8-27B', publishedAt: '2026-08-17T00:00:00Z' },
    ]),
    { sourceBook }
  );
  assert.equal(out.length, 0);
});

test('deduplicates near-identical headlines across feeds, keeping the first', () => {
  const out = selectWireItems(
    candidates([
      { title: 'Google Releases Gemini 3.7 Flash!', url: 'https://a.com/1', publishedAt: '2026-08-17T02:00:00Z' },
      { title: 'google releases gemini 3.7 flash', url: 'https://b.com/1', publishedAt: '2026-08-17T01:00:00Z' },
    ]),
    { sourceBook }
  );
  assert.equal(out.length, 1);
});

test('sorts newest first and respects the limit', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    title: `AI model update number ${i}`,
    url: `https://example.com/${i}`,
    publishedAt: `2026-08-1${i}T00:00:00Z`,
  }));
  const out = selectWireItems(candidates(items), { sourceBook, limit: 3 });
  assert.equal(out.length, 3);
  assert.equal(out[0].title, 'AI model update number 4');
});

test('empty or missing candidates produces an empty list, not a throw', () => {
  assert.deepEqual(selectWireItems(null, { sourceBook }), []);
  assert.deepEqual(selectWireItems({ items: [] }, { sourceBook }), []);
});
