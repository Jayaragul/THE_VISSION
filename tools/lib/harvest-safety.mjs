import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

// The timeout covers headers AND streaming the body. Bound decoded bytes as well:
// Content-Length may be absent, incorrect, or describe compressed data.
export async function fetchText(url, { headers = {}, timeoutMs = 12000,
  maxBytes = 8 * 1024 * 1024, attempts = 2, fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let retryable = true;
    try {
      const res = await fetchImpl(url, { headers, signal: ctrl.signal });
      if (!res.ok) {
        retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const chunks = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body) {
          size += chunk.byteLength;
          if (size > maxBytes) {
            retryable = false;
            ctrl.abort();
            throw new Error(`Response exceeds ${maxBytes} bytes`);
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (err) {
      if (!retryable || attempt + 1 >= attempts) throw err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
}

// Same-directory rename prevents a killed process from leaving half-written JSON.
export function atomicWrite(path, content) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, content, { flag: 'wx' });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function saveCandidates(path, doc) {
  // Keep the last successful collection and its original timestamp during outages.
  if (!doc.items.length) return false;
  atomicWrite(path, JSON.stringify(doc, null, 2) + '\n');
  return true;
}
