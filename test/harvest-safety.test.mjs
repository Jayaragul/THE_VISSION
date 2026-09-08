import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { validDate, fetchText, atomicWrite, saveCandidates } from '../tools/lib/harvest-safety.mjs';

test('calendar dates handle leap years and reject rollover and path input', () => {
  for (const date of ['2028-02-29', '2036-02-29', '2036-12-31']) assert.ok(validDate(date));
  for (const date of ['2026-02-29', '2100-02-29', '2026-04-31', '../x', '2026-13-01']) assert.equal(validDate(date), false);
});

test('transient failures retry; permanent errors do not', async () => {
  let calls = 0;
  const body = await fetchText('https://example.test', { fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 503 }) : new Response('recovered');
  } });
  assert.equal(body, 'recovered');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchText('https://example.test', { fetchImpl: async () => {
    calls++;
    return new Response('', { status: 404 });
  } }), /HTTP 404/);
  assert.equal(calls, 1);
});

test('retry budget is finite during a network outage', async () => {
  let calls = 0;
  await assert.rejects(fetchText('https://example.test', { fetchImpl: async () => {
    calls++;
    throw new Error('offline');
  } }), /offline/);
  assert.equal(calls, 2);
});

test('oversized bodies fail without retrying even without Content-Length', async () => {
  let calls = 0;
  await assert.rejects(fetchText('https://example.test', { maxBytes: 3, fetchImpl: async () => {
    calls++;
    return new Response('four');
  } }), /exceeds 3 bytes/);
  assert.equal(calls, 1);
});

test('timeout aborts a real response stalled after headers', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.write('unfinished');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(fetchText(`http://127.0.0.1:${server.address().port}`, {
      timeoutMs: 100, attempts: 1,
    }), /abort/i);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('empty harvest keeps last good content and timestamp; successful writes replace cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vission-harvest-'));
  const path = join(dir, 'candidates.json');
  try {
    assert.equal(saveCandidates(path, { items: [] }), false);
    assert.deepEqual(readdirSync(dir), []);
    const previous = { harvestedAt: '2026-09-08T00:00:00Z', items: [{ title: 'AI news' }] };
    assert.equal(saveCandidates(path, previous), true);
    const bytes = readFileSync(path, 'utf8');
    assert.equal(saveCandidates(path, { harvestedAt: '2026-09-09T00:00:00Z', items: [] }), false);
    assert.equal(readFileSync(path, 'utf8'), bytes);
    atomicWrite(path, '{"updated":true}\n');
    assert.deepEqual(JSON.parse(readFileSync(path)), { updated: true });
    assert.deepEqual(readdirSync(dir), ['candidates.json']);
    assert.throws(() => atomicWrite(dir, 'cannot replace directory'));
    assert.deepEqual(readdirSync(dir), ['candidates.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Run the real CLI in an isolated tree; published files in the checkout stay untouched.
test('digest reruns are byte-identical and preserve collection time', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'vission-digest-'));
  try {
    for (const folder of ['tools', 'input', 'schema']) cpSync(join(root, folder), join(dir, folder), { recursive: true });
    mkdirSync(join(dir, 'generated', 'candidates'), { recursive: true });
    const date = '2036-02-29';
    const candidates = { harvestedAt: `${date}T06:00:00Z`, items: [{
      title: 'Google releases new Gemini AI model with open weights',
      url: 'https://blog.google/technology/ai/gemini-test',
      publishedAt: `${date}T05:00:00Z`, source: 'Google', discoveryOnly: false,
    }] };
    saveCandidates(join(dir, 'generated', 'candidates', `${date}.json`), candidates);
    const run = () => spawnSync(process.execPath, [join(dir, 'tools', 'digest.mjs'), date], { encoding: 'utf8', timeout: 15000 });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const path = join(dir, 'generated', 'digest', `${date}.json`);
    const bytes = readFileSync(path, 'utf8');
    assert.equal(JSON.parse(bytes).edition.generatedAt, candidates.harvestedAt);
    assert.ok(JSON.parse(bytes).items.length > 0);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(path, 'utf8'), bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
