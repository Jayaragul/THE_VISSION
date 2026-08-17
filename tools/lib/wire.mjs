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

import { escapeHTML as e, hostOf, matchPublisher, monogram, isAiRelevant } from './util.mjs';

/** Aggregator redirects are leads, never display sources — drop them from the public wire. */
export function selectWireItems(candidates, { limit = 24, sourceBook } = {}) {
  if (!candidates?.items?.length) return [];

  const seenTitles = new Set();
  return candidates.items
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
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, limit);
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
<ul class="wire">${wireItemsHTML(items, { sourceBook })}</ul>
${harvestedAt ? `<p class="wire__stamp">Collected <time datetime="${e(harvestedAt)}" data-relative>${e(harvestedAt.slice(0, 10))}</time> · runs on a schedule with no model in the loop</p>` : ''}
</section>`;
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
