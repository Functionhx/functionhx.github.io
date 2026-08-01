let instance;

const COPY = {
  zh: {
    title: "Magic Search ✨",
    close: "关闭搜索",
    placeholder: "搜索文章、闪耀、项目、工具与页面…",
    all: "全部",
    loading: "正在载入全站索引…",
    ready: "输入关键词；结果会定位到对应小节。",
    local: "本地全文检索",
    semantic: "语义检索已合并",
    unavailable: "语义服务暂不可用，已保留本地全文结果。",
    empty: "没有找到匹配内容。可以换一个关键词试试。",
    recent: "最近内容",
    resultCount: (count) => `${count} 条结果`,
    navigate: "打开",
  },
  en: {
    title: "Magic Search ✨",
    close: "Close search",
    placeholder: "Search writing, Spark, projects, tools, and pages…",
    all: "All",
    loading: "Loading the site index…",
    ready: "Type a query; results link to the matching section.",
    local: "Local full-text search",
    semantic: "Semantic results merged",
    unavailable: "Semantic search is unavailable; local full-text results remain active.",
    empty: "No matching content. Try another query.",
    recent: "Recent content",
    resultCount: (count) => `${count} results`,
    navigate: "Open",
  },
};

const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) => {
  const normalized = normalize(value);
  const tokens = normalized.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) || [];
  const sequences = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  for (const sequence of sequences) {
    const characters = Array.from(sequence);
    if (characters.length === 1) tokens.push(characters[0]);
    else {
      for (let index = 0; index < characters.length - 1; index += 1) {
        tokens.push(characters[index] + characters[index + 1]);
      }
    }
  }
  return [...new Set(tokens.filter((token) => token.length <= 64))];
};

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

class MagicSearch {
  constructor(config) {
    this.config = config;
    this.copy = COPY[config.language];
    this.index = null;
    this.indexPromise = null;
    this.scope = "all";
    this.lexicalResults = [];
    this.semanticResults = [];
    this.semanticTimer = 0;
    this.semanticRequest = null;
    this.activeResult = -1;
    this.buildDialog();
  }

  buildDialog() {
    this.dialog = element("dialog", "magic-search");
    this.dialog.id = "magic-search-dialog";
    this.dialog.setAttribute("aria-labelledby", "magic-search-title");

    const shell = element("div", "magic-search__shell");
    const header = element("header", "magic-search__header");
    const identity = element("div", "magic-search__identity");
    const mark = element("span", "magic-search__mark", "ƒ");
    mark.setAttribute("aria-hidden", "true");
    const title = element("h2", "magic-search__title", this.copy.title);
    title.id = "magic-search-title";
    identity.append(mark, title);
    const close = element("button", "magic-search__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", this.copy.close);
    close.addEventListener("click", () => this.dialog.close());
    header.append(identity, close);

    const searchRow = element("div", "magic-search__query");
    const searchIcon = element("span", "magic-search__query-icon", "⌕");
    searchIcon.setAttribute("aria-hidden", "true");
    this.input = element("input", "magic-search__input");
    this.input.type = "search";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.placeholder = this.copy.placeholder;
    this.input.setAttribute("aria-label", this.copy.placeholder);
    this.input.addEventListener("input", () => this.handleInput());
    this.input.addEventListener("keydown", (event) => this.handleKeys(event));
    searchRow.append(searchIcon, this.input);

    this.scopes = element("div", "magic-search__scopes");
    this.scopes.setAttribute("aria-label", this.copy.all);
    this.scopes.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-scope]");
      if (!button) return;
      this.scope = button.dataset.scope;
      this.updateScopeButtons();
      this.renderCurrent();
    });

    this.status = element("p", "magic-search__status", this.copy.loading);
    this.status.setAttribute("aria-live", "polite");
    this.results = element("ol", "magic-search__results");
    this.results.setAttribute("aria-label", this.copy.resultCount(0));

    const footer = element("footer", "magic-search__footer");
    const local = element("span", "", this.copy.local);
    const keys = element("span", "", "↑ ↓  Enter  Esc");
    footer.append(local, keys);

    shell.append(header, searchRow, this.scopes, this.status, this.results, footer);
    this.dialog.append(shell);
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.dialog.addEventListener("close", () => {
      this.semanticRequest?.abort();
      this.activeResult = -1;
    });
    document.body.append(this.dialog);
  }

  async loadIndex() {
    if (!this.indexPromise) {
      this.indexPromise = fetch(this.config.indexUrl, { cache: "no-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`search index ${response.status}`);
          return response.json();
        })
        .then((index) => {
          if (index.version !== 1 || index.language !== this.config.language) {
            throw new Error("incompatible search index");
          }
          this.index = index;
          this.buildScopes();
          return index;
        });
    }
    return this.indexPromise;
  }

  buildScopes() {
    const sections = [...new Set(this.index.documents.map((document) => document.section))];
    const labels = [this.copy.all, ...sections];
    this.scopes.replaceChildren(
      ...labels.map((label, index) => {
        const button = element("button", "magic-search__scope", label);
        button.type = "button";
        button.dataset.scope = index === 0 ? "all" : label;
        return button;
      })
    );
    this.updateScopeButtons();
  }

  updateScopeButtons() {
    for (const button of this.scopes.querySelectorAll("button[data-scope]")) {
      const selected = button.dataset.scope === this.scope;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }

  async show(initialQuery = "") {
    if (!this.dialog.open) this.dialog.showModal();
    this.input.value = initialQuery;
    this.input.focus();
    this.status.textContent = this.copy.loading;
    await this.loadIndex();
    this.handleInput();
  }

  handleInput() {
    if (!this.index) return;
    this.semanticRequest?.abort();
    window.clearTimeout(this.semanticTimer);
    this.semanticResults = [];
    this.lexicalResults = this.searchLexically(this.input.value);
    this.renderCurrent();

    const query = normalize(this.input.value);
    if (query.length < 2 || !this.index.semantic_endpoint) return;
    this.semanticTimer = window.setTimeout(() => this.searchSemantically(query), 320);
  }

  searchLexically(rawQuery) {
    const query = normalize(rawQuery);
    if (!query) return this.recentResults();

    const tokens = tokenize(query);
    const chunkScores = new Map();
    const total = Math.max(this.index.chunk_count, 1);
    const averageLength = Math.max(this.index.average_length, 1);
    const k1 = 1.2;
    const b = 0.75;

    for (const token of tokens) {
      const posting = this.index.postings[token];
      if (!posting) continue;
      const documentFrequency = posting.length;
      const inverseFrequency = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
      for (const [chunkIndex, frequency] of posting) {
        const chunk = this.index.chunks[chunkIndex];
        const denominator = frequency + k1 * (1 - b + b * (chunk.length / averageLength));
        const score = inverseFrequency * ((frequency * (k1 + 1)) / denominator);
        chunkScores.set(chunkIndex, (chunkScores.get(chunkIndex) || 0) + score);
      }
    }

    this.index.chunks.forEach((chunk, chunkIndex) => {
      const title = normalize(chunk.title);
      const chain = normalize(chunk.chain.join(" "));
      const text = normalize(chunk.text);
      let boost = 0;
      if (title === query) boost += 18;
      else if (title.includes(query)) boost += 9;
      if (chain.includes(query)) boost += 5;
      if (text.includes(query)) boost += 1.5;
      if (boost) chunkScores.set(chunkIndex, (chunkScores.get(chunkIndex) || 0) + boost);
    });

    return [...chunkScores.entries()]
      .map(([chunkIndex, score]) => ({ chunkIndex, score }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 60);
  }

  recentResults() {
    return this.index.documents
      .map((document) => ({
        chunkIndex: document.chunk_start,
        score: Number(String(document.date || "").replaceAll("-", "")) || 0,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 24);
  }

  async searchSemantically(query) {
    const controller = new AbortController();
    this.semanticRequest = controller;
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(this.index.semantic_endpoint, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, language: this.config.language, limit: 30 }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`semantic search ${response.status}`);
      const payload = await response.json();
      const lookup = new Map(this.index.chunks.map((chunk, index) => [chunk.id, index]));
      this.semanticResults = (payload.results || [])
        .map((result) => ({ chunkIndex: lookup.get(result.id), score: Number(result.score) || 0 }))
        .filter((result) => result.chunkIndex !== undefined);
      this.renderCurrent(true);
    } catch (error) {
      if (error.name !== "AbortError") this.renderCurrent(false, true);
    } finally {
      window.clearTimeout(timeout);
      if (this.semanticRequest === controller) this.semanticRequest = null;
    }
  }

  mergedResults() {
    if (!this.semanticResults.length) return this.lexicalResults;
    const scores = new Map();
    const lexicalMaximum = Math.max(this.lexicalResults[0]?.score || 1, 1);
    this.lexicalResults.forEach((result, rank) => {
      scores.set(result.chunkIndex, 1 / (60 + rank) + (result.score / lexicalMaximum) * 0.035);
    });
    this.semanticResults.forEach((result, rank) => {
      scores.set(result.chunkIndex, (scores.get(result.chunkIndex) || 0) + 1 / (60 + rank));
    });
    return [...scores.entries()].map(([chunkIndex, score]) => ({ chunkIndex, score })).sort((left, right) => right.score - left.score);
  }

  visibleResults() {
    const seenDocuments = new Set();
    const visible = [];
    for (const result of this.mergedResults()) {
      const chunk = this.index.chunks[result.chunkIndex];
      const document = this.index.documents[chunk.document];
      if (this.scope !== "all" && document.section !== this.scope) continue;
      if (seenDocuments.has(chunk.document)) continue;
      seenDocuments.add(chunk.document);
      visible.push({ ...result, chunk, document });
      if (visible.length === 12) break;
    }
    return visible;
  }

  renderCurrent(semanticSucceeded = false, semanticFailed = false) {
    const visible = this.visibleResults();
    const query = normalize(this.input.value);
    this.activeResult = -1;
    this.results.replaceChildren(...visible.map((result, index) => this.resultNode(result, index)));
    this.results.setAttribute("aria-label", this.copy.resultCount(visible.length));

    if (!visible.length) this.status.textContent = this.copy.empty;
    else if (!query) this.status.textContent = `${this.copy.recent} · ${this.copy.resultCount(visible.length)}`;
    else if (semanticSucceeded) this.status.textContent = `${this.copy.resultCount(visible.length)} · ${this.copy.semantic}`;
    else if (semanticFailed) this.status.textContent = `${this.copy.resultCount(visible.length)} · ${this.copy.unavailable}`;
    else this.status.textContent = this.copy.resultCount(visible.length);
  }

  resultNode(result, index) {
    const item = element("li", "magic-search__result");
    const link = element("a", "magic-search__result-link");
    link.href = result.chunk.url;
    link.dataset.resultIndex = String(index);

    const chain = element("span", "magic-search__chain", result.chunk.chain.join(" → "));
    const title = element("strong", "magic-search__result-title", result.document.title);
    const excerpt = element("span", "magic-search__excerpt", result.chunk.excerpt);
    const meta = element("span", "magic-search__meta");
    const details = [result.document.date, ...result.document.tags.slice(0, 3)].filter(Boolean).join(" · ");
    meta.textContent = details || this.copy.navigate;
    link.append(chain, title, excerpt, meta);
    item.append(link);
    return item;
  }

  handleKeys(event) {
    const links = [...this.results.querySelectorAll("a[data-result-index]")];
    if (!links.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.activeResult = (this.activeResult + 1) % links.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeResult = (this.activeResult - 1 + links.length) % links.length;
    } else if (event.key === "Enter" && this.activeResult >= 0) {
      event.preventDefault();
      links[this.activeResult].click();
      return;
    } else {
      return;
    }
    links.forEach((link, index) => link.classList.toggle("is-active", index === this.activeResult));
    links[this.activeResult].scrollIntoView({ block: "nearest" });
  }
}

export async function open(config, initialQuery = "") {
  if (!instance || instance.config.language !== config.language) {
    instance?.dialog.remove();
    instance = new MagicSearch(config);
  }
  await instance.show(initialQuery);
}
