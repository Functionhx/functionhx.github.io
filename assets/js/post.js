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

  let active = -1;
  const update = () => {
    if (content && progress) {
      const top = content.getBoundingClientRect().top + window.scrollY;
      const span = Math.max(1, content.offsetHeight - window.innerHeight * 0.6);
      const ratio = Math.min(1, Math.max(0, (window.scrollY - top + window.innerHeight * 0.3) / span));
      const filled = Math.round(ratio * BAR);
      progress.children[0].textContent = "▓".repeat(filled);
      progress.children[1].textContent = "░".repeat(BAR - filled);
      progress.children[2].textContent = `${String(Math.round(ratio * 100)).padStart(2, "0")}%`;
    }
    railTitle?.classList.toggle("is-on", hero.getBoundingClientRect().bottom < 0);

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
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  update();

  const copyLink = document.getElementById("post-copy-link");
  if (copyLink && navigator.clipboard) {
    copyLink.hidden = false;
    copyLink.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href.split("#")[0]);
        copyLink.textContent = "已复制";
      } catch {
        copyLink.textContent = "复制失败";
      }
      window.setTimeout(() => {
        copyLink.textContent = "复制链接";
      }, 1400);
    });
  }
})();
