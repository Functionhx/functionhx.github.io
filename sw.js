---
layout: null
permalink: /sw.js
sitemap: false
---
/* Function 站点的 Service Worker：让回访和站内切换尽量不走网络。
 *
 * - 带版本号的静态资源（/assets/…?v=内容哈希，以及 jsDelivr 上钉死版本的包）：本地优先。
 *   内容一变链接就变，所以命中缓存的一定是对的，不必再问服务器。
 * - 其它 /assets/ 下的文件（图片、字体、搜索索引）：先用缓存显示，同时在后台更新。
 * - 本站页面：优先取最新；网络 1.2 秒还没回来，就先给上次缓存的版本，后台照样更新。
 * - 其余一律不碰：同域名下别的项目（/contrail/ 等）、GitHub API、站长编辑与登录、非 GET 请求。
 *
 * 每次构建都会生成新的 VERSION，新 Service Worker 接管时清掉旧缓存。
 * 需要紧急停用时，把 KILL_SWITCH 改成 true 发布即可：它会清空缓存并注销自己。
 */
const VERSION = "{{ site.time | date: '%Y%m%d%H%M%S' }}";
const KILL_SWITCH = false;
const STATIC_CACHE = `functionhx-static-${VERSION}`;
const PAGE_CACHE = `functionhx-pages-${VERSION}`;
const PAGE_TIMEOUT = 1200;
const MAX_PAGES = 60;
const MAX_STATIC = 240;

// 构建时写入的本站页面清单：只有这些路径的页面会被缓存，同域名下其它项目的页面不受影响。
/* {%- assign sw_routes = site.html_pages | map: "url" -%}{%- for doc in site.documents -%}{%- assign sw_routes = sw_routes | push: doc.url -%}{%- endfor -%} */
// 注意：必须是单引号字符串，里面的 JSON 自带双引号。
// 分页插件生成的页面地址带 index.html（如 /blog/index.html），统一去掉再比对。
const ROUTES = new Set(JSON.parse('{{ sw_routes | uniq | jsonify }}').map((url) => url.replace(/index\.html$/, "")));

function normalizedPath(url) {
  const path = url.pathname.replace(/index\.html$/, "");
  return path.endsWith("/") || path.includes(".") ? path : `${path}/`;
}

function isVersionedAsset(url) {
  if (url.origin === self.location.origin) return url.pathname.startsWith("/assets/") && url.searchParams.has("v");
  // jsDelivr 上的包都在 URL 里钉死了版本号（name@x.y.z），内容不会变。
  return url.hostname === "cdn.jsdelivr.net" && /@\d+\.\d+\.\d+/.test(url.pathname);
}

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let index = 0; index < keys.length - limit; index += 1) await cache.delete(keys[index]);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // 只缓存正常的响应；跨域的不透明响应在配额里按几 MB 计，不值得存。
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(STATIC_CACHE, MAX_STATIC);
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (response.ok && !response.redirected) await cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

async function networkFirstPage(event) {
  const cache = await caches.open(PAGE_CACHE);
  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    // 经过重定向的响应不能拿来回应导航请求，这种就不存。
    if (response.ok && response.type === "basic" && !response.redirected) {
      await cache.put(event.request, response.clone());
      trim(PAGE_CACHE, MAX_PAGES);
    }
    return response;
  })();
  event.waitUntil(network.catch(() => {}));
  const cached = await cache.match(event.request, { ignoreSearch: true });
  if (!cached) return network;
  // 网络够快就用最新的；慢了先给缓存，后台的请求会把缓存更新好。
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), PAGE_TIMEOUT));
  return Promise.race([network.catch(() => cached), timeout]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("functionhx-") && (KILL_SWITCH || ![STATIC_CACHE, PAGE_CACHE].includes(name)))
          .map((name) => caches.delete(name))
      );
      if (KILL_SWITCH) {
        await self.registration.unregister();
        return;
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })()
  );
});

// 页面把它已经用到的带版本号资源发过来，提前存进缓存（只收本站 /assets/ 下带 ?v= 的地址）。
self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data?.type !== "warm" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls
    .slice(0, 80)
    .map((value) => {
      try {
        return new URL(value, self.location.origin);
      } catch (_error) {
        return null;
      }
    })
    .filter((url) => url && url.origin === self.location.origin && isVersionedAsset(url));
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      for (const url of urls) {
        if (await cache.match(url.href)) continue;
        try {
          const response = await fetch(url.href);
          if (response.ok) await cache.put(url.href, response);
        } catch (_error) {
          // 预热失败没关系，下次用到时会再存。
        }
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (KILL_SWITCH) return;
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    if (url.origin !== self.location.origin || url.search || !ROUTES.has(normalizedPath(url))) return;
    event.respondWith(networkFirstPage(event));
    return;
  }
  if (isVersionedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
