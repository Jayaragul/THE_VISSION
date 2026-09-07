// The pure accumulation step behind tools/harvest.mjs's feed-health tracking, pulled out so
// it can be unit-tested without a network call: it takes the health map read from disk plus
// this run's results, and returns the next health map plus any feed that has crossed the
// dead-after threshold. harvest.mjs owns reading/writing the file; this owns the arithmetic.
//
// Feeds are keyed by `id`, not by the display name in `feed` — several entries (the Google
// News topic searches) deliberately share one display name for several distinct queries, and
// keying on the name would collapse their histories into one shared, meaningless counter.

export function accumulateHealth(prevFeeds, runs, { deadAfter, now = new Date().toISOString() }) {
  const health = { ...prevFeeds };
  const dead = [];
  for (const r of runs) {
    const prev = health[r.id] || { consecutiveFailures: 0, totalRuns: 0 };
    const entry = {
      feed: r.feed,
      consecutiveFailures: r.ok ? 0 : prev.consecutiveFailures + 1,
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
