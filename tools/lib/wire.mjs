// The wire: a headline feed built from harvested RSS, with no model in the loop.
//
// This is the degraded tier of the paper, and it is the reason the site cannot go dark.
// tools/harvest.mjs needs no API key, no subscription and no model — so if the editorial
// pipeline stops for any reason (expired key, spend cap, outage, an edition that fails the
// gate), the wire keeps updating on its own schedule and the front page keeps showing what
// happened today.
//
// The wire is deliberately NOT journalism and must never be presented as such. Every item
// is an unverified third-party headline shown with its publisher attached. Nothing here is
// written, checked, or endorsed by the paper. The visual treatment and the labelling exist
// to make that distinction impossible to miss.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHTML as e, hostOf, matchPublisher, monogram, isAiRelevant } from './util.mjs';

/** Aggregator redirects are leads, never display sources — drop them from the public wire. */
// arXiv alone posts more often than any single company blog or press outlet, so a flat
// most-recent-N cut let three arXiv categories fill nearly half of every wire refresh and
// crowd out lower-frequency-but-important sources (Amazon, Microsoft, Meta among them —
// see the 18 Aug 2026 coverage review). perSourceCap keeps one prolific feed from dominating
// the page without hiding it: it still appears, just not to the exclusion of everything else.
export function selectWireItems(candidates, { limit = 24, sourceBook, perSourceCap = 5 } = {}) {
  if (!candidates?.items?.length) return [];

  const seenTitles = new Set();
  const filtered = candidates.items
    .filter((item) => {
      if (item.discoveryOnly) return false;
      if (!item.url || !/^https:\/\//i.test(item.url)) return false;
      // Model-repo names are strong research leads but terrible headlines, and the
      // trending list is full of community re-uploads and quantisations.
      if (item.source === 'Hugging Face — trending models') return false;
      if (!isAiRelevant(item.title)) return false;

      const host = hostOf(item.url);
      if (!host) return false;
      if (sourceBook && matchPublisher(host, sourceBook.blocked)) return false;

      // Near-duplicate headlines across feeds add nothing for a reader.
      const key = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60);
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  const perSource = new Map();
  const out = [];
  for (const item of filtered) {
    if (out.length >= limit) break;
    const key = item.source || '';
    const count = perSource.get(key) || 0;
    if (count >= perSourceCap) continue;
    perSource.set(key, count + 1);
    out.push(item);
  }
  return out;
}

export function wireItemsHTML(items, { sourceBook } = {}) {
  return items
    .map((item) => {
      const host = hostOf(item.url);
      const known = sourceBook ? matchPublisher(host, sourceBook.publishers) : null;
      const publisher = known?.name || item.source || host;
      return `<li class="wire__item">
<a class="wire__link" href="${e(item.url)}" rel="noopener nofollow" target="_blank">
<span class="wire__mark" aria-hidden="true">${e(monogram(publisher))}</span>
<span class="wire__body">
<span class="wire__title">${e(item.title)}</span>
<span class="wire__meta">${e(publisher)}${item.publishedAt ? ` · <time datetime="${e(item.publishedAt)}" data-relative>${e(item.publishedAt.slice(0, 10))}</time>` : ''}</span>
</span>
</a>
</li>`;
    })
    .join('');
}

/** The front-page module. Compact, and clearly separated from edited copy. */
export function wireBlock(items, { depth = 0, sourceBook, harvestedAt } = {}) {
  if (!items.length) return '';
  return `<section class="section" id="wire">
<div class="section__head">
<h2 class="section__title">The Wire</h2>
<span class="section__blurb">Unedited headlines, straight from the source feeds</span>
<span class="section__count">${items.length} items</span>
</div>
<p class="wire__warning">
These are raw feed headlines, collected automatically and <strong>not verified, written or
endorsed</strong> by THE VISSION. They are leads, not reporting. Edited stories are everything
above this line.
</p>
${/* Forty headlines is a reasonable desktop column and a very long scroll on a phone, where
      it sits between the reader and the rest of the paper. On narrow screens CSS shows the
      first twelve and this checkbox reveals the rest — a checkbox rather than a script so it
      works with JS disabled, and so nothing here depends on app.js loading. Both the input
      and the label are inert on desktop, where the whole list is shown anyway. */ ''}
<input type="checkbox" id="wire-showall" class="wire__toggleinput">
<ul class="wire">${wireItemsHTML(items, { sourceBook })}</ul>
<label for="wire-showall" class="wire__toggle">Show all ${items.length} headlines</label>
${harvestedAt ? `<p class="wire__stamp">Collected <time datetime="${e(harvestedAt)}" data-relative>${e(harvestedAt.slice(0, 10))}, ${e(harvestedAt.slice(11, 16))} UTC</time> · runs four times a day, no model in the loop</p>` : ''}
</section>`;
}

/** The wire's own archive path, parallel to digestPath() in build.mjs. */
export function wirePath(date) {
  return `wire/${date}.html`;
}

// The wire itself is a live, rolling view with no history of its own — every refresh
// overwrites the last. That is correct for the front page, but it means the archive had
// nothing to point at for "what did the wire show on the 14th". This snapshots whatever the
// current build's wire selection is, keyed to the harvest's own date (never wall-clock, so
// build.mjs stays a pure function of what's already committed under generated/). Called once
// per build; overwrites that day's file, so only the last state of a given day survives —
// same rule digest.mjs already runs on generated/digest/<date>.json.
export function snapshotWire(items, { date, harvestedAt, outDir }) {
  if (!date || !items.length) return;
  mkdirSync(outDir, { recursive: true });
  const doc = {
    date,
    harvestedAt,
    items: items.map((i) => ({
      title: i.title,
      url: i.url,
      source: i.source || null,
      publishedAt: i.publishedAt || null,
    })),
  };
  writeFileSync(join(outDir, `${date}.json`), JSON.stringify(doc, null, 2) + '\n');
}

/** Newest-first, mirroring loadDigests()/loadEditions() in build.mjs. */
export function loadWireHistory(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** Banner shown when the edited edition has gone stale but the wire is still current. */
export function stalenessBanner(hoursSinceEdition, { depth = 0 } = {}) {
  if (hoursSinceEdition < 36) return '';
  const days = Math.floor(hoursSinceEdition / 24);
  return `<div class="staleness">
<strong>No new edition ${days >= 1 ? `in ${days} day${days === 1 ? '' : 's'}` : 'today'}.</strong>
The editorial pipeline has not published since the edition below. The Wire further down the
page updates independently and is still running.
</div>`;
}
