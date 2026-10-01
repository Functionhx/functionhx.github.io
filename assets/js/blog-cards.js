(function initializeBlogCards() {
  "use strict";

  // 博客页的筛选与排序：只在当前页的卡片里筛，不发请求。没有脚本时侧栏保持隐藏，卡片照常显示。
  const filters = document.querySelector(".writing-filters");
  const grid = document.querySelector(".writing-grid");
  if (!filters || !grid) return;
  const cards = [...grid.querySelectorAll(".writing-card")];
  const empty = document.querySelector(".writing-empty");
  const state = { category: "", tag: "", sort: "new" };

  function press(attribute, value) {
    filters.querySelectorAll(`[${attribute}]`).forEach((button) => {
      button.setAttribute("aria-pressed", String(button.getAttribute(attribute) === value));
    });
  }

  function apply() {
    let shown = 0;
    cards.forEach((card) => {
      const categories = (card.dataset.category || "").split("|");
      const visible =
        (!state.category || categories.includes(state.category)) && (!state.tag || (card.dataset.tags || "").includes(`|${state.tag}|`));
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    const ordered = [...cards].sort((a, b) =>
      state.sort === "new" ? b.dataset.date.localeCompare(a.dataset.date) : a.dataset.date.localeCompare(b.dataset.date)
    );
    ordered.forEach((card) => grid.append(card));
    if (empty && cards.length) empty.hidden = shown > 0;
    press("data-writing-category", state.category);
    press("data-writing-tag", state.tag);
    press("data-writing-sort", state.sort);
  }

  filters.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-writing-category")) state.category = button.dataset.writingCategory;
    if (button.hasAttribute("data-writing-tag")) state.tag = button.dataset.writingTag;
    if (button.hasAttribute("data-writing-sort")) state.sort = button.dataset.writingSort;
    apply();
  });

  // 顶部的大号主题链接：点一下就按这个分类筛选，再滚到文章区。
  document.querySelectorAll("[data-writing-topic]").forEach((link) => {
    link.addEventListener("click", () => {
      state.category = link.dataset.writingTopic;
      state.tag = "";
      apply();
    });
  });

  // 窄屏上筛选默认收起，免得把文章挤到第二屏。
  if (window.matchMedia("(max-width: 760px)").matches) {
    filters.querySelectorAll("details[open]").forEach((details) => details.removeAttribute("open"));
  }
  filters.hidden = false;
  apply();
})();
