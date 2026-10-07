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

  // 手机上把侧栏搬进底部面板，宽屏再搬回来；按钮上写着当前的排序和筛选。
  const layout = filters.parentElement;
  const trigger = document.querySelector(".writing-filter-trigger");
  const sheet = document.getElementById("writing-filter-sheet");
  const summary = trigger?.querySelector("[data-writing-summary]");
  const narrow = window.matchMedia("(max-width: 760px)");
  const describe = () => {
    if (!summary) return;
    summary.textContent = [state.sort === "new" ? "最新在前" : "最早在前", state.category, state.tag && `#${state.tag}`].filter(Boolean).join(" · ");
  };
  const place = () => {
    if (!trigger || !sheet) return;
    if (narrow.matches) {
      if (filters.parentElement !== sheet) {
        sheet.append(filters);
        filters.querySelectorAll("details").forEach((details) => {
          details.open = true;
        });
      }
      trigger.hidden = false;
    } else {
      if (sheet.open) sheet.close();
      if (filters.parentElement !== layout) {
        trigger.after(sheet);
        sheet.after(filters);
        filters.querySelectorAll("details").forEach((details) => {
          details.open = details.hasAttribute("data-open-on-wide");
        });
      }
      trigger.hidden = true;
    }
  };
  trigger?.addEventListener("click", () => sheet.showModal());
  sheet?.querySelector("[data-writing-sheet-close]")?.addEventListener("click", () => sheet.close());
  filters.addEventListener("click", describe);
  document.querySelectorAll("[data-writing-topic]").forEach((link) => link.addEventListener("click", describe));
  narrow.addEventListener?.("change", place);

  filters.hidden = false;
  place();
  apply();
  describe();
})();
