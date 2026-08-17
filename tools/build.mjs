#!/usr/bin/env node
// Renders the site from generated/*.json.
//
//   node tools/build.mjs
//
// This is a pure function of generated/ + input/ + assets/. Delete every .html in
// the repo and run it again: you get byte-identical output. Nothing here reaches
// the network, and no HTML file is ever hand-edited.

import { readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJSON, escapeHTML as e, escapeXML, formatMasthead, formatShort,
  hostOf, matchPublisher, readMinutes,
} from './lib/util.mjs';
import { renderCover } from './lib/cover.mjs';
import * as R from './lib/render.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = (...p) => join(ROOT, ...p);

const site = readJSON(OUT('input', 'site.json'));
const { beats } = readJSON(OUT('input', 'beats.json'));
const sourceBook = readJSON(OUT('input', 'sources.json'));
const beatMap = new Map(beats.map((b) => [b.id, b]));

const write = (relPath, contents) => {
  const full = OUT(...relPath.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
};

// ---------------------------------------------------------------- editions --

function loadEditions() {
  const dir = OUT('generated');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const doc = readJSON(join(dir, f));
      // Derived fields are recomputed here so hand-written values can never drift.
      for (const s of doc.stories) {
        s.readMinutes = readMinutes(s);
        s.sources = s.sources.map((src) => {
          const known = matchPublisher(hostOf(src.url), sourceBook.publishers);
          return { ...src, tier: src.tier ?? known?.tier ?? 4 };
        });
      }
      doc.signals = computeSignals(doc);
      return doc;
    });
}

function computeSignals(doc) {
  const urls = new Set();
  const publishers = new Set();
  let primary = 0;
  for (const s of doc.stories) {
    for (const src of s.sources) {
      urls.add(src.url);
      publishers.add(src.publisher);
      if ((src.tier ?? 4) === 1) primary++;
    }
  }
  return {
    storyCount: doc.stories.length,
    sourceCount: urls.size,
    primaryCount: primary,
    publisherCount: publishers.size,
    beatCount: new Set(doc.stories.map((s) => s.beat)).size,
  };
}

const PROMINENCE_ORDER = { lead: 0, top: 1, standard: 2, brief: 3 };
const byProminence = (a, b) =>
  (PROMINENCE_ORDER[a.prominence] ?? 9) - (PROMINENCE_ORDER[b.prominence] ?? 9);

// ------------------------------------------------------------------ covers --

function writeCovers(editions) {
  let count = 0;
  for (const ed of editions) {
    for (const story of ed.stories) {
      const beat = beatMap.get(story.beat);
      const svg = renderCover({
        seed: story.cover?.seed || story.id,
        accent: beat?.accent || '#c8102e',
        style: story.cover?.style,
      });
      write(R.coverPath(story), svg);
      count++;
    }
  }
  return count;
}

// -------------------------------------------------------------- front page --

function renderEditionPage(ctx, ed, { depth, canonical, isFront, prev, next }) {
  const stories = [...ed.stories];
  const lead = stories.find((s) => s.prominence === 'lead') || stories[0];
  const briefs = stories.filter((s) => s.prominence === 'brief');
  const inBeat = (id) =>
    stories
      .filter((s) => s.beat === id && s !== lead && s.prominence !== 'brief')
      .sort(byProminence);

  const beatSections = site.nav
    .map((nav) => {
      const beat = beatMap.get(nav.id) || nav;
      const list = inBeat(nav.id);
      let inner;
      if (!list.length) {
        inner = `<p class="empty" style="padding:28px 0;text-align:left">No ${e(beat.label.toLowerCase())} stories cleared the bar in this edition.</p>`;
      } else if (list.length <= 2) {
        inner = `<div class="cards">${list.map((s) => R.card(ctx, s, depth)).join('')}</div>`;
      } else {
        const [a, b, c, ...rest] = list;
        inner =
          `<div class="cards">${[a, b, c].map((s) => R.card(ctx, s, depth)).join('')}</div>` +
          (rest.length
            ? `<div class="rows" style="margin-top:30px">${rest.map((s) => R.row(ctx, s, depth)).join('')}</div>`
            : '');
      }
      return `<section class="section" id="${e(nav.id)}">
${R.sectionHead(beat.label, beat.blurb, list.length)}
${inner}
</section>`;
    })
    .join('');

  const editionNav =
    prev || next
      ? `<div class="meta" style="justify-content:space-between;padding:26px 0;border-top:1px solid var(--rule)">
${prev ? `<a href="${R.rel(depth, R.editionPath(prev))}" style="text-decoration:none">← ${e(formatShort(prev))}</a>` : '<span></span>'}
<a href="${R.rel(depth, 'archive.html')}" style="text-decoration:none">All editions</a>
${next ? `<a href="${R.rel(depth, R.editionPath(next))}" style="text-decoration:none">${e(formatShort(next))} →</a>` : '<span></span>'}
</div>`
      : '';

  const content = `<div class="wrap">

<section class="editorsnote">
<div class="editorsnote__label">Edition No. ${ed.edition.number}<br>${e(formatMasthead(ed.edition.date))}</div>
<div>
<h1 class="editorsnote__title">${e(ed.edition.title)}</h1>
<p class="editorsnote__body">${e(ed.edition.summary)}</p>
</div>
</section>

<section class="lead">
${R.leadBlock(ctx, lead, depth)}
${R.briefingBlock(ctx, briefs, depth)}
</section>

<section class="section" style="border-bottom:0;padding-bottom:0">
${R.signalsBlock(ed.signals)}
</section>

${beatSections}
${editionNav}
</div>`;

  return R.page(ctx, {
    depth,
    canonical,
    anchorNav: true,
    title: isFront
      ? `${site.name} — ${site.tagline}`
      : `${site.name}, ${formatShort(ed.edition.date)} — Edition No. ${ed.edition.number}`,
    description: ed.edition.summary.slice(0, 300),
    editionDate: ed.edition.date,
    editionNumber: ed.edition.number,
    ogImage: R.coverPath(lead),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: ed.edition.title,
      description: ed.edition.summary,
      datePublished: ed.edition.generatedAt,
      isPartOf: { '@type': 'Periodical', name: site.name, url: site.baseUrl },
      hasPart: ed.stories.slice(0, 20).map((s) => ({
        '@type': 'NewsArticle',
        headline: s.headline,
        url: `${site.baseUrl}/${R.storyPath(s)}`,
      })),
    },
    content,
  });
}

// ------------------------------------------------------------ story pages ---

function renderStoryPage(ctx, ed, story) {
  const depth = 1;
  const beat = beatMap.get(story.beat);
  const related = ed.stories
    .filter((s) => s.id !== story.id)
    .sort((a, b) => (a.beat === story.beat ? -1 : 0) - (b.beat === story.beat ? -1 : 0))
    .slice(0, 5);

  const body = (story.body || []).map((p) => `<p>${e(p)}</p>`).join('');

  const content = `<div class="wrap article">
<div class="crumbs">
<a href="${R.rel(depth, 'index.html')}">Front page</a><span>/</span>
<a href="${R.rel(depth, 'index.html')}#${e(story.beat)}">${e(beat?.label || story.beat)}</a><span>/</span>
<a href="${R.rel(depth, R.editionPath(ed.edition.date))}">${e(formatShort(ed.edition.date))}</a>
</div>

<div class="article__grid">
<article>
<div class="kicker">${e(story.kicker)}</div>
<h1 class="article__title">${e(story.headline)}</h1>
<p class="article__deck">${e(story.deck)}</p>

<div class="article__byline">
<span class="byline__name">THE VISSION Desk</span>
<div class="meta" style="margin:0">
<span><time datetime="${e(story.publishedAt || ed.edition.generatedAt)}">${e(formatMasthead(ed.edition.date))}</time></span>
<span>${story.readMinutes} min read</span>
<span>${story.sources.length} source${story.sources.length === 1 ? '' : 's'}</span>
${story.confidence ? `<span><span class="tag${story.confidence === 'high' ? '' : ' tag--low'}">${e(story.confidence)} confidence</span></span>` : ''}
</div>
</div>

<img class="article__cover" src="${R.rel(depth, R.coverPath(story))}" alt="" width="1200" height="675" fetchpriority="high">
<p class="article__caption">Original cover art, generated for this story. THE VISSION does not republish third-party press imagery.</p>

<div class="callout">
<div class="callout__label">The short version</div>
<ul class="keypoints" style="border-left-color:var(--accent);margin-bottom:0">
${story.summary.map((s) => `<li>${e(s)}</li>`).join('')}
</ul>
</div>

<div class="prose">${body || `<p>${e(story.deck)}</p>`}</div>

${story.whyItMatters
      ? `<div class="callout"><div class="callout__label">Why it matters</div><p>${e(story.whyItMatters)}</p></div>`
      : ''}

${story.entities?.length
      ? `<div class="meta" style="margin-top:30px">${story.entities.map((x) => `<span>${e(x)}</span>`).join('')}</div>`
      : ''}
</article>

<aside class="rail">
<div class="rail__block">
<h2 class="rail__title">Sources</h2>
${R.sourceList(ctx, story.sources)}
</div>
${related.length
      ? `<div class="rail__block">
<h2 class="rail__title">Also in this edition</h2>
<ul class="rail__list">
${related
          .map(
            (s) => `<li><a href="${R.rel(depth, R.storyPath(s))}"><span class="k">${e(beatMap.get(s.beat)?.label || s.beat)}</span>${e(s.headline)}</a></li>`
          )
          .join('')}
</ul>
</div>`
      : ''}
<div class="rail__block">
<h2 class="rail__title">How this was made</h2>
<p style="font-family:var(--sans);font-size:.82rem;line-height:1.6;color:var(--muted)">
Researched, written and published by an automated pipeline, then checked against the paper's
editorial rules before release. <a href="${R.rel(depth, 'methodology.html')}" style="color:var(--accent)">Read the method</a>.
</p>
</div>
</aside>
</div>
</div>`;

  return R.page(ctx, {
    depth,
    canonical: R.storyPath(story),
    title: `${story.headline} — ${site.name}`,
    description: story.deck,
    ogType: 'article',
    ogImage: R.coverPath(story),
    editionDate: ed.edition.date,
    editionNumber: ed.edition.number,
    progress: true,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: story.headline,
      description: story.deck,
      datePublished: story.publishedAt || ed.edition.generatedAt,
      dateModified: ed.edition.generatedAt,
      articleSection: beat?.label || story.beat,
      keywords: (story.tags || []).join(', '),
      author: { '@type': 'Organization', name: `${site.name} Desk`, url: site.baseUrl },
      publisher: { '@type': 'Organization', name: site.name, url: site.baseUrl },
      mainEntityOfPage: `${site.baseUrl}/${R.storyPath(story)}`,
      image: [`${site.baseUrl}/${R.coverPath(story)}`],
      citation: story.sources.map((s) => ({
        '@type': 'CreativeWork',
        name: s.title,
        url: s.url,
        publisher: { '@type': 'Organization', name: s.publisher },
      })),
    },
    content,
  });
}

// ---------------------------------------------------------- static pages ----

function renderArchive(ctx, editions) {
  const rows = editions
    .map(
      (ed) => `<a class="archive__row" href="${R.rel(0, R.editionPath(ed.edition.date))}">
<span class="archive__date">${e(ed.edition.date)}</span>
<span class="archive__title">${e(ed.edition.title)}</span>
<span class="archive__n">No. ${ed.edition.number} · ${ed.signals.storyCount} stories · ${ed.signals.sourceCount} sources</span>
</a>`
    )
    .join('');

  const totals = editions.reduce(
    (acc, ed) => ({
      stories: acc.stories + ed.signals.storyCount,
      sources: acc.sources + ed.signals.sourceCount,
    }),
    { stories: 0, sources: 0 }
  );

  const content = `<div class="wrap">
<section class="editorsnote">
<div class="editorsnote__label">Archive</div>
<div>
<h1 class="editorsnote__title">Every edition, kept.</h1>
<p class="editorsnote__body">Each edition is a JSON file in the repository, rendered to HTML on every build.
Nothing is rewritten after publication, so the archive is a record rather than a snapshot.</p>
</div>
</section>
<section class="section">
${R.signalsBlock({
    storyCount: totals.stories,
    sourceCount: totals.sources,
    primaryCount: editions.reduce((n, ed) => n + ed.signals.primaryCount, 0),
    beatCount: editions.length,
    publisherCount: new Set(editions.flatMap((ed) => ed.stories.flatMap((s) => s.sources.map((x) => x.publisher)))).size,
  })}
</section>
<section class="section">
${R.sectionHead('Editions', 'Newest first', editions.length)}
${rows || '<p class="empty">No editions yet.</p>'}
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'archive.html',
    title: `Archive — ${site.name}`,
    description: `Every edition of ${site.name}, newest first.`,
    content,
  });
}

function renderMethodology(ctx, editions) {
  const content = `<div class="wrap">
<section class="editorsnote">
<div class="editorsnote__label">Methodology</div>
<div>
<h1 class="editorsnote__title">Nobody writes this paper.</h1>
<p class="editorsnote__body">${e(site.description)}</p>
</div>
</section>

<section class="section">
<div class="article__grid">
<div class="prose">
<p>Every edition of ${e(site.name)} is produced by an automated pipeline. There is no
newsroom, no editor reading proofs at midnight, and no human deciding which story leads.
That is unusual enough to be worth explaining precisely, because a reader cannot judge
what they cannot see.</p>

<p>The repository holds three things the pipeline reads and one thing it writes. It reads
the <strong>skills</strong>, which are the standing instructions for how to research and how
to write; the <strong>inputs</strong>, which set the beats, the trusted source list and the
house style; and the <strong>evaluations</strong>, which are the tests an edition must pass.
It writes a single JSON file per day. Everything you are looking at — this page, the front
page, every story — is rendered from those JSON files by a build script that reaches
nowhere near the network.</p>

<p>A run works through four stages. First it researches each beat against the day's
candidate stories, following every lead to a primary source. Second it drafts, applying the
house style and refusing to print any claim it could not verify. Third it validates: the
edition is checked against a schema, a sourcing policy and a style linter, and a run that
fails is not published. Fourth it commits the JSON to git and pushes, which is what puts
the edition in front of you.</p>

<p>Two rules matter more than the rest. <strong>No claim runs without a source</strong>, and
lead stories carry at least two that are not rewrites of each other. <strong>Nothing is
invented</strong> — not a URL, not a quotation, not a number, not a date. An edition that
comes up short simply runs short, and the validator will say so out loud rather than let
the pipeline fill the gap with something plausible.</p>

<p>On images: this paper does not republish other people's press photography, because it has
no licence to. The art on every story is generated from that story's identifier, which is why
it is abstract and why it never changes once published.</p>

<p>The obvious limitation is that an automated pipeline can be confidently wrong. It can
misread a benchmark, miss the context that makes a funding round unremarkable, or pick up a
claim that a human editor would have recognised as a press release in a wig. The mitigations
are the source tiers, the confidence label printed on every story, and the fact that every
source is one click away. Where a story is thin, it is marked thin. Read the sources.</p>
</div>

<aside class="rail">
<div class="rail__block">
<h2 class="rail__title">The record</h2>
${R.signalsBlock({
    storyCount: editions.reduce((n, ed) => n + ed.signals.storyCount, 0),
    sourceCount: editions.reduce((n, ed) => n + ed.signals.sourceCount, 0),
    primaryCount: editions.reduce((n, ed) => n + ed.signals.primaryCount, 0),
    beatCount: editions.length,
    publisherCount: new Set(editions.flatMap((ed) => ed.stories.flatMap((s) => s.sources.map((x) => x.publisher)))).size,
  })}
</div>
<div class="rail__block">
<h2 class="rail__title">Read the rules</h2>
<ul class="rail__list">
<li><a href="${e(site.social.repo)}/blob/main/input/editorial.md">Editorial standards</a></li>
<li><a href="${e(site.social.repo)}/blob/main/input/sources.json">Source tiers</a></li>
<li><a href="${e(site.social.repo)}/blob/main/schema/edition.schema.json">Edition schema</a></li>
<li><a href="${e(site.social.repo)}/blob/main/evals/rubric.md">Evaluation rubric</a></li>
<li><a href="${e(site.social.repo)}/blob/main/tools/validate.mjs">The publish gate</a></li>
</ul>
</div>
</aside>
</div>
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'methodology.html',
    title: `Methodology — ${site.name}`,
    description: 'How an automated pipeline researches, writes, checks and publishes this paper.',
    content,
  });
}

function render404(ctx) {
  const content = `<div class="wrap">
<div class="empty" style="padding:120px 0">
<h1 style="font-size:3rem;margin-bottom:14px">Not in the record.</h1>
<p style="font-family:var(--sans);max-width:44ch;margin:0 auto 26px">
That page does not exist. Story URLs are permanent once published, so this is either a typo
or a link to something that never ran.</p>
<a class="source" href="${site.baseUrl}/">Back to the front page</a>
</div>
</div>`;
  return R.page(ctx, {
    depth: 0,
    canonical: '404.html',
    title: `Not found — ${site.name}`,
    description: 'Page not found.',
    content,
  });
}

// ---------------------------------------------------------------- feeds -----

function renderRSS(editions) {
  const items = editions
    .flatMap((ed) => ed.stories.map((s) => ({ s, ed })))
    .slice(0, 60)
    .map(({ s, ed }) => {
      const url = `${site.baseUrl}/${R.storyPath(s)}`;
      const date = new Date(s.publishedAt || ed.edition.generatedAt).toUTCString();
      const body = [s.deck, ...(s.summary || [])].join(' ');
      return `  <item>
    <title>${escapeXML(s.headline)}</title>
    <link>${escapeXML(url)}</link>
    <guid isPermaLink="true">${escapeXML(url)}</guid>
    <pubDate>${date}</pubDate>
    <category>${escapeXML(beatMap.get(s.beat)?.label || s.beat)}</category>
    <description>${escapeXML(body)}</description>
  </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXML(site.name)}</title>
  <link>${escapeXML(site.baseUrl)}/</link>
  <atom:link href="${escapeXML(site.baseUrl)}/rss.xml" rel="self" type="application/rss+xml"/>
  <description>${escapeXML(site.description)}</description>
  <language>${escapeXML(site.locale)}</language>
  <lastBuildDate>${new Date(editions[0].edition.generatedAt).toUTCString()}</lastBuildDate>
  <generator>THE VISSION pipeline</generator>
${items}
</channel>
</rss>
`;
}

function renderSitemap(editions) {
  const urls = [
    { loc: `${site.baseUrl}/`, priority: '1.0', freq: 'daily' },
    { loc: `${site.baseUrl}/archive.html`, priority: '0.6', freq: 'daily' },
    { loc: `${site.baseUrl}/methodology.html`, priority: '0.4', freq: 'monthly' },
    ...editions.map((ed) => ({
      loc: `${site.baseUrl}/${R.editionPath(ed.edition.date)}`,
      priority: '0.7',
      freq: 'monthly',
      lastmod: ed.edition.date,
    })),
    ...editions.flatMap((ed) =>
      ed.stories.map((s) => ({
        loc: `${site.baseUrl}/${R.storyPath(s)}`,
        priority: '0.8',
        freq: 'monthly',
        lastmod: ed.edition.date,
      }))
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
    .map(
      (u) => `  <url><loc>${escapeXML(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`
    )
    .join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------- brand -----

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="10" fill="#15120f"/>
<path d="M14 16 L32 48 L50 16" fill="none" stroke="#c8102e" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"/>
</svg>`;
}

function socialCard() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#1b1714"/><stop offset="1" stop-color="#0b0a09"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<g stroke="#ffffff" stroke-opacity="0.05">
${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="630"/>`).join('')}
</g>
<text x="600" y="300" text-anchor="middle" font-family="Georgia,serif" font-size="104" font-weight="600" fill="#f5f1ea" letter-spacing="-3">THE <tspan fill="#ff5f4d">VISSION</tspan></text>
<rect x="330" y="340" width="540" height="1" fill="#3e3833"/>
<rect x="330" y="345" width="540" height="3" fill="#3e3833"/>
<text x="600" y="400" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="21" letter-spacing="7" fill="#9a928a">THE DAILY RECORD OF ARTIFICIAL INTELLIGENCE</text>
</svg>`;
}

// ----------------------------------------------------------------- main -----

const editions = loadEditions();

if (!editions.length) {
  console.error('✗ generated/ contains no editions — nothing to build.');
  console.error('  Run the news-pipeline skill first, or add a generated/YYYY-MM-DD.json file.');
  process.exit(1);
}

const latest = editions[0];
const ctx = {
  site,
  beats,
  beatMap,
  sourceBook,
  latestDate: latest.edition.date,
  generatedAt: latest.edition.generatedAt,
};

// Covers first — pages reference them.
const coverCount = writeCovers(editions);
write('assets/img/favicon.svg', favicon());
write('assets/img/social-card.svg', socialCard());

// Front page = latest edition.
write(
  'index.html',
  renderEditionPage(ctx, latest, {
    depth: 0,
    canonical: '',
    isFront: true,
    prev: editions[1]?.edition.date,
    next: null,
  })
);

// One page per edition.
editions.forEach((ed, i) => {
  write(
    R.editionPath(ed.edition.date),
    renderEditionPage(ctx, ed, {
      depth: 1,
      canonical: R.editionPath(ed.edition.date),
      isFront: false,
      prev: editions[i + 1]?.edition.date,
      next: editions[i - 1]?.edition.date,
    })
  );
});

// One page per story.
const expectedStoryFiles = new Set();
let storyCount = 0;
for (const ed of editions) {
  for (const story of ed.stories) {
    write(R.storyPath(story), renderStoryPage(ctx, ed, story));
    expectedStoryFiles.add(`${story.id}.html`);
    storyCount++;
  }
}

// Drop output whose JSON no longer exists, so the build stays a pure function of
// generated/. Without this, a story pulled during review leaves its page and its cover
// behind and the site quietly disagrees with the data.
function prune(dir, ext, expected) {
  const full = OUT(dir);
  if (!existsSync(full)) return;
  for (const f of readdirSync(full)) {
    if (f.endsWith(ext) && !expected.has(f)) {
      rmSync(join(full, f));
      console.log(`  removed stale ${dir}/${f}`);
    }
  }
}

const expectedCovers = new Set(
  editions.flatMap((ed) => ed.stories.map((s) => `${s.id}.svg`))
);
prune('story', '.html', expectedStoryFiles);
prune('assets/img/covers', '.svg', expectedCovers);

write('archive.html', renderArchive(ctx, editions));
write('methodology.html', renderMethodology(ctx, editions));
write('404.html', render404(ctx));
write('rss.xml', renderRSS(editions));
write('sitemap.xml', renderSitemap(editions));
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site.baseUrl}/sitemap.xml\n`);
write('.nojekyll', '');

// Machine-readable manifest — this is the API for anything that wants the data.
write(
  'generated/index.json',
  JSON.stringify(
    {
      site: { name: site.name, baseUrl: site.baseUrl, description: site.description },
      // Derived from the newest edition, not from the clock: the build must be a pure
      // function of its inputs so CI can assert that committed HTML matches the JSON.
      builtAt: latest.edition.generatedAt,
      editionCount: editions.length,
      storyCount,
      latest: latest.edition.date,
      editions: editions.map((ed) => ({
        date: ed.edition.date,
        number: ed.edition.number,
        title: ed.edition.title,
        url: `${site.baseUrl}/${R.editionPath(ed.edition.date)}`,
        data: `${site.baseUrl}/generated/${ed.edition.date}.json`,
        ...ed.signals,
      })),
    },
    null,
    2
  ) + '\n'
);

write('generated/latest.json', JSON.stringify(latest, null, 2) + '\n');

console.log(
  `✓ built ${editions.length} edition(s) · ${storyCount} stories · ${coverCount} covers\n` +
    `  front page → edition ${latest.edition.date} (No. ${latest.edition.number})`
);
