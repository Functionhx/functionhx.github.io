(function initializeContrailCard() {
  "use strict";

  // 首页 AI 编程用量卡片。样式与算法照搬 Contrail dashboard 的 StatsPanel 和 ActivityHeatmap
  // （Functionhx/contrail: dashboard/src/ui/dashboard/components/），只取 token 数量，不显示花费。

  const card = document.querySelector("[data-contrail-card]");
  if (!card) return;

  const base = card.getAttribute("data-contrail-base");
  const scroller = card.querySelector("[data-contrail-heatmap]");
  const grid = card.querySelector("[data-contrail-grid]");
  const tooltip = card.querySelector("[data-contrail-tooltip]");

  // 与 ActivityHeatmap.jsx 相同的尺寸：52 周、12px 格子、3px 间距、26px 星期标签列，每周从周日开始。
  const WEEKS = 52;
  const CELL_SIZE = 12;
  const CELL_GAP = 3;
  const LABEL_WIDTH = 26;
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const field = (name) => card.querySelector(`[data-contrail-field="${name}"]`);
  const setField = (name, value) => {
    const node = field(name);
    if (node) node.textContent = value;
  };

  // lib/format.ts 的 formatCompactNumber：一位小数、去掉末尾 0，进位时换下一个单位（999.96M → 1B）。
  function formatCompact(value) {
    const abs = Math.abs(Number(value) || 0);
    if (abs < 1000) return String(Math.round(abs));
    const withSuffix = (number, suffix) => `${Number(number.toFixed(1))}${suffix}`;
    const withCarry = (number, suffix, nextSuffix) => {
      const rounded = Number(number.toFixed(1));
      return rounded >= 1000 ? withSuffix(rounded / 1000, nextSuffix) : `${rounded}${suffix}`;
    };
    if (abs >= 1e12) return withSuffix(abs / 1e12, "T");
    if (abs >= 1e9) return withCarry(abs / 1e9, "B", "T");
    if (abs >= 1e6) return withCarry(abs / 1e6, "M", "B");
    return withCarry(abs / 1e3, "K", "M");
  }

  // 数据按 UTC+8 记日，「今天」也按上海时间算。
  const todayKey = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  const parseDay = (day) => new Date(`${day}T00:00:00Z`);
  const formatDay = (date) => date.toISOString().slice(0, 10);
  const addDays = (date, days) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
  const diffDays = (a, b) => Math.floor((b.getTime() - a.getTime()) / 86400000);

  async function fetchJson(name) {
    const response = await fetch(new URL(`data/${name}`, base), { cache: "no-cache" });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  }

  // 与 Contrail 页面相同：把每台机器的 data/<host>.json 按日相加，token 取含缓存的总量。
  async function loadDays() {
    const hosts = await fetchJson("hosts.json");
    const files = await Promise.all(hosts.map((host) => fetchJson(`${host}.json`)));
    const byDay = new Map();
    for (const file of files) {
      for (const day of file.days || []) {
        const entry = byDay.get(day.date) || { tokens: 0, models: {} };
        for (const row of day.rows || []) {
          const tokens = row.tokensInclCache || 0;
          entry.tokens += tokens;
          entry.models[row.model] = (entry.models[row.model] || 0) + tokens;
        }
        byDay.set(day.date, entry);
      }
    }
    return byDay;
  }

  // lib/activity-heatmap.ts 的 quantile：线性插值后取整。
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const left = sorted[lower];
    const right = sorted[Math.min(sorted.length - 1, lower + 1)];
    return Math.round(left + (right - left) * (position - lower));
  }

  function buildHeatmap(byDay, today) {
    const end = parseDay(today);
    const endWeekStart = addDays(end, -end.getUTCDay());
    const start = addDays(endWeekStart, -7 * (WEEKS - 1));
    const totalDays = diffDays(start, end) + 1;

    const values = [];
    for (let i = 0; i < totalDays; i += 1) {
      const tokens = byDay.get(formatDay(addDays(start, i)))?.tokens || 0;
      if (tokens > 0) values.push(tokens);
    }
    values.sort((a, b) => a - b);
    const t1 = quantile(values, 0.5);
    const t2 = quantile(values, 0.75);
    const t3 = quantile(values, 0.9);
    const levelFor = (value) => {
      if (!value || value <= 0) return 0;
      if (value <= t1) return 1;
      if (value <= t2) return 2;
      if (value <= t3) return 3;
      return 4;
    };

    const weeks = [];
    for (let w = 0; w < Math.ceil(totalDays / 7); w += 1) {
      const week = [];
      for (let d = 0; d < 7; d += 1) {
        const date = addDays(start, w * 7 + d);
        if (date.getTime() > end.getTime()) {
          week.push(null);
          continue;
        }
        const day = formatDay(date);
        const entry = byDay.get(day);
        week.push({
          day,
          value: entry?.tokens || 0,
          models: entry?.models || null,
          level: levelFor(entry?.tokens || 0),
        });
      }
      weeks.push(week);
    }

    // buildMonthMarkers：最近 12 个月的 1 号落在哪一周，就把月份标在那一列。
    const markers = [];
    const used = new Set();
    for (let i = 11; i >= 0; i -= 1) {
      const month = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
      const index = Math.floor(diffDays(start, month) / 7);
      if (index < 0 || index >= weeks.length || used.has(index)) continue;
      used.add(index);
      markers.push({ label: MONTH_LABELS[month.getUTCMonth()], index });
    }
    return { weeks, markers };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderHeatmap({ weeks, markers }) {
    const columns = `${LABEL_WIDTH}px repeat(${weeks.length}, ${CELL_SIZE}px)`;
    grid.style.minWidth = `${LABEL_WIDTH + weeks.length * CELL_SIZE + (weeks.length - 1) * CELL_GAP}px`;

    const months = element("div", "usage-heatmap-months");
    months.style.gridTemplateColumns = columns;
    months.append(element("span"));
    for (const marker of markers) {
      const label = element("span", "", marker.label);
      label.style.gridColumnStart = String(marker.index + 2);
      months.append(label);
    }

    const body = element("div", "usage-heatmap-grid");
    body.style.gridTemplateColumns = columns;
    const days = element("div", "usage-heatmap-days");
    DAY_LABELS.forEach((label) => days.append(element("span", "", label)));
    const cells = element("div", "usage-heatmap-cells");
    weeks.forEach((week) =>
      week.forEach((cell) => {
        if (!cell) return;
        const node = element("span", "usage-cell");
        node.dataset.level = String(cell.level);
        node.addEventListener("mouseenter", () => showTooltip(node, cell));
        node.addEventListener("mouseleave", hideTooltip);
        cells.append(node);
      })
    );
    body.append(days, cells);
    grid.replaceChildren(months, body);
    // 与 Contrail 一样，横向放不下时默认滚到最近几周。
    scroller.scrollLeft = scroller.scrollWidth;
  }

  // 悬停提示照搬 ActivityHeatmap 的 2D tooltip：日期 + Level 徽标、当天 token、按模型拆分。
  function showTooltip(anchor, cell) {
    if (!tooltip) return;
    const header = element("div", "usage-tooltip-header");
    const level = element("span", "usage-tooltip-level", `Level ${cell.level}`);
    level.dataset.level = String(cell.level);
    header.append(element("span", "usage-tooltip-day", cell.day), level);

    const amount = element("div", "usage-tooltip-amount");
    amount.append(element("strong", "", formatCompact(cell.value)), element("span", "", "tokens"));
    tooltip.replaceChildren(header, amount);

    const models = Object.entries(cell.models || {})
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    if (models.length) {
      const list = element("div", "usage-tooltip-models");
      list.append(element("div", "usage-tooltip-caption", "Model Breakdown"));
      for (const [name, value] of models) {
        const percent = Math.round((value / (cell.value || 1)) * 100);
        const row = element("div", "usage-tooltip-model");
        const line = element("div", "usage-tooltip-model-line");
        const figures = element("span", "usage-tooltip-model-figures");
        figures.append(element("b", "", formatCompact(value)), element("small", "", `${percent}%`));
        line.append(element("span", "usage-tooltip-model-name", name), figures);
        const bar = element("div", "usage-tooltip-bar");
        const fill = element("i");
        fill.style.width = `${percent}%`;
        bar.append(fill);
        row.append(line, bar);
        list.append(row);
      }
      tooltip.append(list);
    }

    tooltip.hidden = false;
    const cardBox = card.getBoundingClientRect();
    const cellBox = anchor.getBoundingClientRect();
    const tipBox = tooltip.getBoundingClientRect();
    const center = cellBox.left + cellBox.width / 2 - cardBox.left;
    const left = Math.min(Math.max(center - tipBox.width / 2, 0), cardBox.width - tipBox.width);
    const above = cellBox.top - cardBox.top - tipBox.height - 10;
    const top = above >= 0 ? above : cellBox.bottom - cardBox.top + 10;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  function render(byDay) {
    // 各机器每天发布一次，当天的用量要到第二天才完整：热力图和「近 30 天」都截止到昨天。
    const today = formatDay(addDays(parseDay(todayKey()), -1));
    let total = 0;
    let last30d = 0;
    const from30d = formatDay(addDays(parseDay(today), -29));
    for (const [day, entry] of byDay) {
      if (day > today) continue;
      total += entry.tokens;
      if (day >= from30d && day <= today) last30d += entry.tokens;
    }
    setField("last-30d", formatCompact(last30d));
    setField("total", formatCompact(total));
    const started = [...byDay.keys()].filter((day) => byDay.get(day).tokens > 0).sort()[0];
    if (started) setField("started", started);
    renderHeatmap(buildHeatmap(byDay, today));
    card.setAttribute("data-contrail-state", "ready");
  }

  function start() {
    card.setAttribute("data-contrail-state", "loading");
    loadDays()
      .then(render)
      .catch(() => {
        card.setAttribute("data-contrail-state", "error");
        setField("status", "暂时读不到用量数据，可以直接打开详情页查看。");
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
