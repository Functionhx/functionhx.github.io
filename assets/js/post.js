// Article rail: reading progress, active section, and the title that fades in
// once the hero has scrolled away. The tree itself is rendered by the layout,
// so without JavaScript the page keeps a working table of contents.
(() => {
  const article = document.querySelector(".post--article");
  if (!article) return;

  const hero = article.querySelector(".post-hero");
  const content = article.querySelector("#markdown-content");
  const railTitle = document.getElementById("post-rail-title");
  const progress = document.getElementById("post-rail-progress");
  const links = [...article.querySelectorAll("#post-tree a")];
  const headings = links.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1)))).filter(Boolean);
  const BAR = 28;

  // Code blocks: a mono header with the language. The theme's copy button is
  // added later by its own script; CSS places it over this header row.
  content?.querySelectorAll("div.highlighter-rouge").forEach((block) => {
    const language = [...block.classList].find((name) => name.startsWith("language-"))?.slice(9) || "text";
    const head = document.createElement("div");
    head.className = "post-code__head";
    head.textContent = language === "plaintext" ? "text" : language;
    block.prepend(head);
  });

  // References: paragraphs under a 参考文献 heading read as a hanging list.
  content?.querySelectorAll("h2, h3").forEach((heading) => {
    if (!/参考文献|References/.test(heading.textContent)) return;
    for (let node = heading.nextElementSibling; node && !/^(H2|H3|HR)$/.test(node.tagName); node = node.nextElementSibling) {
      if (node.tagName === "P") node.classList.add("post-refs");
    }
  });

  // 手机阅读条（≤820px，侧栏收起时；见 post.liquid）。
  const dock = document.getElementById("post-dock");
  const dockSection = document.getElementById("post-dock-section");
  const dockPct = document.getElementById("post-dock-pct");
  const dockMeter = dock?.querySelector(".post-dock__meter");
  const sheet = document.getElementById("post-dock-sheet");
  const sheetTree = document.getElementById("post-sheet-tree");
  const sheetPct = sheet?.querySelector(".post-sheet__pct");
  const footer = article.querySelector(".post-footer-nav");
  const narrow = window.matchMedia("(max-width: 820px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const DOCK_BAR = 6;
  const titleText = railTitle?.textContent.trim() || document.title;
  const label = (link) => link.textContent.replace("└", "").trim();
  let lastY = window.scrollY;
  let travel = 0;
  let collapsed = false;
  let scrollingTimer = 0;
  let floorInset = "";

  // 宠物（pet.js）站在阅读条上面，而不是被它挡住。
  const setFloor = (value) => {
    if (value === floorInset) return;
    floorInset = value;
    if (value) root.dataset.floorInset = value;
    else delete root.dataset.floorInset;
    window.dispatchEvent(new Event("functionhx:floor"));
  };

  const readingRatio = () => {
    if (!content) return 0;
    const top = content.getBoundingClientRect().top + window.scrollY;
    const span = Math.max(1, content.offsetHeight - window.innerHeight * 0.6);
    return Math.min(1, Math.max(0, (window.scrollY - top + window.innerHeight * 0.3) / span));
  };

  let active = -1;
  const update = () => {
    const ratio = readingRatio();
    const percent = `${String(Math.round(ratio * 100)).padStart(2, "0")}%`;
    if (content && progress) {
      const filled = Math.round(ratio * BAR);
      progress.children[0].textContent = "▓".repeat(filled);
      progress.children[1].textContent = "░".repeat(BAR - filled);
      progress.children[2].textContent = percent;
    }
    const pastHero = hero.getBoundingClientRect().bottom < 0;
    railTitle?.classList.toggle("is-on", pastHero);

    let index = headings.length ? 0 : -1;
    headings.forEach((heading, i) => {
      if (heading.getBoundingClientRect().top < window.innerHeight * 0.35) index = i;
    });
    if (index !== active) {
      active = index;
      links.forEach((link, i) => {
        link.classList.toggle("is-active", i === index);
        if (i === index) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }

    // 樱花等季节氛围：读正文时让开（post.css 只在手机上用到）。
    if (pastHero) root.dataset.postZone = "body";
    else delete root.dataset.postZone;

    if (!dock || !narrow.matches) {
      if (dock) dock.hidden = true;
      setFloor("");
      return;
    }
    dock.hidden = false;
    const done = Boolean(footer && footer.getBoundingClientRect().top < window.innerHeight - 40);
    dock.dataset.state = done ? "done" : "reading";
    dock.classList.toggle("is-on", pastHero);
    dock.classList.toggle("is-collapsed", collapsed && !done && !dock.contains(document.activeElement));
    dock.style.setProperty("--post-dock-ratio", ratio.toFixed(4));
    // 还没读到第一个小节时写文章标题（侧栏此时也还高亮着第一节，那是目录的习惯）。
    const beforeFirst = !headings.length || headings[0].getBoundingClientRect().top >= window.innerHeight * 0.35;
    dockSection.textContent = beforeFirst ? titleText : label(links[active]);
    const filled = Math.round(ratio * DOCK_BAR);
    dockMeter.children[0].textContent = "▓".repeat(filled);
    dockMeter.children[1].textContent = "░".repeat(DOCK_BAR - filled);
    dockPct.textContent = percent;
    if (sheetPct) sheetPct.textContent = `已读 ${percent}`;
    setFloor(!pastHero ? "" : dock.classList.contains("is-collapsed") ? "8" : String(Math.round(dock.offsetHeight + 16)));
  };

  if (progress) progress.hidden = false;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  window.addEventListener(
    "scroll",
    () => {
      // 往下读一段收起阅读条，往回滑一点就展开；方向一换就重新累计。
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel > 48) collapsed = true;
      else if (travel < -24) collapsed = false;
      root.dataset.postScrolling = "true";
      window.clearTimeout(scrollingTimer);
      scrollingTimer = window.setTimeout(() => {
        delete root.dataset.postScrolling;
      }, 900);
      schedule();
    },
    { passive: true }
  );
  window.addEventListener("resize", schedule, { passive: true });
  narrow.addEventListener?.("change", () => {
    if (!narrow.matches && sheet?.open) sheet.close();
    schedule();
  });
  dock?.addEventListener("focusin", schedule);
  dock?.addEventListener("focusout", schedule);
  update();

  // 目录面板：从侧栏的目录树复制一份，当前小节高亮并滚到眼前。
  const openSheet = () => {
    if (!sheet || sheet.open) return;
    if (!sheetTree.childElementCount) {
      links.forEach((link) => {
        const copy = link.cloneNode(true);
        copy.removeAttribute("title");
        sheetTree.append(copy);
      });
      if (!links.length) sheetTree.hidden = true;
    }
    [...sheetTree.children].forEach((link, i) => {
      link.classList.toggle("is-active", i === active);
      if (i === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    sheet.showModal();
    sheetTree.children[active]?.scrollIntoView({ block: "center" });
  };
  document.getElementById("post-dock-open")?.addEventListener("click", openSheet);
  sheet?.querySelector("[data-post-sheet-close]")?.addEventListener("click", () => sheet.close());
  sheetTree?.addEventListener("click", (event) => {
    if (event.target.closest("a")) sheet.close();
  });

  article.querySelectorAll("[data-post-top]").forEach((button) => {
    button.addEventListener("click", () => {
      if (sheet?.open) sheet.close();
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
    });
  });

  const copyButtons = [document.getElementById("post-copy-link"), ...article.querySelectorAll("[data-post-copy]")].filter(Boolean);
  if (navigator.clipboard) {
    copyButtons.forEach((button) => {
      const idle = button.textContent;
      button.hidden = false;
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(window.location.href.split("#")[0]);
          button.textContent = "已复制";
        } catch {
          button.textContent = "复制失败";
        }
        window.setTimeout(() => {
          button.textContent = idle;
        }, 1400);
      });
    });
  }
})();
