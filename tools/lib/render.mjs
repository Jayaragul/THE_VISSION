// HTML templates. Pure string functions — no framework, no client-side rendering,
// no hydration. What the crawler sees is what the reader sees.

import { escapeHTML as e, formatMasthead, formatShort, hostOf, monogram, matchPublisher } from './util.mjs';

/** Path from a page at `depth` directories deep back to a root-relative asset. */
export const rel = (depth, path) => (depth ? '../'.repeat(depth) : './') + path;

export const storyPath = (story) => `story/${story.id}.html`;
export const editionPath = (date) => `edition/${date}.html`;

const FONTS =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap';

// ------------------------------------------------------------------ shell ---

export function page(ctx, opts) {
  const { site } = ctx;
  const d = opts.depth || 0;
  const r = (p) => rel(d, p);
  const canonical = opts.canonical ? `${site.baseUrl}/${opts.canonical}` : `${site.baseUrl}/`;
  const ogImage = opts.ogImage ? `${site.baseUrl}/${opts.ogImage}` : `${site.baseUrl}/assets/img/social-card.svg`;

  return `<!doctype html>
<html lang="${e(site.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(opts.title)}</title>
<meta name="description" content="${e(opts.description)}">
<link rel="canonical" href="${e(canonical)}">
<meta name="generator" content="THE VISSION pipeline">
<meta name="robots" content="index, follow, max-image-preview:large">

<meta property="og:type" content="${opts.ogType || 'website'}">
<meta property="og:site_name" content="${e(site.name)}">
<meta property="og:title" content="${e(opts.title)}">
<meta property="og:description" content="${e(opts.description)}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:image" content="${e(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(opts.title)}">
<meta name="twitter:description" content="${e(opts.description)}">
<meta name="twitter:image" content="${e(ogImage)}">

<link rel="icon" href="${r('assets/img/favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${e(site.name)}" href="${r('rss.xml')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${r('assets/css/site.css')}">
<script>try{var t=localStorage.getItem('tv-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
${opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>` : ''}
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}>
${opts.progress ? '<div class="progress" aria-hidden="true"></div>' : ''}
<a class="skip" href="#main">Skip to content</a>
${topbar(ctx, opts)}
${masthead(ctx, opts)}
${beatnav(ctx, opts)}
<main id="main">
${opts.content}
</main>
${footer(ctx, opts)}
<script src="${r('assets/js/app.js')}" defer></script>
</body>
</html>
`;
}

function topbar(ctx, opts) {
  const d = opts.depth || 0;
  const stamp = opts.editionDate ? formatMasthead(opts.editionDate) : formatMasthead(ctx.latestDate);
  return `<div class="topbar"><div class="wrap topbar__in">
<span class="topbar__date">${e(stamp)}</span>
${opts.editionNumber ? `<span>No. ${opts.editionNumber}</span>` : ''}
<span class="topbar__spacer"></span>
${ctx.generatedAt ? `<span class="live">Updated <time datetime="${e(ctx.generatedAt)}" data-relative>${e(formatShort(ctx.generatedAt))}</time></span>` : ''}
<button class="themetoggle" type="button" data-theme-toggle>Dark</button>
</div></div>`;
}

function masthead(ctx, opts) {
  const d = opts.depth || 0;
  const [first, ...rest] = ctx.site.name.split(' ');
  const mark = rest.length ? `${e(first)} <em>${e(rest.join(' '))}</em>` : `<em>${e(first)}</em>`;
  return `<header class="masthead">
<div class="wrap">
<a class="masthead__title" href="${rel(d, 'index.html')}">${mark}</a>
<div class="masthead__rule" role="presentation"></div>
<div class="masthead__tagline">${e(ctx.site.tagline)}</div>
</div>
</header>`;
}

function beatnav(ctx, opts) {
  const d = opts.depth || 0;
  const home = rel(d, 'index.html');
  const links = ctx.site.nav
    .map((n) => `<a href="${opts.anchorNav ? `#${e(n.id)}` : `${home}#${e(n.id)}`}">${e(n.label)}</a>`)
    .join('');
  return `<nav class="beatnav" aria-label="Sections"><div class="wrap beatnav__in">
${links}
<span class="beatnav__sep"></span>
<a class="is-quiet" href="${rel(d, 'archive.html')}">Archive</a>
<a class="is-quiet" href="${rel(d, 'methodology.html')}">Method</a>
<a class="is-quiet" href="${rel(d, 'rss.xml')}">RSS</a>
</div></nav>`;
}

function footer(ctx, opts) {
  const d = opts.depth || 0;
  const beatLinks = ctx.site.nav
    .map((n) => `<li><a href="${rel(d, 'index.html')}#${e(n.id)}">${e(n.label)}</a></li>`)
    .join('');
  const [first, ...rest] = ctx.site.name.split(' ');
  return `<footer class="footer"><div class="wrap">
<div class="footer__grid">
<div>
<div class="footer__mark">${e(first)} <em>${e(rest.join(' '))}</em></div>
<p>${e(ctx.site.editorNote)}</p>
</div>
<div>
<h4>Sections</h4>
<ul>${beatLinks}</ul>
</div>
<div>
<h4>The paper</h4>
<ul>
<li><a href="${rel(d, 'archive.html')}">Archive</a></li>
<li><a href="${rel(d, 'methodology.html')}">Methodology</a></li>
<li><a href="${rel(d, 'rss.xml')}">RSS feed</a></li>
<li><a href="${rel(d, 'generated/index.json')}">Data (JSON)</a></li>
</ul>
</div>
<div>
<h4>Open</h4>
<ul>
<li><a href="${e(ctx.site.social.repo)}" rel="noopener">Source repository</a></li>
<li><a href="${e(ctx.site.social.repo)}/tree/main/input" rel="noopener">Editorial rules</a></li>
<li><a href="${e(ctx.site.social.repo)}/tree/main/evals" rel="noopener">Evaluations</a></li>
</ul>
</div>
</div>
<div class="footer__base">
<span>© ${e(String(ctx.latestDate).slice(0, 4))} ${e(ctx.site.copyrightHolder || ctx.site.name)}</span>
${ctx.site.founder ? `<span>Founded by ${e(ctx.site.founder)}</span>` : ''}
<span>No advertising. No sponsorship. No position in anything covered.</span>
<span><a href="${e(ctx.site.social.repo)}/blob/main/LICENSE" rel="noopener" style="text-decoration:none">Licence</a> · Content CC BY-NC-ND 4.0</span>
</div>
</div></footer>`;
}

// ----------------------------------------------------------------- pieces ---

export function sourceChips(ctx, sources, limit = 4) {
  const shown = sources.slice(0, limit);
  const extra = sources.length - shown.length;
  const chips = shown
    .map((s) => {
      const host = hostOf(s.url);
      const known = matchPublisher(host, ctx.sourceBook.publishers);
      const tier = s.tier ?? known?.tier ?? 4;
      return `<a class="source${tier === 1 ? ' source--t1' : ''}" href="${e(s.url)}" rel="noopener nofollow" target="_blank" title="${e(s.title)}">
<span class="source__mark" aria-hidden="true">${e(monogram(s.publisher))}</span>
<span>${e(s.publisher)}</span>
<span class="source__tier">T${tier}</span>
</a>`;
    })
    .join('');
  return `<div class="sources">${chips}${extra > 0 ? `<span class="source"><span class="source__tier">+${extra} more</span></span>` : ''}</div>`;
}

export function sourceList(ctx, sources) {
  return `<ol class="sourcelist">${sources
    .map((s) => {
      const host = hostOf(s.url);
      const known = matchPublisher(host, ctx.sourceBook.publishers);
      const tier = s.tier ?? known?.tier ?? 4;
      return `<li>
<span class="source__mark" aria-hidden="true">${e(monogram(s.publisher))}</span>
<span>
<a href="${e(s.url)}" rel="noopener nofollow" target="_blank">${e(s.title)}</a>
<span class="pub">${e(s.publisher)} · Tier ${tier}${s.publishedAt ? ` · ${e(formatShort(s.publishedAt))}` : ''}</span>
</span>
</li>`;
    })
    .join('')}</ol>`;
}

function metaLine(ctx, story, depth) {
  const beat = ctx.beatMap.get(story.beat);
  const parts = [];
  if (beat) parts.push(`<a href="${rel(depth, 'index.html')}#${e(beat.id)}" style="text-decoration:none">${e(beat.label)}</a>`);
  if (story.readMinutes) parts.push(`${story.readMinutes} min read`);
  if (story.publishedAt) parts.push(`<time datetime="${e(story.publishedAt)}" data-relative>${e(formatShort(story.publishedAt))}</time>`);
  if (story.confidence && story.confidence !== 'high') {
    parts.push(`<span class="tag tag--low">${e(story.confidence)} confidence</span>`);
  }
  return `<div class="meta">${parts.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

export function coverPath(story) {
  return `assets/img/covers/${story.id}.svg`;
}

export function leadBlock(ctx, story, depth = 0) {
  return `<article class="lead__story">
<a href="${rel(depth, storyPath(story))}" tabindex="-1" aria-hidden="true">
<img class="lead__cover" src="${rel(depth, coverPath(story))}" alt="" width="1200" height="675" fetchpriority="high">
</a>
<div class="kicker">${e(story.kicker)}</div>
<h2 class="lead__title"><a href="${rel(depth, storyPath(story))}">${e(story.headline)}</a></h2>
<p class="lead__deck">${e(story.deck)}</p>
<ul class="keypoints">${story.summary.map((s) => `<li>${e(s)}</li>`).join('')}</ul>
${metaLine(ctx, story, depth)}
<div style="margin-top:16px">${sourceChips(ctx, story.sources, 3)}</div>
</article>`;
}

export function card(ctx, story, depth = 0) {
  return `<article class="card">
<a href="${rel(depth, storyPath(story))}" tabindex="-1" aria-hidden="true">
<img class="card__cover" src="${rel(depth, coverPath(story))}" alt="" width="1200" height="675" loading="lazy">
</a>
<div class="kicker">${e(story.kicker)}</div>
<h3 class="card__title"><a href="${rel(depth, storyPath(story))}">${e(story.headline)}</a></h3>
<p class="card__deck clamp-3">${e(story.deck)}</p>
<div class="card__meta">${metaLine(ctx, story, depth)}</div>
</article>`;
}

export function row(ctx, story, depth = 0) {
  return `<article class="row">
<a href="${rel(depth, storyPath(story))}" tabindex="-1" aria-hidden="true">
<img class="row__cover" src="${rel(depth, coverPath(story))}" alt="" width="1200" height="675" loading="lazy">
</a>
<div>
<div class="kicker">${e(story.kicker)}</div>
<h3 class="row__title"><a href="${rel(depth, storyPath(story))}">${e(story.headline)}</a></h3>
<p class="row__deck clamp-2">${e(story.deck)}</p>
${metaLine(ctx, story, depth)}
</div>
</article>`;
}

export function briefingBlock(ctx, briefs, depth = 0) {
  if (!briefs.length) return '';
  return `<aside class="briefing" aria-labelledby="briefing-title">
<div class="briefing__head">
<h2 class="briefing__title" id="briefing-title">The Briefing</h2>
<span class="briefing__count">${briefs.length} items</span>
</div>
<ol>
${briefs
    .map(
      (b) => `<li>
<div>
<h3><a href="${rel(depth, storyPath(b))}">${e(b.headline)}</a></h3>
<p>${e(b.deck)}</p>
</div>
</li>`
    )
    .join('')}
</ol>
</aside>`;
}

export function signalsBlock(signals) {
  const items = [
    ['Stories', signals.storyCount],
    ['Sources cited', signals.sourceCount],
    ['Primary sources', signals.primaryCount],
    ['Beats covered', signals.beatCount],
    ['Publishers', signals.publisherCount],
  ];
  return `<div class="signals">${items
    .map(
      ([label, n]) =>
        `<div class="signal"><div class="signal__n">${n}</div><div class="signal__l">${e(label)}</div></div>`
    )
    .join('')}</div>`;
}

export function sectionHead(title, blurb, count, id) {
  return `<div class="section__head"${id ? ` id="${e(id)}"` : ''}>
<h2 class="section__title">${e(title)}</h2>
${blurb ? `<span class="section__blurb">${e(blurb)}</span>` : ''}
${count != null ? `<span class="section__count">${count} ${count === 1 ? 'story' : 'stories'}</span>` : ''}
</div>`;
}
