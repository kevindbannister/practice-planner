// A simple per-address rate limit kept in memory. It slows down guessing and floods on a single
// server instance; it is not a substitute for the provider's own sign-in protections, which
// handle the real brute-force defence (clients never type a password into this API).

function createLimiter({ now = () => Date.now(), perMinute = { portal: 120, admin: 240 }, failuresPerMinute = 20 } = {}) {
  const hits = new Map(); // `${kind}|${ip}` -> [timestamps]
  const fails = new Map();
  const recent = (map, key, window = 60000) => {
    const t = now();
    const list = (map.get(key) || []).filter((x) => t - x < window);
    map.set(key, list);
    if (map.size > 5000) for (const k of map.keys()) if (!(map.get(k) || []).some((x) => t - x < window)) map.delete(k);
    return list;
  };
  return {
    allow(ip, kind = "portal") {
      if (recent(fails, ip).length >= failuresPerMinute) return false;
      const list = recent(hits, `${kind}|${ip}`);
      if (list.length >= (perMinute[kind] || 120)) return false;
      list.push(now());
      return true;
    },
    fail(ip) {
      recent(fails, ip).push(now());
    },
  };
}

module.exports = { createLimiter };
