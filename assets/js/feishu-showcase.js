(function initializeFeishuShowcase() {
  "use strict";

  const root = document.getElementById("feishu-public-library");
  const list = document.getElementById("feishu-public-list");
  const status = document.getElementById("feishu-public-list-status");
  if (!root || !list || !status) return;

  function endpoint() {
    try {
      const parsed = new URL(String(root.dataset.endpoint || ""), window.location.href);
      return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
    } catch (_error) {
      return "";
    }
  }

  function safeDocument(value) {
    const id = String(value?.id || "");
    const title = String(value?.title || "")
      .trim()
      .slice(0, 800);
    const modifiedAt = String(value?.modified_at || "");
    let url;
    try {
      url = new URL(String(value?.url || ""));
    } catch (_error) {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    const officialHost = hostname === "feishu.cn" || hostname.endsWith(".feishu.cn");
    if (
      !/^feishu-file-[0-9a-f]{64}$/.test(id) ||
      !title ||
      !Number.isFinite(Date.parse(modifiedAt)) ||
      url.protocol !== "https:" ||
      !officialHost ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return { id, modifiedAt, title, url: url.toString() };
  }

  function displayTime(value) {
    try {
      return new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en" : "zh-CN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value));
    } catch (_error) {
      return "";
    }
  }

  function render(documents) {
    list.replaceChildren();
    if (!documents.length) {
      root.hidden = true;
      return;
    }
    for (const documentRecord of documents) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const icon = document.createElement("span");
      const glyph = document.createElement("i");
      const title = document.createElement("span");
      const time = document.createElement("time");
      link.href = documentRecord.url;
      link.target = "_blank";
      link.rel = "external noopener noreferrer";
      link.dataset.noPageLoader = "";
      icon.className = "feishu-documents__list-icon";
      icon.setAttribute("aria-hidden", "true");
      glyph.className = "fa-regular fa-file-lines";
      icon.append(glyph);
      title.className = "feishu-documents__list-title";
      title.textContent = documentRecord.title;
      time.dateTime = documentRecord.modifiedAt;
      time.textContent = displayTime(documentRecord.modifiedAt);
      link.append(icon, title, time);
      item.append(link);
      list.append(item);
    }
    status.hidden = true;
    root.hidden = false;
  }

  async function load() {
    const base = endpoint();
    if (!base) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${base}/public/feishu/documents`, {
        cache: "no-cache",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Public Feishu document list failed.");
      const payload = await response.json();
      const documents = (Array.isArray(payload.documents) ? payload.documents : []).map(safeDocument).filter(Boolean);
      documents.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
      render(documents);
    } catch (_error) {
      root.hidden = true;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  window.addEventListener("functionhx:feishu-showcase-updated", () => load().catch(() => undefined));
  load().catch(() => undefined);
})();
