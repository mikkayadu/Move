/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

/**
 * Move's service worker does two jobs.
 *
 * It precaches the app shell so the interface opens instantly and still opens
 * at all on a dropped connection - the point being that a cached shell plus a
 * cached last recommendation is a usable app, not an error page. And it
 * receives the departure-window pushes that make Move proactive.
 */
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

interface MovePushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Re-alerting about the same destination should replace, not stack.
      tag: payload.tag ?? 'move',
      renotify: Boolean(payload.tag),
      data: { url: payload.url ?? '/' },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Prefer focusing an open tab over opening a duplicate one.
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});

function readPayload(event: PushEvent): MovePushPayload {
  const fallback: MovePushPayload = {
    title: 'Move',
    body: 'Conditions for one of your trips have changed.',
  };

  if (!event.data) return fallback;

  try {
    return { ...fallback, ...(event.data.json() as Partial<MovePushPayload>) };
  } catch {
    return { ...fallback, body: event.data.text() || fallback.body };
  }
}
