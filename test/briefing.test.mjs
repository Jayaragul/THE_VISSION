import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LIMITS, weekStart, briefingPacket, requestBody, validateBriefing } from '../tools/lib/briefing.mjs';

const item = (id = 'a') => ({ id, title: 'Google announces an AI model', score: 0.5, beat: 'models', publishedAt: '2036-02-27T05:00:00Z', sources: [{ publisher: 'Google', url: `https://example.test/${id}` }] });
test('weekly allowance uses Monday UTC across year and leap-day boundaries', () => {
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(weekStart('2027-01-03'), '2026-12-28');
  assert.equal(weekStart('2027-01-04'), '2027-01-04');
  assert.equal(weekStart('2036-02-29'), '2036-02-25');
  assert.throws(() => weekStart('2100-02-29'));
});
test('packet selection excludes future/stale input, deduplicates URLs and caps stories', () => {
  const input = [item('b'), item('a'), item('c'), item('d'), item('a'),
    { ...item('old'), publishedAt: '2036-01-01' }, { ...item('future'), publishedAt: '2036-03-01' }];
  const packet = briefingPacket([{ items: input }], '2036-02-29');
  assert.equal(packet.length, LIMITS.stories);
  assert.deepEqual(packet, briefingPacket([{ items: [...input].reverse() }], '2036-02-29'));
  assert.deepEqual(packet.map(p => p.sources[0].url), ['https://example.test/a', 'https://example.test/b', 'https://example.test/c']);
});
test('request has bounded output and input, no tool access, and disabled thinking', () => {
  const packet = briefingPacket([{ items: [item()] }], '2036-02-29');
  const body = requestBody(packet);
  assert.equal(body.generationConfig.maxOutputTokens, 1400);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(body.tools, undefined);
  assert.throws(() => requestBody([{ text: 'x'.repeat(20000) }]), /budget/);
});
test('model cannot supply links, invented ids, duplicate entries or oversized summaries', () => {
  const packet = briefingPacket([{ items: [item()] }], '2036-02-29');
  const good = { items: [{ id: 'item-1', summary: 'Google reports a new AI model.' }] };
  assert.equal(validateBriefing(good, packet)[0].sources[0].url, 'https://example.test/a');
  for (const value of [{ items: [] }, { items: [{ id: 'unknown', summary: 'x' }] },
    { items: [{ id: 'item-1', summary: 'https://invented.test' }] },
    { items: [{ id: 'item-1', summary: '<script>x</script>' }] },
    { items: [{ id: 'item-1', summary: 'x'.repeat(401) }] }]) assert.throws(() => validateBriefing(value, packet));
});

test('persisted reservation prevents repeat requests after a provider failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vission-weekly-'));
  try {
    cpSync(fileURLToPath(new URL('../tools', import.meta.url)), join(dir, 'tools'), { recursive: true });
    mkdirSync(join(dir, 'generated', 'digest'), { recursive: true });
    writeFileSync(join(dir, 'generated', 'digest', '2036-02-29.json'), JSON.stringify({ items: [item()] }));
    const stub = join(dir, 'provider.mjs');
    writeFileSync(stub, `import { appendFileSync } from 'node:fs';
      globalThis.fetch = async () => { appendFileSync(process.env.CALLS_FILE, 'call\\n'); return new Response('', { status: 503 }); };`);
    const env = { ...process.env, BRIEFING_DATE: '2036-02-29', GEMINI_API_KEY: 'test-only', GITHUB_RUN_ID: 'test-run', CALLS_FILE: join(dir, 'calls') };
    const run = (mode, extra = {}) => spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, join(dir, 'tools', 'weekly-briefing.mjs'), mode], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 });
    assert.equal(run('--reserve', { GEMINI_API_KEY: '' }).stdout.trim(), 'false');
    assert.equal(run('--reserve').stdout.trim(), 'true');
    assert.equal(run('--reserve').stdout.trim(), 'false');
    assert.equal(run('--generate').status, 1);
    assert.equal(run('--reserve', { GITHUB_RUN_ID: 'another-run' }).stdout.trim(), 'false');
    assert.equal(run('--generate').status, 1);
    assert.equal(readFileSync(join(dir, 'calls'), 'utf8'), 'call\n');
    const usage = JSON.parse(readFileSync(join(dir, 'generated', 'ai-usage', '2036-02-25.json')));
    assert.equal(usage.status, 'failed');
    writeFileSync(stub, `globalThis.fetch = async (url, opts) => {
      const packet = JSON.parse(JSON.parse(opts.body).contents[0].parts[0].text);
      return Response.json({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ items: packet.map(p => ({ id: p.id, summary: 'Google reports a new AI model.' })) }) }] } }] });
    };`);
    const nextWeek = { BRIEFING_DATE: '2036-03-03', GITHUB_RUN_ID: 'next-week' };
    assert.equal(run('--reserve', nextWeek).stdout.trim(), 'true');
    const success = run('--generate', nextWeek);
    assert.equal(success.status, 0, success.stderr);
    const published = JSON.parse(readFileSync(join(dir, 'generated', 'briefings', '2036-03-03.json')));
    assert.equal(published.items[0].sources[0].url, 'https://example.test/a');
    assert.match(published.disclosure, /Not independently fact-checked/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'generated', 'ai-usage', '2036-03-03.json'))).tokens.candidatesTokenCount, 40);

  } finally { rmSync(dir, { recursive: true, force: true }); }
});
