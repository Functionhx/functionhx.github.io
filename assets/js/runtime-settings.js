(function initializeRuntimeSettings() {
  "use strict";

  // 站长在站点设置里改的「外观」（字体、加载文案、季节氛围、风力、离开提示延迟、导航间距、彩蛋线索和那封信）
  // 不需要重新构建：它们存在仓库 site-settings 分支的 settings.json 里，页面直接读它。
  // 读不到时（网络不通、GitHub API 限流）沿用上次缓存的值，再不行就用构建时写进页面的值，页面照常可用。
  // 只有栏目的显示与隐藏这类需要重新生成页面的改动，才走「保存并发布」。
  const REPOSITORY = "Functionhx/functionhx.github.io";
  const BRANCH = "site-settings";
  const FILE = "settings.json";
  const CACHE_KEY = "functionhx:runtime-settings:v1";
  const REFRESH_AFTER = 120000;
  const TIMEOUT = 5000;
  const FONTS = new Set(["anthropic-serif", "anthropic-sans", "system", "dyslexic", "wenkai"]);
  const LOADING_COPY = new Set(["thinking", "loading", "thinking-zh", "loading-zh"]);
  const SEASONS = new Set(["off", "auto", "snow", "sakura", "rain", "leaves"]);
  const DENSITIES = new Set(["auto", "compact", "relaxed"]);
  const EGG_IDS = ["turbo", "dog", "terminal", "fx", "love", "night", "idle", "console", "tab", "bottle", "archive", "letter"];
  const BASE64 = /^[A-Za-z0-9+/=]+$/;
  const root = document.documentElement;

  // 只保留认得的字段和取值：这个文件在公开仓库里，别人也能往自己的分支里写，页面只信白名单里的内容。
  function sanitize(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const settings = {};
    if (FONTS.has(source.site_font)) settings.site_font = source.site_font;
    if (LOADING_COPY.has(source.loading_copy)) settings.loading_copy = source.loading_copy;
    if (SEASONS.has(source.season_effect)) settings.season_effect = source.season_effect;
    if (DENSITIES.has(source.navigation_density)) settings.navigation_density = source.navigation_density;
    if (Number.isFinite(source.wind_strength)) settings.wind_strength = Math.round(Math.min(Math.max(source.wind_strength, 0), 200));
    if (Number.isFinite(source.away_title_delay)) settings.away_title_delay = Math.round(Math.min(Math.max(source.away_title_delay, 0), 5000));
    if (typeof source.training_card_visible === "boolean") settings.training_card_visible = source.training_card_visible;
    const eggs = source.eggs && typeof source.eggs === "object" ? source.eggs : null;
    if (eggs) {
      settings.eggs = {};
      if (eggs.public && typeof eggs.public === "object") {
        settings.eggs.public = {};
        for (const id of EGG_IDS) if (typeof eggs.public[id] === "boolean") settings.eggs.public[id] = eggs.public[id];
      }
      if (eggs.letter === null) settings.eggs.letter = null;
      else if (
        eggs.letter &&
        eggs.letter.v === 2 &&
        [eggs.letter.salt, eggs.letter.iv, eggs.letter.data].every((part) => typeof part === "string" && BASE64.test(part))
      ) {
        settings.eggs.letter = { v: 2, salt: eggs.letter.salt, iv: eggs.letter.iv, data: eggs.letter.data };
      }
    }
    return settings;
  }

  function readCache() {
    try {
      const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
      if (!cached || typeof cached !== "object") return null;
      return { fetchedAt: Number(cached.fetchedAt) || 0, settings: sanitize(cached.settings) };
    } catch (_error) {
      return null;
    }
  }

  function writeCache(settings) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), settings }));
    } catch (_error) {
      /* 存不下只是下次多请求一次。 */
    }
  }

  // 把取到的设置应用到当前页面，并记为「已发布」的值：站点设置面板据此判断有没有未保存的修改。
  function apply(settings) {
    const prefs = window.functionhxSitePreferences;
    if (settings.site_font) {
      root.dataset.publishedSiteFont = settings.site_font;
      prefs?.setFont?.(settings.site_font);
    }
    if (settings.loading_copy) {
      root.dataset.publishedLoadingCopy = settings.loading_copy;
      prefs?.setLoadingCopy?.(settings.loading_copy);
    }
    if (settings.navigation_density) root.dataset.navDensity = settings.navigation_density;
    if (settings.wind_strength !== undefined) {
      root.dataset.publishedWindStrength = String(settings.wind_strength);
      window.functionhxSeasons?.setWind?.(settings.wind_strength);
    }
    if (settings.away_title_delay !== undefined) {
      root.dataset.publishedAwayTitleDelay = String(settings.away_title_delay);
      root.dataset.awayTitleDelay = String(settings.away_title_delay);
    }
    if (settings.season_effect) {
      root.dataset.publishedSeasonEffect = settings.season_effect;
      window.functionhxSeasons?.set?.(settings.season_effect);
    }
    if (settings.training_card_visible !== undefined) {
      root.dataset.publishedTrainingCardVisible = String(settings.training_card_visible);
    }
    window.dispatchEvent(new CustomEvent("functionhx:runtime-settings", { detail: { settings } }));
  }

  async function fetchSettings({ token = "", fresh = false } = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const headers = { Accept: "application/vnd.github.raw+json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await window.fetch(`https://api.github.com/repos/${REPOSITORY}/contents/${FILE}?ref=${BRANCH}`, {
        cache: fresh ? "no-store" : "default",
        headers,
        signal: controller.signal,
      });
      if (response.status === 404) return {};
      if (!response.ok) throw new Error(`GitHub API ${response.status}`);
      return sanitize(await response.json());
    } finally {
      window.clearTimeout(timer);
    }
  }

  let inflight = null;
  // 取最新的设置并应用。访客默认两分钟内不重复请求（GitHub 对未登录的请求按 IP 限流）；站长面板用 fresh 跳过缓存。
  function refresh(options = {}) {
    if (inflight && !options.fresh) return inflight;
    const cached = readCache();
    if (!options.fresh && cached && Date.now() - cached.fetchedAt < REFRESH_AFTER) return Promise.resolve(cached.settings);
    inflight = fetchSettings(options)
      .then((settings) => {
        writeCache(settings);
        apply(settings);
        return settings;
      })
      .catch(() => (cached ? cached.settings : null))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  // 站长保存成功后调用：立刻更新本机缓存并应用。
  function store(settings) {
    const clean = sanitize(settings);
    writeCache(clean);
    apply(clean);
    return clean;
  }

  window.functionhxRuntimeSettings = Object.freeze({
    branch: BRANCH,
    current: () => readCache()?.settings || {},
    file: FILE,
    refresh,
    repository: REPOSITORY,
    sanitize,
    store,
  });

  const cached = readCache();
  if (cached) apply(cached.settings);
  const start = () => refresh();
  if (document.readyState === "complete") window.setTimeout(start, 400);
  else window.addEventListener("load", () => window.setTimeout(start, 400), { once: true });
})();
