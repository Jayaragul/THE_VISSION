// HTML templates. Pure string functions — no framework, no client-side rendering,
// no hydration. What the crawler sees is what the reader sees.

import { escapeHTML as e, formatMasthead, formatShort, hostOf, monogram, matchPublisher, safeJsonLd } from './util.mjs';

/** Path from a page at `depth` directories deep back to a root-relative asset. */
export const rel = (depth, path) => (depth ? '../'.repeat(depth) : './') + path;

export const storyPath = (story) => `story/${story.id}.html`;
export const editionPath = (date) => `edition/${date}.html`;

// ------------------------------------------------------------------ shell ---

export function page(ctx, opts) {
  const { site } = ctx;
  const d = opts.depth || 0;
  const r = (p) => rel(d, p);
  const canonical = opts.canonical ? `${site.baseUrl}/${opts.canonical}` : `${site.baseUrl}/`;
  const ogImage = opts.ogImage ? `${site.baseUrl}/${opts.ogImage}` : `${site.baseUrl}/assets/img/social-card.svg`;

  // Signed in the source rather than on the page — a credit for anyone who opens view-source,
  // which on a paper for developers is a fair share of the readership.
  const colophon =
    '\n' +
    [
      `  ${site.name} — ${site.tagline}`,
      site.founder ? `  Built by ${site.founder}${site.community ? ` · ${site.community.name}` : ''}` : '',
      site.social?.repo ? `  ${site.social.repo}` : '',
    ]
      .filter(Boolean)
      .join('\n') +
    '\n\n  Every page here is build output. The source of truth is generated/*.json.\n';

  return `<!doctype html>
<html lang="${e(site.locale)}">
<head>
<meta charset="utf-8">
<!--${colophon}-->
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

<meta name="author" content="${e(site.founder ? `${site.name} Desk — founded by ${site.founder}` : `${site.name} Desk`)}">
<meta name="theme-color" content="#c8102e" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c0b0a" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${r('assets/img/favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${e(site.name)}" href="${r('rss.xml')}">
<link rel="stylesheet" href="${r('assets/css/site.css')}">
<script>try{var t=localStorage.getItem('tv-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
${opts.jsonLd ? `<script type="application/ld+json">${safeJsonLd(opts.jsonLd)}</script>` : ''}
<script type="application/ld+json">${safeJsonLd({
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    name: site.name,
    url: `${site.baseUrl}/`,
    description: site.description,
    slogan: site.tagline,
    foundingDate: site.founded,
    ...(site.founder ? { founder: { '@type': 'Person', name: site.founder } } : {}),
    ...(site.copyrightHolder ? { copyrightHolder: { '@type': 'Person', name: site.copyrightHolder } } : {}),
    logo: `${site.baseUrl}/assets/img/social-card.svg`,
    sameAs: [site.social.repo],
    ethicsPolicy: `${site.baseUrl}/methodology.html`,
    publishingPrinciples: `${site.baseUrl}/methodology.html`,
  })}</script>
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
${ctx.site.editorNote ? `<p class="masthead__note">${e(ctx.site.editorNote)}</p>` : ''}
</div>
</header>`;
}

/**
 * The three tiers, stated plainly and in descending order of how much checking stands behind
 * them. Without this the site's structure is only discoverable by noticing two links in the
 * nav: a first-time reader had no way to learn that the Digest and the Wire exist, let alone
 * that they are held to different standards than the edition they are looking at.
 */
export function tierStrip(ctx, opts = {}) {
  const d = opts.depth || 0;
  const n = (v) => (typeof v === 'number' && v > 0 ? v : null);
  const rows = [
    {
      name: 'The Edition',
      count: n(opts.editionCount),
      unit: 'stories',
      blurb: 'Researched, written and checked against the paper’s own rules before it publishes.',
      href: null,
    },
    {
      name: 'The Digest',
      count: n(opts.digestCount),
      unit: 'items',
      blurb: 'Clustered and ranked by a deterministic program. No model wrote a word of it.',
      href: rel(d, 'digest.html'),
    },
    {
      name: 'The Wire',
      count: n(opts.wireCount),
      unit: 'headlines',
      blurb: 'Straight from publishers’ own feeds, unverified. Leads, not reporting.',
      href: opts.anchorNav ? '#wire' : `${rel(d, 'index.html')}#wire`,
    },
  ];

  return `<section class="tiers" aria-label="What is on this site">
<div class="tiers__grid">
${rows
  .map((r) => {
    const meta = r.count ? `<span class="tiers__count">${r.count} ${e(r.unit)}</span>` : '';
    const head = r.href
      ? `<a class="tiers__name" href="${r.href}">${e(r.name)}</a>`
      : `<span class="tiers__name is-here">${e(r.name)} <span class="tiers__you">you are here</span></span>`;
    return `<div class="tiers__item">${head}${meta}<p class="tiers__blurb">${e(r.blurb)}</p></div>`;
  })
  .join('')}
</div>
</section>`;
}

function beatnav(ctx, opts) {
  const d = opts.depth || 0;
  const home = rel(d, 'index.html');
  // On the front page, only link beats that actually have a section today — an anchor
  // pointing at a heading that was not rendered scrolls the reader nowhere and reads as a
  // broken link. Away from the front page every beat is listed, because the anchor resolves
  // against whatever edition the reader lands on.
  const present = opts.presentBeats;
  const shown = present ? ctx.site.nav.filter((n) => present.has(n.id)) : ctx.site.nav;
  const links = shown
    .map((n) => `<a href="${opts.anchorNav ? `#${e(n.id)}` : `${home}#${e(n.id)}`}">${e(n.label)}</a>`)
    .join('');
  return `<nav class="beatnav" aria-label="Sections"><div class="wrap beatnav__in">
${links}
<span class="beatnav__sep"></span>
<a href="${rel(d, 'search.html')}">Search</a>
<a class="is-quiet" href="${opts.anchorNav ? '#wire' : `${home}#wire`}">Wire</a>
<a class="is-quiet" href="${rel(d, 'digest.html')}">Digest</a>
<a class="is-quiet" href="${rel(d, 'hackathons.html')}">Hackathons</a>
<a class="is-quiet" href="${rel(d, 'topics.html')}">Topics</a>
<a class="is-quiet" href="${rel(d, 'archive.html')}">Archive</a>
<a class="is-quiet" href="${rel(d, 'methodology.html')}">Method</a>
<a class="is-quiet" href="${rel(d, 'rss.xml')}">RSS</a>
</div></nav>`;
}

/** The community mark: inlined when it is an SVG (so currentColor works), linked otherwise. */
function communityMark(ctx, d) {
  const c = ctx.site.community;
  if (!c?.logo) return '';
  if (ctx.communityMark) {
    return `<span class="footer__communitymark" role="img" aria-label="${e(c.name)}">${ctx.communityMark}</span>`;
  }
  const dims = c.logoWidth && c.logoHeight ? ` width="${c.logoWidth}" height="${c.logoHeight}"` : '';
  // Deliberately not loading="lazy". The mark is small and it is brand identity, so a
  // lazy-load heuristic that declines to fire leaves the footer with a blank badge — which is
  // exactly what happened when this shipped lazy. Eager is the right trade for ~26KB.
  return `<span class="footer__communitymark is-raster"><img src="${rel(d, c.logo)}" alt="${e(c.name)}"${dims} decoding="async"></span>`;
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
${ctx.site.community ? `<div class="footer__community">${communityMark(ctx, d)}<span>${e(ctx.site.community.note)}</span></div>` : ''}
</div>
<div>
<h4>Sections</h4>
<ul>${beatLinks}</ul>
</div>
<div>
<h4>The paper</h4>
<ul>
<li><a href="${rel(d, 'digest.html')}">Digest (no AI)</a></li>
<li><a href="${rel(d, 'hackathons.html')}">Hackathons</a></li>
<li><a href="${rel(d, 'topics.html')}">Topics</a></li>
<li><a href="${rel(d, 'archive.html')}">Archive</a></li>
<li><a href="${rel(d, 'methodology.html')}">Methodology</a></li>
<li><a href="${rel(d, 'legal.html')}">Corrections &amp; rights</a></li>
<li><a href="${rel(d, 'terms.html')}">Terms of use</a></li>
<li><a href="${rel(d, 'privacy.html')}">Privacy</a></li>
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
${ctx.site.founder ? `<span>Founded by ${e(ctx.site.founder)}${ctx.site.community ? ` · ${e(ctx.site.community.name)}` : ''}</span>` : ''}
<span>No advertising. No sponsorship. No position in anything covered.</span>
<span><a href="${e(ctx.site.social.repo)}/blob/main/LICENSE" rel="noopener" style="text-decoration:none">Licence</a> · Content CC BY-NC-ND 4.0</span>
</div>
</div></footer>`;
}

// ----------------------------------------------------------------- pieces ---

/** "T1" means nothing to a reader who hasn't opened Methodology. sources.json already
 *  defines the plain-language version of every tier ("Primary", "Newsroom", "Secondary",
 *  "Unvetted") — this just surfaces it instead of inventing new wording. The number stays,
 *  small, for anyone who does know the system; the title attribute carries the fuller note
 *  ("The organisation, filing, paper or dataset itself.") for a hover or long-press. */
export function tierLabel(ctx, tier) {
  return ctx.sourceBook.tiers?.[tier]?.label || `Tier ${tier}`;
}
function tierNote(ctx, tier) {
  return ctx.sourceBook.tiers?.[tier]?.note || '';
}

export function sourceChips(ctx, sources, limit = 4) {
  const shown = sources.slice(0, limit);
  const extra = sources.length - shown.length;
  const chips = shown
    .map((s) => {
      const host = hostOf(s.url);
      const known = matchPublisher(host, ctx.sourceBook.publishers);
      const tier = s.tier ?? known?.tier ?? 4;
      const label = tierLabel(ctx, tier);
      const note = tierNote(ctx, tier);
      return `<a class="source${tier === 1 ? ' source--t1' : ''}" href="${e(s.url)}" rel="noopener nofollow" target="_blank" title="${e(s.title)}${note ? ` — ${e(label)}: ${e(note)}` : ''}">
<span class="source__mark" aria-hidden="true">${e(monogram(s.publisher))}</span>
<span>${e(s.publisher)}</span>
<span class="source__tier">${e(label)}</span>
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
      const label = tierLabel(ctx, tier);
      const note = tierNote(ctx, tier);
      return `<li>
<span class="source__mark" aria-hidden="true">${e(monogram(s.publisher))}</span>
<span>
<a href="${e(s.url)}" rel="noopener nofollow" target="_blank">${e(s.title)}</a>
<span class="pub"><span${note ? ` title="${e(note)}"` : ''}>${e(s.publisher)} · ${e(label)}</span>${s.publishedAt ? ` · ${e(formatShort(s.publishedAt))}` : ''}</span>
</span>
</li>`;
    })
    .join('')}</ol>`;
}

// Plain-language version of schema/edition.schema.json's own confidence definition — "high =
// primary source confirms. medium = credible reporting, no primary. low = single source or
// contested." A reader who has never opened Methodology should not need to look up what
// "medium confidence" means; the tag should say it. Shown for every level, including high —
// omitting the tag on the best case reads as a missing label, not as reassurance, to someone
// who doesn't already know the convention.
const CONFIDENCE_LABEL = {
  high: 'Primary source confirmed',
  medium: 'Credible reporting, no primary',
  low: 'Single source, unconfirmed',
};

function metaLine(ctx, story, depth) {
  const beat = ctx.beatMap.get(story.beat);
  const parts = [];
  if (beat) parts.push(`<a href="${rel(depth, 'index.html')}#${e(beat.id)}" style="text-decoration:none">${e(beat.label)}</a>`);
  if (story.readMinutes) parts.push(`${story.readMinutes} min read`);
  if (story.publishedAt) parts.push(`<time datetime="${e(story.publishedAt)}" data-relative>${e(formatShort(story.publishedAt))}</time>`);
  if (story.confidence) {
    const plain = CONFIDENCE_LABEL[story.confidence] || story.confidence;
    parts.push(
      `<span class="tag${story.confidence === 'high' ? '' : ' tag--low'}" title="${e(story.confidence)} confidence">${e(plain)}</span>`
    );
  }
  return `<div class="meta">${parts.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

export function coverPath(story) {
  return `assets/img/covers/${story.id}.svg`;
}

/** CSS custom property, set once on a story's outer wrapper. `.kicker` and the cover-image
 *  top rule both read it via inheritance, so every card in a beat picks up its colour from
 *  one style attribute rather than being painted piece by piece. */
function beatAccentStyle(ctx, story) {
  const accent = ctx.beatMap.get(story.beat)?.accent;
  return accent ? ` style="--beat-accent:${e(accent)}"` : '';
}

export function leadBlock(ctx, story, depth = 0) {
  return `<article class="lead__story"${beatAccentStyle(ctx, story)}>
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
  return `<article class="card"${beatAccentStyle(ctx, story)}>
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
  return `<article class="row"${beatAccentStyle(ctx, story)}>
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
