(function initializeContrailCard() {
  "use strict";

  const card = document.querySelector("[data-contrail-card]");
  if (!card) return;

  const base = card.getAttribute("data-contrail-base");
  const heatmap = card.querySelector("[data-contrail-heatmap]");
  const grid = card.querySelector("[data-contrail-grid]");
  const link = card.querySelector(".function-contrail-link");
  const MAX_WEEKS = 53;
  const MIN_WEEKS = 13;
  const MIN_CELL = 9;
  const MAX_CELL = 14;
  const CELL_GAP = 3;
  const LABEL_WIDTH = 23; // 20px 标签列 + 一个间距
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
    const scaled = (divisor) => {
      const number = value / divisor;
      return number.toFixed(number >= 10 ? 1 : 2);
    };
    if (value >= 1e9) return { number: scaled(1e9), unit: "billion" };
    if (value >= 1e6) return { number: scaled(1e6), unit: "million" };
    if (value >= 1e3) return { number: scaled(1e3), unit: "thousand" };
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

  // 数字用大字、单位用小字，例如「155.7」+「billion tokens」。
  function setTokens(name, value, suffix = "") {
    const node = field(name);
    if (!node) return;
    const { number, unit } = formatTokens(value);
    const unitNode = document.createElement("small");
    unitNode.textContent = [unit, suffix].filter(Boolean).join(" ");
    node.replaceChildren(document.createTextNode(number), unitNode);
  }

  // 周一为每列第一天（Date.getUTCDay 的周日是 0）。
  const weekdayIndex = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

  // 四分位分级：只看有用量的日子，这样少数几天的峰值不会把其它日子都压成最浅一档。
  function levelScale(values) {
    const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
    if (!sorted.length) return () => 0;
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const cuts = [at(0.25), at(0.5), at(0.75)];
    return (value) => {
      if (value <= 0) return 0;
      return 1 + cuts.filter((cut) => value > cut).length;
    };
  }

  function gridItem(className, column, row, text) {
    const node = document.createElement(text === undefined ? "i" : "span");
    node.className = className;
    node.style.gridColumn = String(column);
    node.style.gridRow = String(row);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 宽屏放一整年；放不下时减少周数，保证格子不小于 MIN_CELL，也不需要横向滚动。
  // 格子边长由 JS 算成固定像素，这样每一行等高，标签行和普通行不会错开。
  function heatmapLayout() {
    const width = heatmap ? heatmap.clientWidth : 0;
    if (!width) return { weeks: MAX_WEEKS, cell: 10 };
    const fit = Math.floor((width - LABEL_WIDTH) / (MIN_CELL + CELL_GAP));
    const weeks = Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, fit));
    const cell = Math.min(MAX_CELL, (width - LABEL_WIDTH) / weeks - CELL_GAP);
    return { weeks, cell: Math.floor(cell * 10) / 10 };
  }

  function renderHeatmap(byDay, today, { weeks, cell }) {
    if (!grid) return;
    const start = shiftDay(today, -(weekdayIndex(today) + (weeks - 1) * WEEK_DAYS));
    const days = [];
    for (let day = start; day <= today; day = shiftDay(day, 1)) {
      const entry = byDay.get(day);
      days.push({ day, tokens: entry?.tokens || 0, cost: entry?.cost || 0 });
    }
    const level = levelScale(days.map((item) => item.tokens));
    const monthOf = (index) => Number(days[index].day.slice(5, 7));

    const nodes = [];
    [
      ["一", 2],
      ["三", 4],
      ["五", 6],
    ].forEach(([label, row]) => nodes.push(gridItem("function-contrail-weekday", 1, row, label)));

    let lastMonthColumn = -Infinity;
    days.forEach((item, index) => {
      const week = Math.floor(index / WEEK_DAYS);
      const column = week + 2;
      const weekday = index % WEEK_DAYS;
      // 月份标在该月第一周上方。两个标签至少隔 3 列；第一列若紧跟着就换月，让给下一个月。
      if (weekday === 0 && week < weeks - 1) {
        const month = monthOf(index);
        const isNewMonth = week === 0 || month !== monthOf(index - WEEK_DAYS);
        const nextSoon = week === 0 && index + 2 * WEEK_DAYS < days.length && monthOf(index + 2 * WEEK_DAYS) !== month;
        if (isNewMonth && !nextSoon && column - lastMonthColumn >= 3) {
          nodes.push(gridItem("function-contrail-month", column, 1, `${month}月`));
          lastMonthColumn = column;
        }
      }
      const cell = gridItem("function-contrail-cell", column, weekday + 2);
      cell.dataset.level = String(level(item.tokens));
      const date = item.day.replaceAll("-", ".");
      cell.title = item.tokens ? `${date} · ${tokensText(item.tokens)} tokens · ${usd(item.cost)}` : `${date} · 无用量`;
      nodes.push(cell);
    });

    grid.style.setProperty("--contrail-weeks", String(weeks));
    grid.style.setProperty("--contrail-cell", `${cell}px`);
    grid.replaceChildren(...nodes);
  }

  function metaText(weeks, updatedAt) {
    let meta = weeks >= 52 ? "过去一年每日 token" : `最近 ${weeks} 周每日 token`;
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
    return meta;
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

    setTokens("total", totalTokens, "tokens");
    setTokens("week-tokens", weekTokens);
    setField("week-cost", usd(weekCost));
    setField("total-cost", usd(totalCost));
    setField("active-days", `${activeDays} 天`);
    let layout = heatmapLayout();
    renderHeatmap(byDay, today, layout);
    if (heatmap && "ResizeObserver" in window) {
      new ResizeObserver(() => {
        const next = heatmapLayout();
        if (next.weeks === layout.weeks && next.cell === layout.cell) return;
        layout = next;
        renderHeatmap(byDay, today, layout);
        setField("meta", metaText(layout.weeks, updatedAt));
      }).observe(heatmap);
    }

    const firstDay = [...byDay.keys()].filter((day) => byDay.get(day).tokens > 0).sort()[0];
    if (firstDay) setField("since", `自 ${firstDay.replaceAll("-", ".")} 起累计`);

    setField("meta", metaText(layout.weeks, updatedAt));
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

  // 热力图盖在整卡链接之上（为了让格子的悬停提示可用），点它同样进入详情页。
  if (heatmap && link) heatmap.addEventListener("click", () => link.click());

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
