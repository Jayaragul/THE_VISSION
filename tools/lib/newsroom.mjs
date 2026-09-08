import { escapeHTML as e, escapeXML, formatMasthead, formatShort } from './util.mjs';
import * as R from './render.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function rankedHeadlines(digest) {
  return [...(digest?.items || [])].filter(i => i.sources?.[0]?.url && i.title)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || compare(a.id, b.id));
}
const external = (url, title) => `<a href="${e(url)}" rel="noopener" target="_blank">${e(title)}</a>`;
const stamp = (time) => time ? `<time datetime="${e(time)}" data-relative>${e(formatShort(time))}</time>` : 'Time unavailable';
function headline(ctx, item, kind = '') {
  const beat = ctx.beatMap.get(item.beat)?.label || item.beat;
  return `<article class="news-story ${kind}">
<p class="news-kicker">${e(beat)}</p>
<h${kind === 'news-story--lead' ? '1' : '3'}>${external(item.sources[0].url, item.title)}</h${kind === 'news-story--lead' ? '1' : '3'}>
<p class="news-byline">${e(item.sources[0].publisher)} <span>·</span> ${stamp(item.publishedAt)}</p>
${kind === 'news-story--lead' ? `<div class="news-source-note"><span>THE SOURCES</span><p>${item.sources.map(s => external(s.url, s.publisher)).join(' · ')}</p><small>Publisher headline. Read the original reporting for context.</small></div>` : ''}
</article>`;
}

export function renderNewsroom(ctx, digest, edition, briefing) {
  const items = rankedHeadlines(digest);
  const featured = items.slice(0, 3);
  const lead = featured[0];
  const present = new Set(items.map(i => i.beat));
  const date = digest?.edition.date || ctx.harvestedAt?.slice(0, 10) || ctx.latestDate;
  const updated = digest?.edition.generatedAt || ctx.harvestedAt || ctx.generatedAt;
  const datedCtx = { ...ctx, latestDate: date, generatedAt: updated };
  const beatSections = ctx.site.nav.filter(b => present.has(b.id)).map(beat => {
    const rows = items.filter(i => i.beat === beat.id).slice(0, 6);
    return `<section class="news-section" id="${e(beat.id)}"><div class="news-section-head"><h2>${e(beat.label)}</h2><a href="./digest.html#digest-${e(beat.id)}">All ${e(beat.label.toLowerCase())} coverage →</a></div><div class="news-grid">${rows.map(i => headline(ctx, i)).join('')}</div></section>`;
  }).join('');
  const wire = `<aside class="news-wire" id="wire"><div class="news-section-head"><h2>Latest wire</h2><span class="news-dot" aria-hidden="true"></span></div><p class="news-caption">Publisher feeds · collected ${stamp(ctx.harvestedAt)}</p><ol>${(ctx.wireItems || []).slice(0, 8).map(i => `<li><p class="news-byline">${e(i.source)} · ${stamp(i.publishedAt)}</p><h3>${external(i.url, i.title)}</h3></li>`).join('') || '<li>No headlines available. Previous editions remain in the archive.</li>'}</ol><a class="news-text-link" href="./archive.html">Browse the archive →</a></aside>`;
  const archiveStories = edition.stories.filter(i => i.prominence !== 'brief').slice(0, 3);
  const archive = `<section class="news-section"><div class="news-section-head"><h2>From the edition archive</h2><a href="./${R.editionPath(edition.edition.date)}">Edition of ${e(formatShort(edition.edition.date))} →</a></div><div class="news-grid">${archiveStories.map(s => `<article class="news-story"><a href="./${R.storyPath(s)}"><img class="news-cover" src="./${R.coverPath(s)}" width="1200" height="675" loading="lazy" alt="Illustration for ${e(s.headline)}"></a><p class="news-kicker">${e(ctx.beatMap.get(s.beat)?.label || s.beat)} · AI-assisted archive</p><h3><a href="./${R.storyPath(s)}">${e(s.headline)}</a></h3><p class="news-deck">${e(s.deck)}</p></article>`).join('')}</div></section>`;
  const content = `<div class="wrap newsroom">
<div class="news-dateline"><span>${e(formatMasthead(date))}</span><span>Independent sources. Open access.</span></div>
<div class="news-topline"><h2>The latest in AI</h2><div class="news-actions"><a href="./headlines.xml">Follow via RSS</a><button type="button" data-share>Share this newspaper</button><span data-share-status role="status"></span></div></div>
<p class="news-caption">Headlines from publishers, selected by fixed rules. Collection: ${stamp(updated)}. <a href="./methodology.html#digest">How we select news</a></p>
<div class="news-front"><div class="news-main">${lead ? headline(ctx, lead, 'news-story--lead') : '<h1>AI news, at the source</h1><p>No digest is available yet. Read the wire or browse past editions.</p>'}<div class="news-support">${featured.slice(1).map(i => headline(ctx, i)).join('')}</div></div>${wire}</div>
<section class="news-briefing"><div><p class="news-kicker">The weekly briefing</p><h2>A little context.<br>Once a week.</h2></div><div>${briefing ? `<p class="news-caption">Week of ${e(formatShort(briefing.week))} · AI-assisted · ${e(briefing.disclosure)}</p>${briefing.items.map(i => `<article><h3>${external(i.sources[0].url, i.title)}</h3><p>${e(i.summary)}</p></article>`).join('')}` : '<p>Daily headlines are collected without AI. A short, clearly labelled AI briefing is scheduled once a week.</p><p class="news-caption">No weekly briefing has been published yet. Original reporting is always one click away.</p>'}</div></section>
${beatSections}${archive}
<section class="news-follow"><h2>Keep good sources close.</h2><p>Read freely. Share a link. Follow the headlines in your own RSS reader.</p><a href="./headlines.xml">Get the headline feed →</a><a href="./methodology.html">Our publishing standards →</a></section>
</div>`;
  return R.page(datedCtx, { depth: 0, canonical: '', anchorNav: true, presentBeats: present,
    bodyClass: 'newsroom-page', editionDate: date, title: `${ctx.site.name} — AI news, research and policy`,
    description: 'Follow AI news, research, business and policy from linked publishers. Daily headlines selected without AI, with one concise AI-assisted weekly briefing.',
    jsonLd: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${ctx.site.name} — Latest AI news`,
      url: `${ctx.site.baseUrl}/`, dateModified: updated, mainEntity: { '@type': 'ItemList',
        itemListElement: items.slice(0, 20).map((i, n) => ({ '@type': 'ListItem', position: n + 1, name: i.title, url: i.sources[0].url })) } }, content });
}

export function renderHeadlineRSS(site, digest) {
  const items = rankedHeadlines(digest).slice(0, 60);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${escapeXML(site.name)} — Headlines</title><link>${escapeXML(site.baseUrl)}/</link>
<description>Publisher headlines selected by fixed rules. Follow links to the original reporting.</description>
<atom:link href="${escapeXML(site.baseUrl)}/headlines.xml" rel="self" type="application/rss+xml"/>
${digest?.edition.generatedAt ? `<lastBuildDate>${new Date(digest.edition.generatedAt).toUTCString()}</lastBuildDate>` : ''}
${items.map(i => `<item><title>${escapeXML(i.title)}</title><link>${escapeXML(i.sources[0].url)}</link><guid isPermaLink="true">${escapeXML(i.sources[0].url)}</guid><description>${escapeXML('Reported by ' + i.sources.map(s => s.publisher).join(', '))}</description>${Number.isFinite(Date.parse(i.publishedAt)) ? `<pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate>` : ''}</item>`).join('\n')}
</channel></rss>\n`;
}
