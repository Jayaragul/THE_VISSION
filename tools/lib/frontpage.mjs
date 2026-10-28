import { heroEligible } from './rank.mjs';

// Keep the few visible front-page slots about different events. This only affects
// presentation; the full digest continues to carry every ranked source cluster.
const COMMON = new Set('a an and are as at be by for from has in into is it its more new of on or the to with ai artificial intelligence model models says said'.split(' '));

function headlineWords(title) {
  return new Set(String(title || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(word => word.length > 1 && !COMMON.has(word)));
}

function sameHeadlineEvent(first, second) {
  const a = headlineWords(first.title);
  const b = headlineWords(second.title);
  if (!a.size || !b.size) return false;
  const shared = [...a].filter(word => b.has(word)).length;
  return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.35;
}

export function selectFrontPage(items) {
  const eligible = items.filter(heroEligible);
  const multiPublisher = eligible.filter(item => item.confidence === 'confirmed');
  const hero = (multiPublisher.length ? multiPublisher : eligible.length ? eligible : items)[0] || null;
  const rail = [];
  for (const item of items) {
    if (rail.length === 3) break;
    if (item === hero || /arxiv\.org/.test(item.sources[0]?.url || '')) continue;
    if ([hero, ...rail].some(selected => selected && sameHeadlineEvent(selected, item))) continue;
    rail.push(item);
  }
  return { hero, rail };
}
