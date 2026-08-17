// A deliberately small RSS/Atom parser — regex-based, not a real XML parser. It exists to
// pull {title, url, publishedAt, summary} out of the handful of feed shapes real-world
// publishers actually use, for tools/harvest.mjs. It is not spec-complete: a feed shaped
// unusually enough to defeat it just yields zero items for that run, same as a feed that
// is unreachable. That keeps the toolchain at zero dependencies, per the rule in CLAUDE.md
// — a real XML parser is a dependency, and this only ever needs to read, never write.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…',
};

function decodeEntities(str) {
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent] ?? whole;
  });
}

function unwrapCDATA(str) {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(str);
  return m ? m[1] : str;
}

function stripTags(str) {
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function field(block, tag) {
  const re = new RegExp(`<${tag}(?:[:\\s][^>]*)?>([\\s\\S]*?)</${tag.split(':').pop()}>`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

function extractLink(block) {
  // Atom gives one or more self-describing <link href="…" rel="…"/> tags. Prefer
  // rel="alternate" (the human-readable page), then whichever has no rel, then whatever
  // is left — some feeds only emit one link and skip rel entirely.
  const atomLinks = [...block.matchAll(/<link\b([^>]*?)\/?>(?:<\/link>)?/gi)]
    .map((m) => {
      const raw = m[1];
      const href = /href\s*=\s*"([^"]*)"/i.exec(raw)?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(raw)?.[1];
      const rel = /rel\s*=\s*"([^"]*)"/i.exec(raw)?.[1] ?? /rel\s*=\s*'([^']*)'/i.exec(raw)?.[1];
      return href ? { href, rel } : null;
    })
    .filter(Boolean);
  if (atomLinks.length) {
    return (
      atomLinks.find((l) => l.rel === 'alternate') || atomLinks.find((l) => !l.rel) || atomLinks[0]
    ).href;
  }
  // RSS gives a plain-text URL as the element's content instead of an attribute.
  const text = field(block, 'link');
  if (text && /^https?:\/\//i.test(text.trim())) return text.trim();
  return null;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const t = Date.parse(stripTags(raw));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** @returns {Array<{title:string,url:string,publishedAt:string|null,summary:string|null}>} */
export function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);

  return blocks
    .map((block) => {
      const rawTitle = field(block, 'title');
      const title = rawTitle ? decodeEntities(stripTags(unwrapCDATA(rawTitle))) : null;
      const url = extractLink(block);
      const publishedAt = normalizeDate(
        field(block, 'pubDate') || field(block, 'published') || field(block, 'updated') || field(block, 'dc:date')
      );
      const rawSummary = field(block, 'summary') || field(block, 'description') || field(block, 'content');
      const summary = rawSummary
        ? decodeEntities(stripTags(unwrapCDATA(rawSummary))).slice(0, 320) || null
        : null;
      return { title, url, publishedAt, summary };
    })
    .filter((item) => item.title && item.url);
}

/** arXiv's Atom feed puts the arxiv.org abstract page in a <link rel="alternate">, which
 *  extractLink already prefers — parseFeed handles arXiv with no special-casing needed.
 *  Exported anyway as the documented entry point, in case that ever stops being true. */
export const parseArxivFeed = parseFeed;
