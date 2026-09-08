// The pure accumulation step behind tools/harvest.mjs's feed-health tracking, pulled out so
// it can be unit-tested without a network call: it takes the health map read from disk plus
// this run's results, and returns the next health map plus any feed that has crossed the
// dead-after threshold. harvest.mjs owns reading/writing the file; this owns the arithmetic.
//
// Feeds are keyed by `id`, not by the display name in `feed` — several entries (the Google
// News topic searches) deliberately share one display name for several distinct queries, and
// keying on the name would collapse their histories into one shared, meaningless counter.

/**
 * Folds one run's results into the stored history.
 *
 * Only ids present in `runs` survive into the returned map. `runs` always carries one entry
 * per feed in harvest.mjs's FEEDS — a fetch failure is still an entry — so an id missing from
 * it is a feed that has been removed from FEEDS, and its history is dead weight that would
 * otherwise sit in the file forever accruing nothing.
 */
export function accumulateHealth(prevFeeds, runs, { deadAfter, now = new Date().toISOString() }) {
  const health = {};
  const dead = [];
  for (const r of runs) {
    const prev = prevFeeds[r.id] || { consecutiveFailures: 0, consecutiveEmpty: 0, totalRuns: 0 };
    // A 200 carrying zero items is not a success in any sense that matters — the feed is
    // reachable and contributing nothing, which is the same coverage hole as a 404 wearing a
    // friendlier status code. consecutiveFailures structurally cannot see it, because it
    // resets on any 200, so it is counted separately and judged by summarizeHealth().
    const empty = r.ok && !r.count;
    const entry = {
      feed: r.feed,
      consecutiveFailures: r.ok ? 0 : prev.consecutiveFailures + 1,
      consecutiveEmpty: empty ? (prev.consecutiveEmpty || 0) + 1 : 0,
      totalRuns: prev.totalRuns + 1,
      lastOk: r.ok ? now : prev.lastOk || null,
      lastError: r.ok ? undefined : r.error,
      lastCount: r.count,
    };
    health[r.id] = entry;
    if (entry.consecutiveFailures >= deadAfter) dead.push({ id: r.id, ...entry });
  }
  return { health, dead };
}

/**
 * Classifies stored feed health for the weekly maintenance report. Applies thresholds to what
 * harvest.mjs already recorded and makes no new judgement of its own.
 *
 * Three states, deliberately distinct because the response to each differs:
 *
 *   dead      — past the same threshold harvest.mjs shouts about. Fix the URL or remove it.
 *   degrading — failing, but not dead yet. This is the one that earns the check: it is a
 *               week's notice that a feed is on its way out, so it gets dealt with on a
 *               Monday instead of being discovered when it finally breaks something.
 *   silent    — reachable, returning nothing, run after run. Not necessarily broken: a narrow
 *               Google News query genuinely can match nothing for days. But a feed that has
 *               contributed nothing for this long is not earning its request either, and the
 *               only way to tell those two apart is for a human to look at it.
 *
 * `silent` is reported next to the others rather than folded into them precisely because it
 * is the ambiguous one — a prompt to look, not a defect.
 */
export function summarizeHealth(feeds, { deadAfter, degradedAfter, silentAfter }) {
  const dead = [];
  const degrading = [];
  const silent = [];

  for (const [id, f] of Object.entries(feeds || {})) {
    const row = { id, ...f };
    const fails = f.consecutiveFailures || 0;
    if (fails >= deadAfter) dead.push(row);
    else if (fails >= degradedAfter) degrading.push(row);
    // Checked independently of the failure state: a feed can only accrue empty runs while it
    // is succeeding, so no feed is ever both silent and failing on the same run.
    if ((f.consecutiveEmpty || 0) >= silentAfter) silent.push(row);
  }

  const worstFirst = (key) => (a, b) => (b[key] || 0) - (a[key] || 0);
  dead.sort(worstFirst('consecutiveFailures'));
  degrading.sort(worstFirst('consecutiveFailures'));
  silent.sort(worstFirst('consecutiveEmpty'));

  return { dead, degrading, silent };
}
