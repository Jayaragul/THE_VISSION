#!/usr/bin/env node
// reserve runs and is committed BEFORE generate. Interrupted attempts consume their
// weekly allowance deliberately; there is no retry that can quietly spend twice.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, isoDate } from './lib/util.mjs';
import { atomicWrite } from './lib/harvest-safety.mjs';
import { LIMITS, weekStart, briefingPacket, requestBody, validateBriefing } from './lib/briefing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const date = process.env.BRIEFING_DATE || isoDate();
const week = weekStart(date);
const path = join(root, 'generated', 'ai-usage', `${week}.json`);
const save = doc => { mkdirSync(dirname(path), { recursive: true }); atomicWrite(path, JSON.stringify(doc, null, 2) + '\n'); };
const mode = process.argv[2];
if (mode === '--reserve') {
  if (existsSync(path) || !process.env.GEMINI_API_KEY) {
    console.log('false');
  } else {
    const dir = join(root, 'generated', 'digest');
    const digests = existsSync(dir) ? readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) <= date).sort().reverse().slice(0, 7).map(f => readJSON(join(dir, f))) : [];
    const packet = briefingPacket(digests, date);
    if (!packet.length) console.log('false');
    else {
      requestBody(packet);
      save({ week, date, status: 'reserved', limits: LIMITS, packet,
        runId: process.env.GITHUB_RUN_ID || null, reservedAt: new Date().toISOString() });
      console.log('true');
    }
  }
} else if (mode === '--generate') {
  const usage = readJSON(path);
  if (usage.status !== 'reserved' || usage.runId !== (process.env.GITHUB_RUN_ID || null)) throw new Error('No reservation for this run');
  usage.status = 'requested';
  save(usage);
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error('Missing API key');
    const model = 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(LIMITS.timeoutMs),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(requestBody(usage.packet)),
    });
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Provider returned HTTP ${res.status}`); }
    const chunks = []; let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.byteLength;
      if (bytes > 128 * 1024) throw new Error('Provider response too large');
      chunks.push(Buffer.from(chunk));
    }
    const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    usage.tokens = response.usageMetadata || null;
    const candidate = response.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('Provider did not finish a complete response');
    const text = (candidate.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    const items = validateBriefing(JSON.parse(text), usage.packet);
    const out = join(root, 'generated', 'briefings', `${week}.json`);
    mkdirSync(dirname(out), { recursive: true });
    atomicWrite(out, JSON.stringify({ week, generatedAt: new Date().toISOString(), model,
      disclosure: 'AI-assisted headline summaries. Not independently fact-checked; read the linked publishers.', items }, null, 2) + '\n');
    usage.status = 'published';
    save(usage);
  } catch (err) {
    usage.status = 'failed';
    // Do not log provider bodies or credentials.
    usage.error = err.message;
    save(usage);
    console.error('Weekly briefing unavailable; daily headlines continue.');
    process.exitCode = 1;
  }
} else throw new Error('Use --reserve or --generate');
