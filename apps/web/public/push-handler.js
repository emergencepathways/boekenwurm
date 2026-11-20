// Phone notifications: the weekly diary reminder (lib/push.ts) and, for the owner, the usage alert. Loaded into the app's service worker (vite.config.ts, importScripts).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const scope = self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(data.title || "Je wekelijkse dagboek", {
      body: data.body || "Schrijf een paar zinnen in het Nederlands: er wacht een nieuwe vraag op je.",
      icon: scope + "icons/icon-192.png",
      tag: data.tag || "diary-weekly",
      data: { url: scope + (data.path ?? "?open=diary") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const c of all) if ("focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
