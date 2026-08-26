#!/usr/bin/env node
// Renders the site from generated/*.json.
//
//   node tools/build.mjs
//
// This is a pure function of generated/ + input/ + assets/. Delete every .html in
// the repo and run it again: you get byte-identical output. Nothing here reaches
// the network, and no HTML file is ever hand-edited.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJSON, escapeHTML as e, escapeXML, formatMasthead, formatShort,
  hostOf, matchPublisher, readMinutes, hash32, slugify,
} from './lib/util.mjs';
import { renderCover } from './lib/cover.mjs';
import { selectWireItems, wireBlock, wireItemsHTML, stalenessBanner, wirePath, snapshotWire, loadWireHistory } from './lib/wire.mjs';
import * as R from './lib/render.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** "Policy", "Policy and Society", "Policy, Society and India" — an Oxford-comma-free list. */
function listSentence(parts) {
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
const OUT = (...p) => join(ROOT, ...p);

const site = readJSON(OUT('input', 'site.json'));
const { beats } = readJSON(OUT('input', 'beats.json'));
const sourceBook = readJSON(OUT('input', 'sources.json'));
const hackathonBook = existsSync(OUT('input', 'hackathons.json'))
  ? readJSON(OUT('input', 'hackathons.json'))
  : { hackathons: [] };
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

/** Newest harvest, if there is one. Absent is normal and not an error — the site simply
 *  renders without a wire, exactly as it did before the wire existed. */
function loadLatestCandidates() {
  const dir = OUT('generated', 'candidates');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  if (!files.length) return null;
  try {
    return readJSON(join(dir, files[0]));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ topics --
// Every story already tags the entities it names — the paper just never did anything with
// that beyond printing inert text at the bottom of a story page. Bucketed by slug across
// the whole archive, that tagging becomes a real feature: "what has this paper said about
// Nvidia" is a question a reader can now actually ask and get an answer to.

function collectEntities(editions) {
  const bySlug = new Map();
  for (const ed of editions) {
    for (const story of ed.stories) {
      for (const name of story.entities || []) {
        const slug = slugify(name);
        if (!slug) continue;
        if (!bySlug.has(slug)) bySlug.set(slug, { slug, name, items: [] });
        bySlug.get(slug).items.push({ story, ed });
      }
    }
  }
  // Newest first within each entity, same convention as everywhere else on the site.
  for (const entry of bySlug.values()) {
    entry.items.sort((a, b) => b.ed.edition.date.localeCompare(a.ed.edition.date));
  }
  return bySlug;
}

const PROMINENCE_ORDER = { lead: 0, top: 1, standard: 2, brief: 3 };
const byProminence = (a, b) =>
  (PROMINENCE_ORDER[a.prominence] ?? 9) - (PROMINENCE_ORDER[b.prominence] ?? 9);

// ------------------------------------------------------------------ covers --

// Covers are permalinked assets: /assets/img/covers/<story-id>.svg is referenced by every
// social card and every archived page. Changing tools/lib/cover.mjs silently regenerates the
// art for every story ever published, which happened once deliberately and must not happen
// again by accident. A lockfile records what each published cover hashes to; the build
// refuses to overwrite a cover whose hash has changed unless the change is explicit.
//
//   node tools/build.mjs --relock    accept the new art and rewrite the lock
const LOCK_PATH = 'generated/covers.lock.json';
const RELOCK = process.argv.includes('--relock');

function writeCovers(editions) {
  let lock = {};
  try {
    lock = readJSON(OUT(...LOCK_PATH.split('/'))).covers || {};
  } catch {
    lock = {};
  }

  const next = {};
  const changed = [];
  let count = 0;

  for (const ed of editions) {
    for (const story of ed.stories) {
      const beat = beatMap.get(story.beat);
      const svg = renderCover({
        seed: story.cover?.seed || story.id,
        accent: beat?.accent || '#c8102e',
        style: story.cover?.style,
        beat: story.beat,
        motif: story.cover?.motif,
      });
      const digest = hash32(svg).toString(16);
      const known = lock[story.id];
      if (known && known !== digest && !RELOCK) {
        changed.push(story.id);
      }
      next[story.id] = RELOCK || !known ? digest : known;
      write(R.coverPath(story), svg);
      count++;
    }
  }

  if (changed.length) {
    console.error(`\n✗ cover art changed for ${changed.length} already-published story(ies):`);
    for (const id of changed.slice(0, 8)) console.error(`    ${id}`);
    if (changed.length > 8) console.error(`    …and ${changed.length - 8} more`);
    console.error('\n  These are permalinked assets. Either revert the change to tools/lib/cover.mjs,');
    console.error('  or run `node tools/build.mjs --relock` if regenerating the archive is intended.');
    process.exit(1);
  }

  write(
    LOCK_PATH,
    JSON.stringify(
      {
        $comment:
          'Hash of every published cover. The build fails if art changes for a story already recorded here, because cover URLs are permalinks. Run `node tools/build.mjs --relock` to accept a deliberate regeneration.',
        covers: next,
      },
      null,
      2
    ) + '\n'
  );

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

  // Beats with nothing in them used to render a full section each — heading, blurb, a "0
  // stories" count and an apology. On a normal light day that was four of seven sections, so
  // roughly half the front page was dedicated to saying nothing happened. The disclosure is
  // worth keeping and the four blocks are not, so the empty ones collapse into a single line
  // printed once, below.
  const emptyBeats = site.nav.filter((nav) => !inBeat(nav.id).length);
  const presentBeats = new Set(site.nav.filter((nav) => inBeat(nav.id).length).map((n) => n.id));

  const beatSections = site.nav
    .filter((nav) => inBeat(nav.id).length)
    .map((nav) => {
      const beat = beatMap.get(nav.id) || nav;
      const list = inBeat(nav.id);
      let inner;
      if (list.length <= 2) {
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

  // The four blocks, replaced by one sentence. Still says a beat came up empty; no longer
  // spends a screen doing it.
  const emptyNote = emptyBeats.length
    ? `<p class="emptybeats">Nothing cleared the bar today in ${listSentence(emptyBeats.map((b) => e(b.label)))}.</p>`
    : '';

  const editionNav =
    prev || next
      ? `<div class="meta" style="justify-content:space-between;padding:26px 0;border-top:1px solid var(--rule)">
${prev ? `<a href="${R.rel(depth, R.editionPath(prev))}" style="text-decoration:none">← ${e(formatShort(prev))}</a>` : '<span></span>'}
<a href="${R.rel(depth, 'archive.html')}" style="text-decoration:none">All editions</a>
${next ? `<a href="${R.rel(depth, R.editionPath(next))}" style="text-decoration:none">${e(formatShort(next))} →</a>` : '<span></span>'}
</div>`
      : '';

  // The wire only appears on the front page. Dated edition pages are a record of what was
  // published that day and must not acquire new content after the fact.
  const wire = isFront ? wireBlock(ctx.wireItems, { depth, sourceBook, harvestedAt: ctx.harvestedAt }) : '';
  const stale = isFront && ctx.wireItems.length ? stalenessBanner(ctx.hoursSinceEdition) : '';

  const content = `<div class="wrap">
${stale}
<section class="editorsnote">
<div class="editorsnote__label">Edition No. ${ed.edition.number}<br>${e(formatMasthead(ed.edition.date))}</div>
<div>
<h1 class="editorsnote__title">${e(ed.edition.title)}</h1>
<p class="editorsnote__body">${e(ed.edition.summary)}</p>
${isFront ? `<p class="wire__stamp">Published <time datetime="${e(ed.edition.generatedAt)}" data-relative>${e(formatMasthead(ed.edition.date))}, ${e(ed.edition.generatedAt.slice(11, 16))} UTC</time> · the edited tier, researched and written by the desk</p>` : ''}
</div>
</section>

<section class="lead">
${R.leadBlock(ctx, lead, depth)}
${R.briefingBlock(ctx, briefs, depth)}
</section>

${
  isFront
    ? R.tierStrip(ctx, {
        depth,
        anchorNav: true,
        editionCount: ed.signals?.storyCount,
        digestCount: ctx.latestDigestCount,
        wireCount: ctx.wireItems?.length,
      })
    : ''
}

<section class="section" style="border-bottom:0;padding-bottom:0">
${R.signalsBlock(ed.signals)}
${emptyNote}
</section>

${wire}
${beatSections}
${editionNav}
</div>`;

  return R.page(ctx, {
    depth,
    canonical,
    anchorNav: true,
    // Only the front page hides beats that came up empty; a dated edition page is a record
    // and lists what it listed on the day.
    presentBeats: isFront ? presentBeats : null,
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
<article${beat?.accent ? ` style="--beat-accent:${e(beat.accent)}"` : ''}>
<div class="kicker">${e(story.kicker)}</div>
<h1 class="article__title">${e(story.headline)}</h1>
<p class="article__deck">${e(story.deck)}</p>

<div class="article__byline">
<span class="byline__name">THE VISSION Desk</span>
<div class="meta" style="margin:0">
${/* This line shows the edition date ("26 August 2026"), so its machine-readable datetime
      must be the edition's own date too — not story.publishedAt, which is when the
      underlying event happened and can be days earlier. A <time> element's datetime
      attribute has to describe the text it wraps; encoding a different date than the one
      printed is the exact defect a reader flagged after comparing the two by hand. The
      source's own date is shown separately, correctly, in each source citation below. */ ''}
<span><time datetime="${e(ed.edition.generatedAt)}">${e(formatMasthead(ed.edition.date))}</time></span>
<span>${story.readMinutes} min read</span>
<span>${story.sources.length} source${story.sources.length === 1 ? '' : 's'}</span>
${story.confidence ? `<span><span class="tag${story.confidence === 'high' ? '' : ' tag--low'}" title="${e(story.confidence)} confidence">${e(R.CONFIDENCE_LABEL[story.confidence] || story.confidence)}</span></span>` : ''}
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
      ? `<div class="topics" style="margin-top:30px">${story.entities
          .map((x) => `<a class="topic" href="${R.rel(depth, `entity/${slugify(x)}.html`)}">${e(x)}</a>`)
          .join('')}</div>`
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
      // datePublished describes this NewsArticle — THE VISSION's own story — not the event it
      // reports on. story.publishedAt is when the underlying event happened, which can be
      // days before THE VISSION wrote about it (the Stanford study this caught: study
      // published 12 Aug, THE VISSION's article on it 26 Aug). Using the earlier date here
      // told search engines and agents this article was two weeks older than it actually is.
      datePublished: ed.edition.generatedAt,
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

// A date can have up to three independent records: the AI edition (Tier 2, needs a key),
// the digest (Tier 1.5, no key), and a wire snapshot (Tier 1, no key). They run on different
// schedules and any one of them can be missing for a given day without the others being
// affected — that independence is the whole point of the tiered design (see ARCHITECTURE.md
// section 1). The archive used to list editions only; a reader had no way to see what the
// no-AI tiers were doing on a day the AI edition didn't run. This shows all three, honestly:
// a real link where a record exists, a plain "not published" where it doesn't.
function tierChip(label, href, count, unit) {
  return href
    ? `<a class="archive__tier" href="${href}">${e(label)} · ${count} ${unit}</a>`
    : `<span class="archive__tier archive__tier--missing">${e(label)} · not published</span>`;
}

function renderArchive(ctx, editions, digests, wireHistory) {
  const byDate = new Map();
  const get = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, edition: null, digest: null, wire: null });
    return byDate.get(date);
  };
  for (const ed of editions) get(ed.edition.date).edition = ed;
  for (const d of digests) get(d.edition.date).digest = d;
  for (const w of wireHistory) get(w.date).wire = w;

  const dates = [...byDate.keys()].sort().reverse();

  const rows = dates
    .map((date) => {
      const row = byDate.get(date);
      const titleClass = row.edition ? 'archive__title' : 'archive__title archive__title--none';
      const title = row.edition ? e(row.edition.edition.title) : 'No edited edition this day';
      return `<div class="archive__row">
<span class="archive__date">${e(date)}</span>
<div class="archive__body">
<span class="${titleClass}">${title}</span>
<div class="archive__tiers">
${tierChip('Edition', row.edition && R.rel(0, R.editionPath(date)), row.edition?.signals.storyCount, 'stories')}
${tierChip('Digest', row.digest && R.rel(0, digestPath(date)), row.digest?.items.length, 'headlines')}
${tierChip('Wire', row.wire && R.rel(0, wirePath(date)), row.wire?.items.length, 'headlines')}
</div>
</div>
</div>`;
    })
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
<p class="editorsnote__body">Each edition, digest and wire snapshot is a JSON file in the repository, rendered to HTML
on every build. Nothing is rewritten after publication, so this is a record rather than a snapshot. Every day shows
all three tiers — <a href="${R.rel(0, 'methodology.html')}">what each one is</a> — and says plainly when one didn't
run rather than leaving a gap unexplained.</p>
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
${R.sectionHead('Every day', 'Newest first — edition, digest and wire, side by side', dates.length)}
${rows || '<p class="empty">Nothing published yet.</p>'}
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'archive.html',
    title: `Archive — ${site.name}`,
    description: `Every edition, digest and wire snapshot of ${site.name}, newest first.`,
    content,
  });
}

function renderTopics(ctx, entities) {
  const ranked = [...entities.values()].sort(
    (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)
  );

  const rows = ranked
    .map(
      (ent) => `<a class="archive__row" href="${R.rel(0, `entity/${ent.slug}.html`)}">
<span class="archive__n" style="font-family:var(--serif);font-size:1.05rem;color:var(--ink)">${ent.items.length}</span>
<span class="archive__title">${e(ent.name)}</span>
<span class="archive__n">last mentioned ${e(formatShort(ent.items[0].ed.edition.date))}</span>
</a>`
    )
    .join('');

  const content = `<div class="wrap">
<section class="editorsnote">
<div class="editorsnote__label">Topics</div>
<div>
<h1 class="editorsnote__title">Every company, model and body this paper has named.</h1>
<p class="editorsnote__body">Pulled automatically from the entities tagged on each story — the same tags that
appear at the bottom of every article, made clickable. Ranked by how often each has been mentioned, across
every edition ever published.</p>
</div>
</section>
<section class="section">
${R.sectionHead('All topics', `${ranked.length} tracked`, null)}
${rows || '<p class="empty">No entities tagged yet.</p>'}
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'topics.html',
    title: `Topics — ${site.name}`,
    description: `Every company, model, lab and regulator this paper has covered, ranked by how often each is mentioned.`,
    content,
  });
}

function renderEntity(ctx, ent) {
  const depth = 1;
  const [lead, ...rest] = ent.items;

  const leadRow = (item) => `<article class="row" style="--beat-accent:${e(ctx.beatMap.get(item.story.beat)?.accent || '')}">
<a href="${R.rel(depth, R.storyPath(item.story))}" tabindex="-1" aria-hidden="true">
<img class="row__cover" src="${R.rel(depth, R.coverPath(item.story))}" alt="" width="1200" height="675" loading="lazy">
</a>
<div>
<div class="kicker">${e(item.story.kicker)} · ${e(formatShort(item.ed.edition.date))}</div>
<h3 class="row__title"><a href="${R.rel(depth, R.storyPath(item.story))}">${e(item.story.headline)}</a></h3>
<p class="row__deck clamp-2">${e(item.story.deck)}</p>
</div>
</article>`;

  const content = `<div class="wrap">
<div class="crumbs">
<a href="${R.rel(depth, 'index.html')}">Front page</a><span>/</span>
<a href="${R.rel(depth, 'topics.html')}">Topics</a>
</div>
<section class="editorsnote">
<div class="editorsnote__label">Topic</div>
<div>
<h1 class="editorsnote__title">${e(ent.name)}</h1>
<p class="editorsnote__body">Mentioned in ${ent.items.length} ${ent.items.length === 1 ? 'story' : 'stories'}, most recently on
${e(formatMasthead(lead.ed.edition.date))}. Newest first.</p>
</div>
</section>
<section class="section">
<div class="rows">
${ent.items.map(leadRow).join('')}
</div>
</section>
</div>`;

  return R.page(ctx, {
    depth,
    canonical: `entity/${ent.slug}.html`,
    title: `${ent.name} — ${site.name}`,
    description: `Every story ${site.name} has published mentioning ${ent.name}, newest first.`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${ent.name} — coverage`,
      about: { '@type': 'Thing', name: ent.name },
      hasPart: ent.items.slice(0, 20).map(({ story }) => ({
        '@type': 'NewsArticle',
        headline: story.headline,
        url: `${site.baseUrl}/${R.storyPath(story)}`,
      })),
    },
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

<h2 id="digest" style="font-size:1.3rem;margin:34px 0 12px">The digest: no model at all</h2>
<p><a href="${R.rel(0, 'digest.html')}">A second, separate page</a> runs without any AI in the
loop whatsoever — no API key, no model, nothing generated. <code>tools/harvest.mjs</code>
collects headlines from public feeds; <code>tools/digest.mjs</code> clusters near-duplicate
coverage of the same event, scores each cluster on recency, source tier, how many independent
publishers confirm it, whether it repeats a previous digest, and beat priority, then keeps the
top-ranked clusters per beat. That is genuinely all it does.</p>

<p>The honest way to describe the difference: the edited paper above claims to have read,
verified and explained something. The digest claims only to have counted and sorted. Every
headline on it is a source's own title, never rewritten, and every item links straight to
where it was reported rather than to a summary of it. A story is marked <strong>confirmed</strong>
only when a primary or established-newsroom source and a second, genuinely independent
publisher both cover the same cluster — not merely two links, which is a distinction
<code>tools/validate.mjs</code> enforces on the edited paper too, the hard way: it once let
two European Commission pages count as two sources for the same story.</p>

<p>What it cannot do matters as much as what it can. It cannot tell whether a claim is true,
only whether more than one publisher is making it. It cannot explain why something matters —
there is no "why it matters" field in its schema, on purpose, because writing one would be
the pipeline inventing an opinion it does not have. And its clustering works on shared words
in a headline, not meaning, so two outlets covering the same event in very different language
will often show up as two separate, unconfirmed items rather than one confirmed one. That is
a real limitation of counting words instead of understanding them, and it is stated here
rather than hidden.</p>

<h2 id="wire" style="font-size:1.3rem;margin:34px 0 12px">The wire: not even sorted</h2>
<p>Underneath the digest, on the front page, is <strong>the wire</strong> — the lowest tier and
the one with no judgement in it at all. <code>tools/harvest.mjs</code> pulls headlines straight
from roughly 30 public RSS feeds and a handful of topic searches, keeps whatever is plausibly
about AI, and shows the most recent ones, exactly as their publisher wrote them. Nothing is
clustered, nothing is ranked by importance, nothing is confirmed against a second source. A
single busy feed cannot fill the whole page — one publisher can only ever hold a handful of
the visible slots — but beyond that, this is a raw feed of the newest items and nothing more.</p>

<p>This is deliberate: the wire is what keeps the site from going dark. It needs no API key
and no model, so if the edited pipeline or the digest both stop — an expired key, an outage, a
run that failed its own checks — the wire keeps refreshing on its own schedule and the front
page still shows what happened today. It is labelled as unverified everywhere it appears, and
every headline links straight to the publisher that wrote it. Treat it exactly like a stack of
newspapers on a desk, not like reporting.</p>
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
<h2 class="rail__title">Who runs this</h2>
<p style="font-family:var(--sans);font-size:.82rem;line-height:1.6;color:var(--muted)">
${site.founder ? `${e(site.name)} was founded by <strong style="color:var(--ink-2)">${e(site.founder)}</strong>, who owns the project and sets the editorial rules the pipeline runs on. ` : ''}The pipeline writes; a human decides what it is allowed to write, and merges any change to its own standards.
</p>
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

// -------------------------------------------------------------- Tier 1.5 digest ---
// No AI wrote anything on this page. Every headline is a source's own title, verbatim; every
// item links straight out to where it was reported. See tools/digest.mjs and
// ARCHITECTURE.md section 5.5 for what this is and, as importantly, what it deliberately
// does not attempt — a machine clustering and ranking headlines is not the same claim as a
// machine understanding them, and this page is built to never blur that line.

function loadDigests() {
  const dir = OUT('generated', 'digest');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map((f) => readJSON(join(dir, f)));
}

const digestPath = (date) => (date ? `digest/${date}.html` : 'digest.html');

function digestItemRow(ctx, item, depth) {
  const beat = ctx.beatMap.get(item.beat);
  const primary = item.sources[0];
  const rest = item.sources.slice(1);
  return `<article class="digest-item"${beat ? ` style="--beat-accent:${e(beat.accent)}"` : ''}>
<span class="digest-item__badge digest-item__badge--${item.confidence === 'confirmed' ? 'confirmed' : 'single'}">${item.confidence === 'confirmed' ? 'Confirmed' : 'Single source'}</span>
<h3 class="digest-item__title"><a href="${e(primary.url)}" rel="noopener nofollow" target="_blank">${e(item.title)}</a></h3>
<div class="meta">
<span>${e(beat?.label || item.beat)}</span>
${item.publishedAt ? `<span><time datetime="${e(item.publishedAt)}" data-relative>${e(formatShort(item.publishedAt))}</time></span>` : ''}
</div>
<div class="digest-item__sources">
<span class="digest-item__reportedby">Reported by</span>
${item.sources.map((s) => `<a class="source" href="${e(s.url)}" rel="noopener nofollow" target="_blank">
<span class="source__mark" aria-hidden="true">${e((s.publisher || '??').slice(0, 2).toUpperCase())}</span>
<span>${e(s.publisher)}</span>
<span class="source__tier">T${s.tier ?? 4}</span>
</a>`).join('')}
</div>
</article>`;
}

function renderDigestPage(ctx, digests, { index, isLatest }) {
  const digest = digests[index];
  const depth = isLatest ? 0 : 1;
  const prev = digests[index + 1]?.edition.date;
  const next = digests[index - 1]?.edition.date;

  const byBeat = new Map();
  for (const item of digest.items) {
    if (!byBeat.has(item.beat)) byBeat.set(item.beat, []);
    byBeat.get(item.beat).push(item);
  }

  const sections = site.nav
    .map((nav) => {
      const items = byBeat.get(nav.id) || [];
      if (!items.length) return '';
      return `<section class="section" id="digest-${e(nav.id)}">
${R.sectionHead(nav.label, null, items.length)}
<div class="digest-list">${items.map((i) => digestItemRow(ctx, i, depth)).join('')}</div>
</section>`;
    })
    .join('');

  const nav =
    prev || next
      ? `<div class="meta" style="justify-content:space-between;padding:26px 0;border-top:1px solid var(--rule)">
${prev ? `<a href="${R.rel(depth, digestPath(prev))}" style="text-decoration:none">← ${e(formatShort(prev))}</a>` : '<span></span>'}
${next ? `<a href="${R.rel(depth, digestPath(next))}" style="text-decoration:none">${e(formatShort(next))} →</a>` : '<span></span>'}
</div>`
      : '';

  const content = `<div class="wrap">
<section class="editorsnote">
<div class="editorsnote__label">Tier 1.5<br>No AI, no prose</div>
<div>
<h1 class="editorsnote__title">The digest for ${e(formatMasthead(digest.edition.date))}</h1>
<p class="editorsnote__body">${digest.items.length} headlines, clustered and ranked by a deterministic program — recency,
source tier, independent confirmation, novelty and beat priority, weighted and summed. No model wrote or selected
any of this. Every title on this page is a source's own headline; every item links straight to where it was
reported. <a href="${R.rel(depth, 'methodology.html')}#digest">How this differs from the edited paper →</a></p>
<p class="wire__stamp">Last refreshed <time datetime="${e(digest.edition.generatedAt)}" data-relative>${e(formatMasthead(digest.edition.date))}, ${e(digest.edition.generatedAt.slice(11, 16))} UTC</time> · runs three times a day, no model in the loop</p>
</div>
</section>
${sections || '<p class="empty">No items cleared the classifier for this run.</p>'}
${nav}
</div>`;

  return R.page(ctx, {
    depth,
    canonical: digestPath(isLatest ? null : digest.edition.date),
    anchorNav: isLatest,
    title: isLatest
      ? `Digest — ${site.name}`
      : `Digest, ${formatShort(digest.edition.date)} — ${site.name}`,
    description: `${digest.items.length} AI headlines for ${digest.edition.date}, clustered and ranked without a model — no generated prose, every title is a source's own.`,
    content,
  });
}

// A permanent, dated page for one day's wire — the archived counterpart to wireBlock(),
// which only ever shows the live, current selection. See snapshotWire() in wire.mjs for why
// this history exists at all: the wire itself keeps no record of its own past.
function renderWirePage(ctx, history, { index }) {
  const snap = history[index];
  const depth = 1;
  const prev = history[index + 1]?.date;
  const next = history[index - 1]?.date;

  const nav =
    prev || next
      ? `<div class="meta" style="justify-content:space-between;padding:26px 0;border-top:1px solid var(--rule)">
${prev ? `<a href="${R.rel(depth, wirePath(prev))}" style="text-decoration:none">← ${e(formatShort(prev))}</a>` : '<span></span>'}
${next ? `<a href="${R.rel(depth, wirePath(next))}" style="text-decoration:none">${e(formatShort(next))} →</a>` : '<span></span>'}
</div>`
      : '';

  const content = `<div class="wrap">
<section class="editorsnote">
<div class="editorsnote__label">Tier 1<br>No AI, no prose, no ranking</div>
<div>
<h1 class="editorsnote__title">The wire for ${e(formatMasthead(snap.date))}</h1>
<p class="editorsnote__body">${snap.items.length} unedited headlines, exactly as their publishers wrote them. This is an
archived snapshot of what the front page's Wire showed that day — it is not re-ranked or checked after the fact, and
it is not reporting. <a href="${R.rel(depth, 'methodology.html')}#wire">How this differs from the edited paper →</a></p>
<p class="wire__stamp">Snapshot taken <time datetime="${e(snap.harvestedAt || '')}">${e(formatMasthead(snap.date))}, ${e((snap.harvestedAt || '').slice(11, 16))} UTC</time></p>
</div>
</section>
<ul class="wire">${wireItemsHTML(snap.items, { sourceBook })}</ul>
${nav}
</div>`;

  return R.page(ctx, {
    depth,
    canonical: wirePath(snap.date),
    title: `Wire, ${formatShort(snap.date)} — ${site.name}`,
    description: `${snap.items.length} unedited headlines the wire carried on ${snap.date} — a record, not reporting.`,
    content,
  });
}

/**
 * Search over every published story. Static site, so this is entirely client-side: fetches
 * /generated/search-index.json once and filters it in the browser. No server, no dependency,
 * degrades to "type a query, see nothing until JS loads" rather than breaking — the archive
 * link right below it still works with JS off.
 */
function renderSearch(ctx) {
  const content = `<div class="wrap">
<section class="editorsnote">
<div class="editorsnote__label">Search</div>
<div>
<h1 class="editorsnote__title">Search every story this paper has published.</h1>
<p class="editorsnote__body">Matches headlines, decks, companies and topics across the full archive. Runs
entirely in your browser against a single downloaded index — nothing is sent anywhere, and there is nothing
to send it to.</p>
</div>
</section>
<section class="section" style="border-bottom:0">
<input type="search" id="search-input" class="search-input" placeholder="Search stories — try a company, model or topic…" autocomplete="off" aria-label="Search stories">
<p id="search-status" class="search-status" role="status"></p>
<div id="search-results"></div>
</section>
</div>
<script>
(function () {
  var input = document.getElementById('search-input');
  var status = document.getElementById('search-status');
  var results = document.getElementById('search-results');
  var indexUrl = ${JSON.stringify(R.rel(0, 'generated/search-index.json'))};
  var beatLabels = ${JSON.stringify(Object.fromEntries(ctx.beats.map((b) => [b.id, b.label])))};
  var storyBase = ${JSON.stringify(R.rel(0, 'story/'))};
  var data = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Substring match across headline, deck, kicker and entities, weighted so a headline hit
  // ranks above a deck hit, an entity hit above either — searching "Nvidia" should surface
  // every Nvidia story before a story that merely mentions Nvidia in passing prose.
  function score(item, q) {
    var s = 0;
    var headline = item.headline.toLowerCase();
    var deck = (item.deck || '').toLowerCase();
    var entities = (item.entities || []).join(' ').toLowerCase();
    if (entities.indexOf(q) !== -1) s += 5;
    if (headline.indexOf(q) !== -1) s += 3;
    if ((item.kicker || '').toLowerCase().indexOf(q) !== -1) s += 2;
    if (deck.indexOf(q) !== -1) s += 1;
    return s;
  }

  function render(items, q) {
    if (!q) {
      status.textContent = data.length + ' stories indexed. Start typing to search.';
      results.innerHTML = '';
      return;
    }
    if (!items.length) {
      status.textContent = 'No stories match "' + q + '".';
      results.innerHTML = '';
      return;
    }
    status.textContent = items.length + ' result' + (items.length === 1 ? '' : 's');
    results.innerHTML = items
      .slice(0, 40)
      .map(function (item) {
        var beat = beatLabels[item.beat] || item.beat;
        return (
          '<a class="archive__row" href="' + storyBase + item.id + '.html">' +
          '<span class="archive__n" style="font-family:var(--sans);font-size:.68rem;text-transform:uppercase;letter-spacing:.08em">' + escapeHtml(beat) + '</span>' +
          '<span class="archive__title">' + escapeHtml(item.headline) + '</span>' +
          '<span class="archive__n">' + escapeHtml(item.date) + '</span>' +
          '</a>'
        );
      })
      .join('');
  }

  function runSearch() {
    var q = input.value.trim().toLowerCase();
    if (!data) return;
    if (!q) { render([], ''); return; }
    var scored = data
      .map(function (item) { return { item: item, s: score(item, q) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s || b.item.date.localeCompare(a.item.date); })
      .map(function (r) { return r.item; });
    render(scored, q);
  }

  status.textContent = 'Loading the archive…';
  fetch(indexUrl)
    .then(function (r) { return r.json(); })
    .then(function (json) {
      data = json;
      render([], '');
      input.addEventListener('input', runSearch);
      var params = new URLSearchParams(location.search);
      var initial = params.get('q');
      if (initial) { input.value = initial; runSearch(); }
    })
    .catch(function () {
      status.textContent = 'Could not load the search index. Try the archive instead.';
    });
})();
</script>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'search.html',
    title: `Search — ${site.name}`,
    description: `Search every story THE VISSION has published, across every edition.`,
    content,
  });
}

function renderHackathons(ctx, editions) {
  const all = hackathonBook.hackathons || [];
  // Expiry is measured against the newest edition, not the clock, so the page stays a pure
  // function of committed inputs and CI's determinism check keeps passing.
  const today = ctx.latestDate;
  const live = all
    .filter((h) => h.deadline >= today)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  const rows = live
    .map(
      (h) => `<article class="hack">
<div class="hack__when">
<span class="hack__date">${e(formatShort(h.deadline))}</span>
<span class="hack__label">Deadline</span>
</div>
<div class="hack__body">
<h3 class="hack__name"><a href="${e(h.url)}" rel="noopener nofollow" target="_blank">${e(h.name)}</a></h3>
<p class="hack__org">${e(h.organiser)}</p>
<div class="meta">
<span>${e(h.format)}</span>
${h.location ? `<span>${e(h.location)}</span>` : ''}
<span>Starts ${e(formatShort(h.starts))}</span>
${h.prize ? `<span>${e(h.prize)}</span>` : ''}
</div>
<p class="hack__elig">${e(h.eligibility)}</p>
</div>
</article>`
    )
    .join('');

  const content = `<div class="wrap">
<section class="editorsnote">
<div class="editorsnote__label">Hackathons</div>
<div>
<h1 class="editorsnote__title">Where to actually build something.</h1>
<p class="editorsnote__body">Open AI hackathons with their real deadlines and prize pools. Every entry was
checked by opening the organiser's own listing — the same sourcing rule the rest of the paper runs on.
Entries disappear from this page automatically once their submission deadline passes.</p>
</div>
</section>
<section class="section">
${R.sectionHead('Open now', 'Sorted by closing date', live.length)}
${rows || `<p class="empty">Nothing open at the moment. This page lists only events whose deadline has not passed, so it runs empty rather than stale.</p>`}
</section>
<section class="section">
<p class="wire__warning" style="max-width:70ch">
Listings are informational and are not endorsements. THE VISSION has no relationship with any
organiser here and takes no fee for a listing. Check the organiser's own rules before entering —
dates, eligibility and prizes are theirs to change.
<br><br>
Know one that belongs here? <a href="${e(ctx.site.social.repo)}/blob/main/input/hackathons.json" rel="noopener">Open a pull request against <code>input/hackathons.json</code></a>.
</p>
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'hackathons.html',
    title: `AI hackathons — open now | ${site.name}`,
    description:
      'Open AI hackathons with verified deadlines, prize pools and eligibility. Checked against each organiser\'s own listing, and expired entries removed automatically.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Open AI hackathons',
      itemListElement: live.map((h, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Event',
          name: h.name,
          url: h.url,
          startDate: h.starts,
          endDate: h.deadline,
          eventAttendanceMode:
            h.format === 'online'
              ? 'https://schema.org/OnlineEventAttendanceMode'
              : h.format === 'hybrid'
                ? 'https://schema.org/MixedEventAttendanceMode'
                : 'https://schema.org/OfflineEventAttendanceMode',
          organizer: { '@type': 'Organization', name: h.organiser },
          ...(h.location ? { location: { '@type': 'Place', name: h.location } } : {}),
        },
      })),
    },
    content,
  });
}

function legalLede(section, title, body) {
  return `<section class="editorsnote">
<div class="editorsnote__label">${e(section)}</div>
<div>
<h1 class="editorsnote__title">${title}</h1>
<p class="editorsnote__body">${body}</p>
</div>
</section>`;
}

function legalFooter(ctx) {
  return `<p style="margin-top:34px;color:var(--muted);font-size:.95rem">${e(site.name)} is owned and operated by
${e(site.copyrightHolder || site.founder || site.name)}. This page describes the publication's policies. It is
written to be acted on, and it is not a substitute for a lawyer's advice on your own situation.</p>
<p style="margin-top:10px;color:var(--muted);font-size:.85rem">Also see:
<a href="${R.rel(0, 'legal.html')}">Corrections &amp; rights</a> ·
<a href="${R.rel(0, 'terms.html')}">Terms of use</a> ·
<a href="${R.rel(0, 'privacy.html')}">Privacy</a></p>`;
}

function renderLegal(ctx) {
  const content = `<div class="wrap">
${legalLede(
    'Legal',
    'Corrections, rights and takedowns.',
    `This page states how ${e(site.name)} handles other people's work and its own mistakes.
For how the site handles your data, see <a href="${R.rel(0, 'privacy.html')}">Privacy</a>; for the rules of using the site, see
<a href="${R.rel(0, 'terms.html')}">Terms of use</a>.`
  )}

<section class="section">
<div class="prose">
<h2 style="font-size:1.3rem;margin-bottom:12px">Corrections</h2>
<p>The paper is produced by an automated pipeline, and an automated pipeline can be
confidently wrong. If something here is inaccurate, <a href="${e(site.social.repo)}/issues/new" rel="noopener">open an
issue</a> with the story URL and what is wrong. Corrections are made as a new edition or a
marked correction note on the story.</p>
<p>Published stories are not silently rewritten. The archive is a record, and quietly editing
yesterday's copy to match today's understanding is how a publication loses the right to be
believed. A correction appears as a correction.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">How other people's work is used</h2>
<p>Every story summarises reporting and announcements published elsewhere, links to the
original, and names the publisher. Summarising a news event and linking to its source is
lawful; reproducing someone's article is not, and the difference is enforced mechanically
rather than left to judgement. <code>tools/validate.mjs</code> blocks publication if any story reuses
more than a few consecutive words of a source's own phrasing, and flags quotations that run
long enough to stop being quotation.</p>
<p>No third-party photography, artwork or video appears anywhere on this site. Every image is
generated from the story's own identifier by <code>tools/lib/cover.mjs</code>, drawn from a fixed library
of a hundred distinct compositions. That is why the art is abstract: the paper has no licence
to publish press images, so it does not.</p>
<p>Company names, product names and logos mentioned in coverage belong to their owners and are
used to identify what is being reported on. No affiliation or endorsement is implied.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Takedown requests</h2>
<p>If you believe material here infringes your copyright or another right, <a href="${e(site.social.repo)}/issues/new" rel="noopener">open an
issue</a> identifying the specific URL and the basis of the claim. Material that infringes will
be removed. The repository's full history is public, so removal is recorded rather than
concealed.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Reusing this paper</h2>
<p>The software is licensed under PolyForm Noncommercial; the published editions under
CC BY-NC-ND 4.0. In short: read it, quote it with attribution, link to it freely, run your own
non-commercial version of the software. Do not republish the editions or use any of it
commercially without permission. The <a href="${e(site.social.repo)}/blob/main/LICENSE" rel="noopener">full terms</a> govern.</p>

${legalFooter(ctx)}
</div>
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'legal.html',
    title: `Corrections, rights and takedowns — ${site.name}`,
    description: `How ${site.name} handles corrections, third-party rights and takedown requests.`,
    content,
  });
}

function renderTerms(ctx) {
  const owner = site.copyrightHolder || site.founder || site.name;
  const content = `<div class="wrap">
${legalLede(
    'Terms of use',
    'The rules of reading this paper.',
    `Plain terms for a small, free publication. Not a contract drafted for a platform this isn't.`
  )}

<section class="section">
<div class="prose">
<h2 style="font-size:1.3rem;margin-bottom:12px">What this is</h2>
<p>${e(site.name)} is a free daily publication about artificial intelligence, researched and
written by an automated pipeline and owned by ${e(owner)}. Using the site — reading it,
following links from it, subscribing to its RSS feed — means you accept these terms. If you
don't accept them, the only enforcement mechanism is: don't use the site.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">What you may do</h2>
<p>Read it, share links to it, and quote it with attribution under the terms in
<a href="${e(site.social.repo)}/blob/main/LICENSE" rel="noopener">LICENSE</a>. Run your own copy of the software
non-commercially. Point an RSS reader, a script, or a crawler at the public pages at a
reasonable rate — this is a static site with no login and nothing to protect from ordinary
reading traffic.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">What you may not do</h2>
<p>Republish the editions as your own, under CC BY-NC-ND 4.0. Use the site or its content for
a commercial purpose without a licence. Attempt to disrupt the site, its GitHub Actions
workflows, or the repository. Misrepresent content from this site as your own reporting, or
as endorsed by the companies and people it covers.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Not advice of any kind</h2>
<p>Nothing here is investment, financial, legal, tax or professional advice. Coverage of a
company, a funding round or a valuation is reporting, not a recommendation to do anything.
Decisions made on the basis of anything published here are yours to make and yours to own.
The paper carries no advertising, takes no sponsorship, accepts no payment for coverage or
for a hackathon listing, and holds no financial position in anything it covers.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">No warranty</h2>
<p>The site is provided as is, with no warranty that its content is accurate, complete or
current. It is produced by an automated pipeline, which can be confidently wrong — see
<a href="${R.rel(0, 'methodology.html')}">Methodology</a> for the checks that exist and their limits. Verify
anything you intend to rely on against the source linked in the story, which is why the link
is always there.</p>
<p>External links point to sites this paper does not control and is not responsible for. To the
extent the law allows, ${e(owner)} disclaims liability for any loss arising from use of this
site or reliance on its content.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">If you're a minor</h2>
<p>The site collects no personal information from anyone — see
<a href="${R.rel(0, 'privacy.html')}">Privacy</a> — but if local law requires a parent or guardian's
permission for you to use a site like this, get it first.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Changes</h2>
<p>These terms can change. The current version is always the one on this page; there is no
notification mechanism beyond the page itself and the repository's commit history, which
records every change to it.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Governing law</h2>
<p>This page does not name a specific jurisdiction, because doing so accurately requires legal
advice ${e(owner)} has not yet obtained. Where a dispute cannot be resolved informally, it
falls to whatever law and forum would otherwise apply to a claim against an individual
publisher — nothing here should be read as ${e(owner)} conceding to a jurisdiction not
otherwise applicable.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Severability</h2>
<p>If any part of these terms turns out to be unenforceable, the rest still stands.</p>

${legalFooter(ctx)}
</div>
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'terms.html',
    title: `Terms of use — ${site.name}`,
    description: `The terms governing use of ${site.name}.`,
    content,
  });
}

function renderPrivacy(ctx) {
  const content = `<div class="wrap">
${legalLede(
    'Privacy',
    'This site collects nothing from you.',
    `No accounts, no cookies, no analytics, no tracking pixels, no advertising network. One
non-identifying preference stored only in your own browser. That's the whole policy — the
rest of this page is the detail.`
  )}

<section class="section">
<div class="prose">
<h2 style="font-size:1.3rem;margin-bottom:12px">What is not collected</h2>
<p>${e(site.name)} runs no analytics service, no advertising network, no tracking pixel and no
third-party embed of any kind. There are no accounts, no sign-up, no comments, no newsletter.
There is nothing to consent to, because there is nothing that reads, stores or transmits
anything about you.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">What is stored, and where</h2>
<p>The site remembers one thing in your browser's local storage: whether you chose light or
dark mode. It never leaves your device, is never sent to any server, identifies nobody, and
you can clear it at any time through your browser's own settings. No cookie is ever set.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Hosting</h2>
<p>${e(site.name)} is a static site hosted on GitHub Pages. Serving any page on the web involves
the host's infrastructure logging ordinary request data — an IP address, a browser's user
agent, the page requested, a timestamp — the same way any web server does. That logging is
GitHub's, not this site's; ${e(site.name)} has no access to it and no analytics dashboard of its
own. See <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener">GitHub's own privacy statement</a>
for what they do with it.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Links and corrections</h2>
<p>Every source link on this site leads to a third party's website, with its own privacy
practices this policy has no say over. The correction and takedown process in
<a href="${R.rel(0, 'legal.html')}">Legal</a> runs through GitHub Issues, a separate GitHub-hosted
service — anything you post there is subject to GitHub's own terms and privacy policy, not
this one, and is public.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Children</h2>
<p>The site collects no personal information from anyone, including children, because it
collects no personal information from anyone.</p>

<h2 style="font-size:1.3rem;margin:34px 0 12px">Changes</h2>
<p>If this ever changes — if the site ever adds analytics, an embed, or any form that collects
data — this page will say so, with a date, before it happens rather than after.</p>

${legalFooter(ctx)}
</div>
</section>
</div>`;

  return R.page(ctx, {
    depth: 0,
    canonical: 'privacy.html',
    title: `Privacy — ${site.name}`,
    description: `${site.name} collects no personal data. Here is exactly what is and isn't stored.`,
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

function renderSitemap(editions, entities, digests, wireHistory) {
  const urls = [
    { loc: `${site.baseUrl}/`, priority: '1.0', freq: 'daily' },
    { loc: `${site.baseUrl}/archive.html`, priority: '0.6', freq: 'daily' },
    { loc: `${site.baseUrl}/topics.html`, priority: '0.6', freq: 'daily' },
    { loc: `${site.baseUrl}/search.html`, priority: '0.5', freq: 'weekly' },
    ...(digests.length ? [{ loc: `${site.baseUrl}/digest.html`, priority: '0.6', freq: 'hourly' }] : []),
    ...digests.map((d) => ({
      loc: `${site.baseUrl}/${digestPath(d.edition.date)}`,
      priority: '0.4',
      freq: 'weekly',
      lastmod: d.edition.date,
    })),
    ...wireHistory.map((w) => ({
      loc: `${site.baseUrl}/${wirePath(w.date)}`,
      priority: '0.2',
      freq: 'yearly',
      lastmod: w.date,
    })),
    { loc: `${site.baseUrl}/hackathons.html`, priority: '0.7', freq: 'weekly' },
    { loc: `${site.baseUrl}/methodology.html`, priority: '0.4', freq: 'monthly' },
    { loc: `${site.baseUrl}/legal.html`, priority: '0.3', freq: 'yearly' },
    { loc: `${site.baseUrl}/terms.html`, priority: '0.2', freq: 'yearly' },
    { loc: `${site.baseUrl}/privacy.html`, priority: '0.2', freq: 'yearly' },
    ...[...entities.values()].map((ent) => ({
      loc: `${site.baseUrl}/entity/${ent.slug}.html`,
      priority: '0.5',
      freq: 'weekly',
      lastmod: ent.items[0].ed.edition.date,
    })),
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
const candidates = loadLatestCandidates();
// 24 was a cautious number chosen before the wire had a per-source cap, when a single
// high-frequency feed could take most of the page. With that cap in place the extra slots go
// to additional publishers rather than more of the same one, so the ceiling can come up.
const wireItems = selectWireItems(candidates, { limit: 40, sourceBook });

// An SVG mark is inlined so its fill="currentColor" can track the footer's text colour; an
// SVG loaded through <img> gets its own document context, where currentColor resolves to
// black and the mark vanishes against the dark footer. A raster mark has no such trick
// available and is linked normally — site.css inverts it in dark mode instead.
const communityMark =
  site.community?.logo && site.community.logo.endsWith('.svg')
    ? readFileSync(join(ROOT, site.community.logo), 'utf8').replace(/<\?xml[^>]*\?>\s*/, '').trim()
    : null;

// Loaded before the context is built rather than beside the digest pages further down: the
// front page's tier strip prints how many items today's digest holds, and it renders first.
const digests = loadDigests();

const ctx = {
  site,
  communityMark,
  latestDigestCount: digests[0]?.items?.length || null,
  beats,
  beatMap,
  sourceBook,
  latestDate: latest.edition.date,
  generatedAt: latest.edition.generatedAt,
  wireItems,
  harvestedAt: candidates?.harvestedAt || null,
  // Measured against the harvest rather than the wall clock, so the build stays a pure
  // function of its inputs and CI's determinism check keeps passing.
  hoursSinceEdition: candidates?.harvestedAt
    ? Math.max(0, (Date.parse(candidates.harvestedAt) - Date.parse(latest.edition.generatedAt)) / 3600000)
    : 0,
};

// Record what the wire showed today, keyed to the harvest's own date so this stays a pure
// function of committed inputs rather than the wall clock. See snapshotWire() in wire.mjs —
// this is the only reason a reader can ever ask "what did the wire show on the 14th".
if (ctx.harvestedAt) {
  snapshotWire(wireItems, {
    date: ctx.harvestedAt.slice(0, 10),
    harvestedAt: ctx.harvestedAt,
    outDir: OUT('generated', 'wire'),
  });
}
const wireHistory = loadWireHistory(OUT('generated', 'wire'));

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

// One page per topic, plus the index.
const entities = collectEntities(editions);
for (const ent of entities.values()) {
  write(`entity/${ent.slug}.html`, renderEntity(ctx, ent));
}

// Same pattern as the AI edition: every digest gets a permanent dated page, and the
// newest one is additionally the thing digest.html shows.
digests.forEach((d, i) => {
  write(digestPath(d.edition.date), renderDigestPage(ctx, digests, { index: i, isLatest: false }));
});
if (digests.length) {
  write(digestPath(null), renderDigestPage(ctx, digests, { index: 0, isLatest: true }));
}

// One archived page per day the wire has a snapshot for. No "latest" alias here — the live,
// current wire already lives embedded on the front page; these dated pages are the record.
wireHistory.forEach((snap, i) => {
  write(wirePath(snap.date), renderWirePage(ctx, wireHistory, { index: i }));
});

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
const expectedEntityFiles = new Set([...entities.values()].map((ent) => `${ent.slug}.html`));
prune('story', '.html', expectedStoryFiles);
prune('assets/img/covers', '.svg', expectedCovers);
prune('entity', '.html', expectedEntityFiles);
prune('digest', '.html', new Set(digests.map((d) => `${d.edition.date}.html`)));
prune('wire', '.html', new Set(wireHistory.map((w) => `${w.date}.html`)));

write('archive.html', renderArchive(ctx, editions, digests, wireHistory));
write('topics.html', renderTopics(ctx, entities));
write('search.html', renderSearch(ctx));
write('hackathons.html', renderHackathons(ctx, editions));
write('methodology.html', renderMethodology(ctx, editions));
write('legal.html', renderLegal(ctx));
write('terms.html', renderTerms(ctx));
write('privacy.html', renderPrivacy(ctx));
write('404.html', render404(ctx));
write('rss.xml', renderRSS(editions));
write('sitemap.xml', renderSitemap(editions, entities, digests, wireHistory));
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site.baseUrl}/sitemap.xml\n`);
write('.nojekyll', '');

// llms.txt (see llmstxt.org) — an orientation file for language models and agents, in the
// same spirit as robots.txt for crawlers. Lists only endpoints that are actually real: this
// is a static site with no server, so there is no query API, search endpoint or MCP server
// to describe, however useful one might be. Regenerated on every build from the same
// editions array everything else on the site uses, so the numbers here can't drift from
// what's actually published the way a hand-maintained copy would.
write(
  'llms.txt',
  `# ${site.name}

> ${site.description}

An autonomous editorial pipeline researches, writes, checks against source-tier and
sourcing rules, and publishes every edition — see /methodology.html for exactly what runs
and what it does not claim. The pipeline's model is swappable; each edition records which
one wrote it.

The site publishes at three trust levels, each with its own machine-readable data. Higher
in this list means more checking stands behind it:

1. **Edition** — researched, written and source-checked, one per day. Human-readable at
   /edition/<date>.html, or as data at /generated/<date>.json (schema:
   /schema/edition.schema.json). ${editions.length} editions published; latest is
   ${latest.edition.date} (No. ${latest.edition.number}) at /generated/${latest.edition.date}.json.
2. **Digest** — the same day's headlines clustered and ranked by a deterministic program,
   no model involved. /digest.html, or as data at /generated/digest/<date>.json (schema:
   /schema/digest.schema.json).
3. **Wire** — unedited headlines straight from publisher RSS feeds, refreshed independently
   of the other two tiers and the one that keeps running if the model-driven tiers fail.
   Embedded on the front page; snapshots at /generated/wire/<date>.json.

## Data

- /generated/index.json — manifest of every edition published: date, number, title, story/
  source/primary counts, and the URL of that edition's own JSON. Start here.
- /generated/<date>.json — one edition's full content: every story's headline, deck,
  body, sources (with publisher and tier), confidence label and beat.
- /rss.xml — edition headlines as RSS.
- /sitemap.xml — every URL on the site.

## Citing a story

Each story's permalink (/story/<id>.html) never changes once published — the id in its URL
is permanent, and the archive is a record rather than a live document. Cite the permalink,
not the front page, since the front page's content changes daily. Each story page carries
its own schema.org NewsArticle JSON-LD with full source citations.

## Licence

Content is CC BY-NC-ND 4.0 — see /legal.html. No derivatives means summarising or quoting
with attribution is fine; republishing a rewritten version is not.

## Source

${site.social?.repo || 'See the repository linked from the site footer.'} — the pipeline,
the editorial rules and the validator that gates every edition are all in the open.
`
);

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

// Search index. Every published story, one flat array, deliberately thin — headline, deck,
// beat, entities and date, not the full body — so it stays cheap to fetch even as the
// archive grows into the hundreds. search.html filters this client-side; nothing here talks
// to a server, because there isn't one. Sorted newest-first, the same convention as
// everywhere else, so a tied relevance score still favours the more recent story.
write(
  'generated/search-index.json',
  JSON.stringify(
    editions.flatMap((ed) =>
      ed.stories.map((s) => ({
        id: s.id,
        headline: s.headline,
        deck: s.deck,
        kicker: s.kicker,
        beat: s.beat,
        entities: s.entities || [],
        date: ed.edition.date,
        confidence: s.confidence,
        url: R.storyPath(s),
      }))
    ),
    null,
    0
  )
);

write('generated/latest.json', JSON.stringify(latest, null, 2) + '\n');

console.log(
  `✓ built ${editions.length} edition(s) · ${storyCount} stories · ${coverCount} covers\n` +
    `  front page → edition ${latest.edition.date} (No. ${latest.edition.number})`
);
