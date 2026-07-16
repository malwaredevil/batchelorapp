/* eslint-disable */
// Service worker for Batchelor Hub PWA
// Handles push events → home-screen badge + system notifications

self.addEventListener("push", function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const unreadCount = data.unreadCount ?? 0;
  const senderName = data.senderName ?? "New message";
  const preview = data.messagePreview ?? "";

  const badgePromise = (async () => {
    try {
      if (unreadCount > 0) {
        await self.navigator.setAppBadge(unreadCount);
      } else {
        await self.navigator.clearAppBadge();
      }
    } catch {
      // Badge API not supported
    }
  })();

  const notifPromise =
    unreadCount > 0
      ? self.registration.showNotification(senderName, {
          body: preview,
          icon: "/icon-192.png",
          badge: "/favicon.svg",
          data: { url: "/modules/office/messenger" },
          tag: "messenger-message",
          renotify: true,
          silent: false,
        })
      : Promise.resolve();

  event.waitUntil(Promise.all([badgePromise, notifPromise]));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/modules/office/messenger";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        for (const client of windowClients) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
