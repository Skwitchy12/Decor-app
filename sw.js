const V = "decor-v2";
const SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/widgets/idea-template.json", "/widgets/idea-data.json", "/widgets/ideas.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages: try the network first, fall back to the saved copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(V).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/") || caches.match("/index.html"))
    );
    return;
  }

  // Own files (icons, manifest): saved copy first.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Google Fonts: show the saved copy now, refresh it in the background.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open(V).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || net;
        })
      )
    );
  }
});

/* ---------- Background Sync and Periodic Background Sync ---------- */
async function refreshShell() {
  const c = await caches.open(V);
  await Promise.all(SHELL.map((u) => fetch(u, { cache: "reload" }).then((r) => r.ok && c.put(u, r)).catch(() => {})));
}
self.addEventListener("sync", (e) => {
  if (e.tag === "decor-sync") e.waitUntil(refreshShell());
});
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "decor-refresh") e.waitUntil(Promise.all([refreshShell(), updateAllWidgets()]));
});

/* ---------- Push notifications ---------- */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "DECOR 🪴", {
    body: d.body || "New decor ideas are waiting for you.",
    icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});

/* ---------- Windows widget: idea of the day ---------- */
async function widgetData() {
  try {
    const list = await (await fetch("/widgets/ideas.json")).json();
    const i = list[Math.floor(Date.now() / 864e5) % list.length];
    return JSON.stringify({ title: i.title, description: i.description, url: "/?idea=" + i.id });
  } catch (err) {
    const hit = await caches.match("/widgets/idea-data.json");
    return hit ? hit.text() : "{}";
  }
}
async function updateWidget(w) {
  if (!self.widgets) return;
  const template = await (await fetch(w.definition.msAcTemplate)).text();
  await self.widgets.updateByInstanceId(w.instanceId, { template, data: await widgetData() });
}
async function updateAllWidgets() {
  if (!self.widgets) return;
  const ws = await self.widgets.getByTag("idea-of-the-day");
  await Promise.all(ws.map(updateWidget));
}
self.addEventListener("widgetinstall", (e) => e.waitUntil(updateWidget(e.widget)));
self.addEventListener("widgetresume", (e) => e.waitUntil(updateWidget(e.widget)));
