'use strict';

/** At most `limit` hits per key in each window: limiter(5, 60_000)(key) → true while allowed. */
function limiter(limit, windowMs) {
  const hits = new Map();
  return (key, cost = 1) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length + cost > limit) {
      hits.set(key, recent);
      return false;
    }
    for (let i = 0; i < cost; i++) recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

module.exports = { limiter };
