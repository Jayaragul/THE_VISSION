import { isAiRelevant, hostOf } from './util.mjs';

// Freshness is an admission rule, not merely a ranking penalty. Use the collection
// clock so a deterministic rerun cannot make old stories new or admit future leads.
export function isFresh(item, now, maxAgeHours = 48) {
  const time = Date.parse(item.publishedAt || '');
  return Number.isFinite(time) && Number.isFinite(now) && time <= now && now - time <= maxAgeHours * 3600000;
}

export function newsworthy(item) {
  if (!item.url || !/^https:\/\//i.test(item.url)) return false;
  if (item.source === 'Hugging Face — trending models') return false;
  if (/\/(presented|sponsored|advertorial)\//i.test(item.url)) return false;
  if ((item.categories || []).some(category => /^(sponsored|advertorial|paid content|partner content)$/i.test(category.trim()))) return false;
  // This saved harvest predates category parsing. These four publisher pages disclose
  // EXL, Vanguard, Celonis or Western Digital sponsorship, so reject their exact URLs.
  if (/^https:\/\/(?:www\.)?technologyreview\.com\/2026\/10\/22\/(?:1146109|1146103|1146812|1146948)\//i.test(item.url)) return false;
  if (/\b(buying guide|which models to buy|best .{0,50}(laptops?|phones?|deals)|deals of the week)\b/i.test(item.title || '')) return false;
  // Only a separately reviewed, versioned input may supply this explicit override.
  return item.reviewed === true || isAiRelevant(item.title);
}

export function publisherGroup(item) {
  const host = hostOf(item.url) || '';
  if (host === 'arxiv.org') return 'arXiv';
  if (/(^|\.)(google\.com|blog\.google|deepmind\.google|google\.dev|youtube\.com)$/.test(host)) return 'Alphabet';
  if (/(^|\.)(amazon\.com|amazon\.science)$/.test(host)) return 'Amazon';
  if (/(^|\.)(fb\.com|meta\.com)$/.test(host)) return 'Meta';
  if (/(^|\.)(microsoft\.com|github\.blog)$/.test(host)) return 'Microsoft';
  return String(item.publisher || item.source || host).toLowerCase();
}

// Validate curated additions before they can bypass title-only relevance/classification.
// A source check means the announcement was read, not that a vendor claim was reproduced.
export function reviewedLeads(doc, now, maxAgeHours = 48) {
  return (doc?.items || []).filter(item => {
    if (!item.title || !item.url || !item.publishedAt || !item.reviewedAt || !item.note || !item.beat) {
      throw new Error('Reviewed lead is missing source-review fields');
    }
    const checked = Date.parse(item.reviewedAt);
    if (!/^https:\/\//.test(item.url) || !Number.isFinite(checked) || checked > now) return false;
    return isFresh(item, now, maxAgeHours);
  }).map(item => ({ ...item, reviewed: true, discoveryOnly: false }));
}

// Anthropic has no first-party RSS feed. Read only explicitly dated newsroom rows;
// never infer publication dates from sitemap modification times or the harvest clock.
export function parseAnthropicNews(html) {
  const text = String(html).replace(/\\"/g, '"');
  const rows = [...text.matchAll(/class="[^"]*details-meta"[^>]*>\s*<div>([A-Z][a-z]{2} \d{1,2}, \d{4})<\/div>[\s\S]*?class="[^"]*details-title"[^>]*href="(\/news\/[a-z0-9-]+)"[^>]*>\s*<h3[^>]*>([^<]+)<\/h3>/g)];
  const seen = new Set();
  return rows.flatMap(([, date, path, title]) => {
    const published = Date.parse(date + ' 00:00:00 GMT');
    if (!Number.isFinite(published) || seen.has(path)) return [];
    seen.add(path);
    return [{ title: title.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => { const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; }).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&[rl]squo;/g, "'"), url: 'https://www.anthropic.com' + path,
      publishedAt: new Date(published).toISOString(), datePrecision: 'day', summary: null }];
  });
}
