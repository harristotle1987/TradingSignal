// Production Service Worker for Trading Signal AI
// STRICT RULE: NEVER cache live prices, trading signals, API responses, or Firebase data.
// Only safe static application shell assets (HTML, CSS, JS, icons) are cached.

const CACHE_NAME = 'trading-signal-ai-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable.png',
  '/apple-touch-icon.png'
];

// Install Event - Pre-cache App Shell assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static app shell assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      // Force the waiting service worker to become the active service worker
      return self.skipWaiting();
    })
  );
});

// Activate Event - Clean up all previous/stale cache versions immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Purging outdated static cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      // Claim clients immediately so updates take effect without page restart
      return self.clients.claim();
    })
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. NON-GET or EXTERNAL/CROSS-ORIGIN REQUESTS: bypass cache completely
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // 2. CRITICAL DIRECTIVE: NEVER CACHE LIVE PRICES, SIGNALS, OR API RESPONSES
  // All /api/* routes must ALWAYS go to the live network (Network-Only).
  // Under no circumstances should cached/stale signals or prices be returned.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch((err) => {
        console.warn('[Service Worker] Network error fetching live trading endpoint:', url.pathname);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Network connection unavailable. Live trading data requires an active connection.',
            offline: true,
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // 3. STATIC ASSETS & APP SHELL: Network-First for HTML (to guarantee fresh bundle hashes), Stale-While-Revalidate for bundled assets & images
  if (url.pathname === '/' || url.pathname === '/index.html') {
    // Always fetch fresh HTML to prevent stale script hashes
    event.respondWith(
      fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return networkResponse;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // For static assets (JS bundles, CSS, images, icons): Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // Silently handle background revalidation failure when offline
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// Listen for messages from frontend client to trigger skipWaiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ============================================================================
// WEB PUSH NOTIFICATION EVENT HANDLERS
// ============================================================================

// Push Event - Triggered when the backend Push Notification Service dispatches a message
self.addEventListener('push', (event) => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = {
        title: 'Trading Signal AI Alert',
        body: event.data.text()
      };
    }
  }

  const title = payload.title || '🚨 New Qualified Trading Signal';
  const options = {
    body: payload.body || 'A new verified trading signal setup is ready for execution.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || `trading_signal_${payload.symbol || Date.now()}`,
    data: {
      url: payload.url || (payload.symbol ? `/?view=signals&symbol=${encodeURIComponent(payload.symbol)}` : '/?view=signals'),
      symbol: payload.symbol,
      timestamp: payload.timestamp || Date.now(),
      score: payload.score,
      rankTier: payload.rankTier,
    },
    requireInteraction: payload.requireInteraction ?? true,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open_signal', title: 'Open Signal' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification Click Event - Focuses or opens the relevant signal/log page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetPath = (event.notification.data && event.notification.data.url) 
    ? event.notification.data.url 
    : '/?view=signals';

  const fullUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. If an open tab matches our origin, focus it and navigate to signal
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) {
            client.navigate(fullUrl);
          }
          return client.focus();
        }
      }

      // 2. Otherwise open a new standalone/PWA window
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullUrl);
      }
    })
  );
});
