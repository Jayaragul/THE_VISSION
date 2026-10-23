import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFresh, newsworthy, reviewedLeads, publisherGroup, parseAnthropicNews } from '../tools/lib/news-quality.mjs';
import { publisherDiversity } from '../tools/lib/cluster.mjs';
const now = Date.parse('2026-10-23T06:00:00Z');
test('digest admission rejects stale, undated and future headlines', () => {
  assert.equal(isFresh({publishedAt:'2026-10-21T06:00:00Z'},now),true);
  for(const publishedAt of ['2026-10-21T05:59:59Z','2026-10-24T01:00:00Z',null,'bad']) assert.equal(isFresh({publishedAt},now),false);
});
test('shopping, advertorials and model repository names cannot become top news', () => {
  assert.equal(newsworthy({title:'Best Microsoft Surface Laptop (2026): Which Models to Buy and Avoid',url:'https://wired.com/guide'}),false);
  assert.equal(newsworthy({title:'The AI classroom',url:'https://scmp.com/presented/news/education'}),false);
  assert.equal(newsworthy({title:'mistralai/Timestral-209M',url:'https://huggingface.co/model',source:'Hugging Face — trending models'}),false);
  assert.equal(newsworthy({title:'AI agent monitoring research released',url:'https://metr.org/research'}),true);
});
test('a reviewed announcement may use its exact AI-free title but expires', () => {
  const item={title:'Build more responsive apps with the Decisions API',url:'https://openai.com/index/decisions-api/',publishedAt:'2026-10-22T00:00:00Z',reviewedAt:'2026-10-23T05:00:00Z',note:'Source announcement read.',beat:'models'};
  assert.equal(reviewedLeads({items:[item]},now).length,1);
  assert.equal(newsworthy(reviewedLeads({items:[item]},now)[0]),true);
  assert.equal(reviewedLeads({items:[item]},now+3*86400000).length,0);
  assert.throws(()=>reviewedLeads({items:[{}]},now),/missing/);
});
test('same-parent publishers are not independent corroboration', () => {
  const items=[{url:'https://blog.google/post',publisher:'Google'},{url:'https://deepmind.google/post',publisher:'Google DeepMind'}];
  assert.equal(publisherGroup(items[0]),publisherGroup(items[1]));
  assert.equal(publisherDiversity({items}),1);
  assert.equal(publisherDiversity({items:[...items,{url:'https://reuters.com/story',publisher:'Reuters'}]}),2);
});
test('newsroom parser accepts dated rows, deduplicates and never invents a date', () => {
  const row='<div class="Table__details-meta"><div>Oct 22, 2026</div><div>Product</div></div><a class="Table__details-title" href="/news/agent-skills"><h3>Donating Agent Skills</h3></a>';
  const result=parseAnthropicNews(row+row);
  assert.equal(result.length,1);assert.equal(result[0].url,'https://www.anthropic.com/news/agent-skills');
  assert.equal(result[0].datePrecision,'day');assert.equal(result[0].publishedAt,'2026-10-22T00:00:00.000Z');
  assert.deepEqual(parseAnthropicNews('<a href="/news/unpublished">Undated</a>'),[]);
});
