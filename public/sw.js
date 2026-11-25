/* Only public application assets are cached. Mail, API responses and login pages never enter Cache Storage. */
const PUBLIC_CACHE = "vyncuslim-mail-public-v1";
const PUBLIC_ASSETS = new Map([
  ["/offline.html", "text/html"],
  ["/icons/mail-192.png", "image/png"],
  ["/icons/mail-512.png", "image/png"],
  ["/icons/mail-maskable-512.png", "image/png"],
  ["/icons/apple-touch-icon.png", "image/png"],
  ["/icons/mail-badge.png", "image/png"],
]);

function isPublicAssetResponse(path, response) {
  return response.ok && !response.redirected &&
    (response.headers.get("Content-Type") || "").toLowerCase().startsWith(PUBLIC_ASSETS.get(path));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PUBLIC_CACHE);
    await Promise.all([...PUBLIC_ASSETS.keys()].map(async (path) => {
      try {
        const response = await fetch(path, { cache: "reload", credentials: "omit", redirect: "error" });
        if (isPublicAssetResponse(path, response)) await cache.put(path, response);
      } catch { /* A failed icon download must not block push registration. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("vyncuslim-mail-public-") && key !== PUBLIC_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (PUBLIC_ASSETS.has(url.pathname) && !url.search) {
    event.respondWith((async () => {
      const cache = await caches.open(PUBLIC_CACHE);
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
      const response = await fetch(request);
      if (isPublicAssetResponse(url.pathname, response)) await cache.put(url.pathname, response.clone());
      return response;
    })());
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(PUBLIC_CACHE);
      return (await cache.match("/offline.html")) || new Response("网络暂时不可用。联网后请重新打开邮箱。", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }));
  }
});

function notificationTarget(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password || url.pathname !== "/") return "/";
    const id = url.searchParams.get("notification");
    return id && /^(?:vynalth:)?[A-Za-z0-9_-]{1,128}$/.test(id)
      ? `/?notification=${encodeURIComponent(id)}` : "/";
  } catch { return "/"; }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      const parsed = event.data?.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
    } catch { /* A malformed payload still produces a visible, private notification. */ }
    const url = notificationTarget(payload.url);
    const test = payload.type === "test";
    const body = test ? "通知已连接。此设备可以接收邮箱提醒。" :
      payload.account === "vynalth" ? "Vynalth 企业邮箱收到新邮件，点按查看。" :
      payload.account === "personal" ? "个人邮箱收到新邮件，点按查看。" : "你有新邮件，点按打开邮箱查看。";
    const tag = typeof payload.tag === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(payload.tag)
      ? payload.tag : test ? "vyncuslim-mail-test" : "vyncuslim-mail-new";
    // Always show a notification, including with a visible mailbox. Never expose email content.
    await self.registration.showNotification(test ? "Vyncuslim Mail · 测试通知" : "Vyncuslim Mail", {
      body,
      icon: "/icons/mail-192.png",
      badge: "/icons/mail-badge.png",
      tag,
      data: { url },
    });
    if (!test) {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: "MAIL_RECEIVED" });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const path = notificationTarget(event.notification.data?.url);
    const target = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const sameOrigin = windows.filter((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
    });
    // An existing mailbox can open the message without throwing away an unsent draft.
    const mailbox = sameOrigin.find((client) => new URL(client.url).pathname === "/");
    if (mailbox) {
      mailbox.postMessage({ type: "MAIL_NOTIFICATION_CLICK", url: path });
      await mailbox.focus();
      return;
    }
    if (sameOrigin[0]) {
      const navigated = await sameOrigin[0].navigate(target);
      if (navigated) { await navigated.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLOSE_MAIL_NOTIFICATIONS") return;
  event.waitUntil((async () => {
    const notifications = await self.registration.getNotifications();
    for (const notification of notifications) notification.close();
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" });
  })());
});
