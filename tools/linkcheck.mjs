#!/usr/bin/env node
// Link-rot ledger for every source the paper has ever cited.
//
//   node tools/linkcheck.mjs              # check every published source
//   node tools/linkcheck.mjs --limit 50   # sample, for a quick local run
//   node tools/linkcheck.mjs --quiet      # summary only
//
// Why this exists: the paper's central promise is that every story carries a source you
// can open. That promise decays on its own. Roughly half of cited links rot within a
// decade, so an archive that says nothing about link health quietly stops being true —
// and it stops being true first for the oldest stories, which nobody is re-reading and
// nobody notices. At one edition a day this archive is heading for ~51,000 cited URLs.
//
// The important judgement here is what counts as dead. A 403 is not a dead link: many
// newsrooms block automated fetches while serving human readers normally. Calling those
// dead would slander a live source and make the ledger useless. Only a sustained 404/410
// — gone on several consecutive checks, days apart — is recorded as gone.
//
// This never fails a build and never edits a published story. It writes an observation
// file; the build reads that file and labels sources honestly. Keeping the fetch out of
// the build is deliberate: the build must stay deterministic and offline-reproducible.

import { writeFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = (...p) => join(ROOT, ...p);

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const limitArg = argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(argv[limitArg + 1]) : Infinity;

const LEDGER = OUT('generated', 'link-health.json');
const CONCURRENCY = 6;      // polite: this walks other people's servers
const TIMEOUT_MS = 12000;
const GONE_AFTER = 3;       // consecutive 404/410 observations before a link is called gone

// --------------------------------------------------------------- collect ----

/** Every distinct source URL the paper has published, with the stories citing it. */
function publishedSources() {
  const dir = OUT('generated');
  const byUrl = new Map();
  for (const f of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) {
    const doc = readJSON(join(dir, f));
    for (const story of doc.stories || []) {
      for (const src of story.sources || []) {
        if (!src.url) continue;
        if (!byUrl.has(src.url)) {
          byUrl.set(src.url, { url: src.url, publisher: src.publisher, stories: [] });
        }
        byUrl.get(src.url).stories.push(story.id);
      }
    }
  }
  return [...byUrl.values()];
}

// ----------------------------------------------------------------- probe ----

/** Classify one URL. HEAD first because it is cheaper for the host; some servers reject
 *  HEAD outright, so a 405/501 retries as a ranged GET rather than being recorded as a
 *  fault of the link. */
async function probe(url) {
  const attempt = async (method) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctl.signal,
        headers: {
          // Identify honestly. A publisher who wants to block this should be able to.
          'user-agent': 'THE-VISSION-linkcheck/1.0 (+https://jayaragul.github.io/THE_VISSION/methodology.html)',
          ...(method === 'GET' ? { range: 'bytes=0-2048' } : {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let res = await attempt('HEAD');
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      // Some hosts 403 HEAD specifically but serve GET. Worth one retry before
      // recording anything, since "blocked" and "fine" are easy to confuse here.
      res = await attempt('GET');
    }
    const code = res.status;
    if (code >= 200 && code < 400) return { status: 'ok', code };
    if (code === 404 || code === 410) return { status: 'gone', code };
    if (code === 403 || code === 429 || code === 451) return { status: 'blocked', code };
    return { status: 'error', code };
  } catch (err) {
    // DNS failure, TLS failure, timeout. Transient far more often than terminal, so this
    // is 'error' — it never accumulates toward 'gone'.
    return { status: 'error', code: 0, detail: err.name === 'AbortError' ? 'timeout' : err.code || err.message };
  }
}

async function pool(items, worker, size) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx]);
      }
    })
  );
  return results;
}

// ------------------------------------------------------------------ run ----

const all = publishedSources();
const targets = all.slice(0, LIMIT);
const previous = existsSync(LEDGER) ? readJSON(LEDGER) : { links: {} };
const prior = previous.links || {};

if (!QUIET) {
  console.log(`\n  Checking ${targets.length} of ${all.length} published source URL(s)…\n`);
}

const now = new Date().toISOString();
const checked = await pool(
  targets,
  async (src) => ({ ...src, ...(await probe(src.url)) }),
  CONCURRENCY
);

// The ledger records only links that are NOT healthy, plus a summary. A link that is fine
// needs no row, and a link that recovers drops out on the next run — so the file stays
// small for the life of the paper instead of growing with the archive.
const links = {};
const tally = { ok: 0, blocked: 0, gone: 0, error: 0 };

for (const r of checked) {
  tally[r.status]++;
  if (r.status === 'ok') continue;

  const was = prior[r.url] || {};
  const consecutiveGone = r.status === 'gone' ? (was.consecutiveGone || 0) + 1 : 0;

  links[r.url] = {
    publisher: r.publisher,
    stories: r.stories,
    status: r.status,
    code: r.code,
    ...(r.detail ? { detail: r.detail } : {}),
    consecutiveGone,
    // Only after repeated observation does the paper say a source is gone. One bad
    // afternoon on someone's server is not grounds for annotating a published story.
    confirmedGone: consecutiveGone >= GONE_AFTER,
    firstSeenBad: was.firstSeenBad || now,
    lastChecked: now,
  };
}

// Links not covered by this run (a --limit sample) keep their previous record rather than
// being silently forgotten.
for (const [url, rec] of Object.entries(prior)) {
  if (!links[url] && !checked.some((c) => c.url === url)) links[url] = rec;
}

const confirmedGone = Object.values(links).filter((l) => l.confirmedGone).length;

writeFileSync(
  LEDGER,
  JSON.stringify(
    {
      $comment:
        'Written by tools/linkcheck.mjs. Only unhealthy links are recorded; a healthy link has no row and a recovered link drops out. "blocked" (403/429/451) is NOT a dead link — the publisher blocks automated fetches while serving human readers. Only confirmedGone (404/410 on ' +
        GONE_AFTER +
        ' consecutive checks) is treated as rot by the build.',
      updatedAt: now,
      goneAfter: GONE_AFTER,
      totalPublished: all.length,
      checkedThisRun: targets.length,
      summary: { ...tally, confirmedGone },
      links,
    },
    null,
    2
  ) + '\n'
);

// --------------------------------------------------------------- report ----

const pct = (n) => (targets.length ? ((n / targets.length) * 100).toFixed(1) : '0.0');
console.log(`  ok       ${String(tally.ok).padStart(5)}  (${pct(tally.ok)}%)`);
console.log(`  blocked  ${String(tally.blocked).padStart(5)}  (${pct(tally.blocked)}%)  publisher blocks bots — still readable`);
console.log(`  error    ${String(tally.error).padStart(5)}  (${pct(tally.error)}%)  transient; not counted as rot`);
console.log(`  gone     ${String(tally.gone).padStart(5)}  (${pct(tally.gone)}%)  404/410 this run`);
console.log(`  ─────────────────`);
console.log(`  confirmed rot ${confirmedGone} link(s) — gone on ${GONE_AFTER}+ consecutive checks`);

if (!QUIET && confirmedGone) {
  console.log('\n  Confirmed rot:');
  for (const [url, rec] of Object.entries(links)) {
    if (!rec.confirmedGone) continue;
    console.log(`    ${rec.publisher} — ${url}`);
    console.log(`      cited by: ${rec.stories.join(', ')}`);
  }
  console.log(
    '\n  These stories keep their citation — the archive is a record, not a working draft.\n' +
      '  The build now labels the link as no longer resolving so a reader is not sent to a\n' +
      '  dead page believing the paper never checked.'
  );
}

console.log(`\n  ledger → generated/link-health.json\n`);
