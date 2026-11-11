// A deliberately small service worker. It makes the app installable and lets the screen you already have open keep working through a dropped connection.
// It is NETWORK-FIRST: whenever you are online you always get the current version, so a new release can never be hidden behind an old cached copy.
// The cache is used only when the network fails. It never touches sign-in, SharePoint, Microsoft Graph or /api: only this site's own files.
const CACHE = "xproflow-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== self.location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/.auth/") || u.pathname.startsWith("/portal") || u.pathname.startsWith("/accept")) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(r);
      if (res.ok && res.type === "basic") { const c = await caches.open(CACHE); c.put(r.mode === "navigate" ? "/" : r, res.clone()).catch(() => undefined); }
      return res;
    } catch (err) {
      const c = await caches.open(CACHE);
      const hit = await c.match(r.mode === "navigate" ? "/" : r, { ignoreSearch: r.mode === "navigate" });
      if (hit) return hit;
      throw err;
    }
  })());
});
