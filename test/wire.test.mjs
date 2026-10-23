import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectWireItems, wireItemsHTML } from '../tools/lib/wire.mjs';

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

test('a prolific source cannot fill the whole wire — perSourceCap leaves room for others', () => {
  const prolific = Array.from({ length: 10 }, (_, i) => ({
    source: 'arXiv — cs.AI',
    title: `Novel AI training method number ${i}`,
    url: `https://arxiv.org/${i}`,
    publishedAt: `2026-08-17T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));
  const single = {
    source: 'TechCrunch',
    title: 'Amazon debuts new AI model lineup',
    url: 'https://techcrunch.com/1',
    publishedAt: '2026-08-17T09:00:00Z',
  };
  const out = selectWireItems(candidates([...prolific, single]), { sourceBook, limit: 8, perSourceCap: 5 });
  // Only 11 items exist total; the cap trims arXiv to 5, so 6 survive — the cap must not
  // silently drop the sole non-arXiv item to hit an unreachable limit of 8.
  assert.equal(out.length, 6);
  assert.equal(out.filter((i) => i.source === 'arXiv — cs.AI').length, 5);
  assert.ok(out.some((i) => i.source === 'TechCrunch'), 'the single-item source should still appear');
});
test('the source cap applies across arXiv category feeds', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    source: i % 2 ? 'arXiv — cs.LG' : 'arXiv — cs.AI',
    title: `AI model research number ${i}`,
    url: `https://arxiv.org/abs/2608.${String(i).padStart(5, '0')}`,
    publishedAt: `2026-08-17T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));
  assert.equal(selectWireItems(candidates(items), { sourceBook, perSourceCap: 5 }).length, 5);
});

test('wire labels research and hosted company posts by source type', () => {
  const html = wireItemsHTML([
    { title: 'AI research paper', url: 'https://arxiv.org/abs/2608.00001' },
    { title: 'AI training blog', url: 'https://huggingface.co/blog/microsoft/thinkingbox-training' },
  ]);
  assert.match(html, /Research preprint · not peer-reviewed/);
  assert.match(html, /Microsoft \/ Hugging Face/);
  assert.match(html, /Joint company blog · self-reported/);
});

test('empty or missing candidates produces an empty list, not a throw', () => {
  assert.deepEqual(selectWireItems(null, { sourceBook }), []);
  assert.deepEqual(selectWireItems({ items: [] }, { sourceBook }), []);
});
