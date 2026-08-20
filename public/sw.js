const CACHE_NAME = 'parking-assist-v22'
const BASE_PATH = new URL('./', self.registration.scope).pathname
const APP_SHELL = [BASE_PATH, `${BASE_PATH}index.html`, `${BASE_PATH}manifest.webmanifest`, `${BASE_PATH}icon.svg`]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))))
  self.clients.claim()
})

async function fetchAndCache(request) {
  const response = await fetch(request)
  if (response.ok) {
    const copy = response.clone()
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, copy)
  }
  return response
}

async function firstCached(...requests) {
  for (const request of requests) {
    const cached = await caches.match(request)
    if (cached) return cached
  }
  return Response.error()
}

// HTMLはネットワーク優先。キャッシュ優先にすると、アプリを更新しても
// 古い画面が表示され続けてしまう。オフライン時だけキャッシュを使う。
async function handleDocument(request) {
  try {
    return await fetchAndCache(request)
  } catch {
    return firstCached(request, `${BASE_PATH}index.html`, BASE_PATH)
  }
}

// ビルド後のJS/CSSはファイル名にハッシュが付くため、キャッシュ優先で問題ない。
async function handleAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    return await fetchAndCache(request)
  } catch {
    return firstCached(BASE_PATH)
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (new URL(event.request.url).origin !== self.location.origin) return
  const isDocument = event.request.mode === 'navigate' || event.request.destination === 'document'
  event.respondWith(isDocument ? handleDocument(event.request) : handleAsset(event.request))
})
