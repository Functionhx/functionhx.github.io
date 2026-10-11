(function initializeListen() {
  "use strict";

  // 收听栏目（_includes/listen-series.liquid）。音频只在腾讯云镜像上：在镜像上页内播放，
  // 在其他主机（GitHub Pages）上把每一集改成镜像上同一集的链接，并显示去哪里收听。
  // 只用 localStorage 记住听到哪一集、第几秒；不发其他请求。
  const sections = document.querySelectorAll("[data-listen-series]");
  sections.forEach((section) => {
    const slug = section.dataset.listenSeries;
    const mirror = section.dataset.listenMirror;
    const episodes = [...section.querySelectorAll("[data-listen-episode]")];
    const filterWrap = section.querySelector("[data-listen-filter-wrap]");
    const filter = section.querySelector("[data-listen-filter]");
    const empty = section.querySelector("[data-listen-empty]");

    filterWrap.hidden = false;
    filter.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      let shown = 0;
      episodes.forEach((item) => {
        const visible = !query || item.textContent.toLowerCase().includes(query);
        item.hidden = !visible;
        if (visible) shown += 1;
      });
      empty.hidden = shown > 0;
    });

    let onMirror = false;
    try {
      onMirror = new URL(mirror).origin === window.location.origin;
    } catch {
      onMirror = false;
    }

    if (!onMirror) {
      section.querySelector("[data-listen-away]").hidden = false;
      episodes.forEach((item) => {
        item.querySelector("a").href = `${section.dataset.listenPage}#ep-${item.dataset.listenEpisode}`;
      });
      return;
    }

    const player = section.querySelector("[data-listen-player]");
    const audio = section.querySelector("[data-listen-audio]");
    const nowLabel = section.querySelector("[data-listen-now-label]");
    const nowTitle = section.querySelector("[data-listen-now-title]");
    const resume = section.querySelector("[data-listen-resume]");
    const storageKey = `functionhx:listen:${slug}`;
    let current = -1;
    let rate = 1;
    let lastSaved = 0;

    function load() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
        return saved && typeof saved.n === "string" ? saved : null;
      } catch {
        return null;
      }
    }

    function save(force) {
      if (current < 0) return;
      const now = Date.now();
      if (!force && now - lastSaved < 5000) return;
      lastSaved = now;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ n: episodes[current].dataset.listenEpisode, t: Math.floor(audio.currentTime || 0), rate })
        );
      } catch {
        // 隐私模式等情况下存不了，播放不受影响。
      }
    }

    function titleOf(index) {
      return episodes[index].querySelector(".listen-episode__title").textContent.trim();
    }

    function select(index, { play = true, at = 0 } = {}) {
      if (index < 0 || index >= episodes.length) return;
      episodes.forEach((item, i) => {
        const link = item.querySelector("a");
        if (i === index) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
      current = index;
      const link = episodes[index].querySelector("a");
      audio.src = link.dataset.listenSrc;
      audio.playbackRate = rate;
      nowLabel.textContent = `第 ${episodes[index].dataset.listenEpisode} 集`;
      nowTitle.textContent = titleOf(index);
      resume.hidden = true;
      if (at > 0) {
        audio.addEventListener("loadedmetadata", () => (audio.currentTime = at), { once: true });
      }
      if (play) {
        audio.play().catch(() => {
          // 浏览器拦截了自动播放：控件已就位，访客点一下播放即可。
        });
      } else {
        audio.preload = "metadata";
        audio.load();
      }
      save(true);
    }

    function setRate(value) {
      rate = value;
      audio.playbackRate = value;
      section.querySelectorAll("[data-listen-rate]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.listenRate) === value));
      });
    }

    player.hidden = false;
    episodes.forEach((item, index) => {
      item.querySelector("a").addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        select(index);
        if (window.history.replaceState) window.history.replaceState(null, "", `#ep-${item.dataset.listenEpisode}`);
      });
    });
    section.querySelector("[data-listen-prev]").addEventListener("click", () => select(Math.max(0, current - 1)));
    section.querySelector("[data-listen-next]").addEventListener("click", () => select(Math.min(episodes.length - 1, current + 1)));
    section.querySelectorAll("[data-listen-rate]").forEach((button) => {
      button.addEventListener("click", () => {
        setRate(Number(button.dataset.listenRate));
        save(true);
      });
    });
    audio.addEventListener("timeupdate", () => save(false));
    audio.addEventListener("pause", () => save(true));
    audio.addEventListener("ended", () => {
      if (current + 1 < episodes.length) select(current + 1);
    });
    window.addEventListener("pagehide", () => save(true));

    // 从 GitHub Pages 跳过来的 #ep-NNN：选中那一集（浏览器不允许未经点击就出声，所以不自动播放）。
    const fromHash = window.location.hash.match(/^#ep-(\d+)$/);
    const saved = load();
    if (saved && [1, 1.25, 1.5, 2].includes(saved.rate)) setRate(saved.rate);
    const hashIndex = fromHash ? episodes.findIndex((item) => item.dataset.listenEpisode === fromHash[1]) : -1;
    if (hashIndex >= 0) {
      const at = saved && saved.n === fromHash[1] ? saved.t : 0;
      select(hashIndex, { play: false, at });
      episodes[hashIndex].scrollIntoView({ block: "center" });
    } else if (saved) {
      const savedIndex = episodes.findIndex((item) => item.dataset.listenEpisode === saved.n);
      if (savedIndex >= 0) {
        const minutes = Math.floor(saved.t / 60);
        resume.textContent = `继续收听第 ${saved.n} 集${minutes > 0 ? `（${minutes} 分钟处）` : ""}`;
        resume.hidden = false;
        resume.addEventListener("click", () => select(savedIndex, { at: saved.t }), { once: true });
      }
    }
  });
})();
