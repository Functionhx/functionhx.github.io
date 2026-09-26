(function initializeContrailCard() {
  "use strict";

  const card = document.querySelector("[data-contrail-card]");
  if (!card) return;

  const base = card.getAttribute("data-contrail-base");
  const chart = card.querySelector("[data-contrail-chart]");
  const CHART_DAYS = 30;
  const WEEK_DAYS = 7;

  const field = (name) => card.querySelector(`[data-contrail-field="${name}"]`);
  const setField = (name, value) => {
    const node = field(name);
    if (node) node.textContent = value;
  };

  // 与 Contrail 页面同一口径：数据按 UTC+8 记日，「今天」也按上海时间算。
  const todayKey = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  const shiftDay = (day, delta) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
  };

  function formatTokens(value) {
    if (value >= 1e8) return { number: (value / 1e8).toFixed(value >= 1e10 ? 0 : 1), unit: "亿" };
    if (value >= 1e4) return { number: (value / 1e4).toFixed(value >= 1e6 ? 0 : 1), unit: "万" };
    return { number: String(Math.round(value)), unit: "" };
  }

  const tokensText = (value) => {
    const { number, unit } = formatTokens(value);
    return unit ? `${number} ${unit}` : number;
  };

  const usd = (value) => `$${Math.round(value).toLocaleString("en-US")}`;

  async function fetchJson(name) {
    const response = await fetch(new URL(`data/${name}`, base), { cache: "no-cache" });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  }

  // 与 Contrail 页面相同：把每台机器的 data/<host>.json 按日相加。
  async function loadDays() {
    const hosts = await fetchJson("hosts.json");
    const files = await Promise.all(hosts.map((host) => fetchJson(`${host}.json`)));
    const byDay = new Map();
    let updatedAt = "";
    for (const file of files) {
      if (file.updatedAt && file.updatedAt > updatedAt) updatedAt = file.updatedAt;
      for (const day of file.days || []) {
        const entry = byDay.get(day.date) || { tokens: 0, cost: 0 };
        entry.tokens += day.tokensInclCache || 0;
        entry.cost += day.cost || 0;
        byDay.set(day.date, entry);
      }
    }
    return { byDay, updatedAt };
  }

  function renderTotal(value) {
    const node = field("total");
    if (!node) return;
    const { number, unit } = formatTokens(value);
    const unitNode = document.createElement("small");
    unitNode.textContent = unit ? `${unit} tokens` : "tokens";
    node.replaceChildren(document.createTextNode(number), unitNode);
  }

  function renderChart(byDay, today) {
    if (!chart) return;
    const days = [];
    for (let offset = CHART_DAYS - 1; offset >= 0; offset -= 1) {
      const key = shiftDay(today, -offset);
      days.push({ key, tokens: byDay.get(key)?.tokens || 0 });
    }
    const peak = Math.max(...days.map((day) => day.tokens), 1);
    const bars = days.map((day, index) => {
      const bar = document.createElement("span");
      bar.className = "function-contrail-bar";
      if (index === days.length - 1) bar.classList.add("is-latest");
      const ratio = day.tokens / peak;
      bar.style.setProperty("--bar", day.tokens ? Math.max(ratio, 0.03).toFixed(4) : "0");
      bar.title = `${day.key.slice(5).replace("-", ".")} · ${tokensText(day.tokens)} tokens`;
      return bar;
    });
    chart.replaceChildren(...bars);
  }

  function render({ byDay, updatedAt }) {
    const today = todayKey();
    let totalTokens = 0;
    let totalCost = 0;
    let activeDays = 0;
    for (const entry of byDay.values()) {
      totalTokens += entry.tokens;
      totalCost += entry.cost;
      if (entry.tokens > 0) activeDays += 1;
    }
    let weekTokens = 0;
    let weekCost = 0;
    for (let offset = 0; offset < WEEK_DAYS; offset += 1) {
      const entry = byDay.get(shiftDay(today, -offset));
      if (!entry) continue;
      weekTokens += entry.tokens;
      weekCost += entry.cost;
    }

    renderTotal(totalTokens);
    setField("week-tokens", tokensText(weekTokens));
    setField("week-cost", usd(weekCost));
    setField("total-cost", usd(totalCost));
    setField("active-days", `${activeDays} 天`);
    renderChart(byDay, today);

    let meta = "近 30 天每日 token";
    if (updatedAt) {
      const stamp = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(new Date(updatedAt))
        .replace("/", ".");
      meta += ` · 更新于 ${stamp}`;
    }
    setField("meta", meta);
    card.setAttribute("data-contrail-state", "ready");
  }

  function start() {
    card.setAttribute("data-contrail-state", "loading");
    loadDays()
      .then(render)
      .catch(() => {
        card.setAttribute("data-contrail-state", "error");
        setField("meta", "暂时读不到用量数据，可以直接打开详情页查看。");
      });
  }

  // 首页首屏不为这张卡片发请求：接近视口时再加载数据。
  if (!("IntersectionObserver" in window)) {
    start();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    },
    { rootMargin: "400px 0px" }
  );
  observer.observe(card);
})();
