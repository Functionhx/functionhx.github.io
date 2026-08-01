let instance;

const loadingText = () => window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...";

const COPY = {
  zh: {
    close: "关闭搜索",
    placeholder: "搜索文章、Spark、项目、工具与页面…",
    loading: "Thinking...",
    ready: "输入关键词开始搜索。",
    semantic: "语义检索已合并",
    unavailable: "语义服务暂不可用，已保留本地全文结果。",
    empty: "没有找到相关内容",
    bodyMatch: "正文",
    tagMatch: "标签",
    semanticMatch: "语义",
    resultCount: (count) => `${count} 条结果`,
  },
  en: {
    close: "Close search",
    placeholder: "Search writing, Spark, projects, tools, and pages…",
    loading: "Thinking...",
    ready: "Type to search.",
    semantic: "Semantic results merged",
    unavailable: "Semantic search is unavailable; local full-text results remain active.",
    empty: "No results",
    bodyMatch: "Body",
    tagMatch: "Tag",
    semanticMatch: "Semantic",
    resultCount: (count) => `${count} results`,
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

const literalTerms = (rawQuery) => {
  const phrase = String(rawQuery || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase) return [];
  const parts = phrase.split(/[\s,，、]+/u).filter(Boolean);
  return [...new Set([phrase, ...parts])].sort((left, right) => right.length - left.length);
};

const literalRanges = (value, rawQuery) => {
  const text = String(value || "").normalize("NFKC");
  const ranges = [];
  for (const term of literalTerms(rawQuery)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "giu");
    for (const match of text.matchAll(expression)) ranges.push({ end: match.index + match[0].length, start: match.index });
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  return ranges.filter((range, index) => !ranges.slice(0, index).some((previous) => previous.start <= range.start && previous.end >= range.end));
};

const appendHighlighted = (node, value, rawQuery) => {
  const text = String(value || "").normalize("NFKC");
  const ranges = literalRanges(text, rawQuery);
  if (!ranges.length) {
    node.textContent = text;
    return false;
  }
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) node.append(document.createTextNode(text.slice(cursor, range.start)));
    node.append(element("mark", "magic-search__match", text.slice(range.start, range.end)));
    cursor = range.end;
  }
  if (cursor < text.length) node.append(document.createTextNode(text.slice(cursor)));
  return true;
};

const evidenceText = (chunk, documentRecord) => {
  const text = String(chunk.text || "").trim();
  const title = String(documentRecord.title || "").trim();
  return normalize(text).startsWith(normalize(title)) ? text.slice(title.length).trim() : text;
};

const snippet = (value, rawQuery, limit = 132) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  const firstMatch = literalRanges(text, rawQuery)[0];
  let start = firstMatch ? Math.max(0, firstMatch.start - Math.floor(limit * 0.34)) : 0;
  let end = Math.min(text.length, start + limit);
  if (end === text.length) start = Math.max(0, end - limit);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
};

class MagicSearch {
  constructor(config) {
    this.config = config;
    this.copy = COPY[config.language];
    this.index = null;
    this.indexPromise = null;
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
    this.dialog.setAttribute("aria-label", this.copy.placeholder);

    const shell = element("div", "magic-search__shell");
    const searchRow = element("div", "magic-search__query");
    const searchIcon = element("span", "magic-search__query-icon");
    searchIcon.setAttribute("aria-hidden", "true");
    this.input = element("input", "magic-search__input");
    this.input.type = "search";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.placeholder = this.copy.placeholder;
    this.input.setAttribute("aria-label", this.copy.placeholder);
    this.input.addEventListener("input", () => this.handleInput());
    this.input.addEventListener("keydown", (event) => this.handleKeys(event));
    const close = element("button", "magic-search__escape", "esc");
    close.type = "button";
    close.setAttribute("aria-label", this.copy.close);
    close.addEventListener("click", () => this.dialog.close());
    searchRow.append(searchIcon, this.input, close);

    this.status = element("p", "magic-search__status", loadingText());
    this.status.setAttribute("aria-live", "polite");
    this.results = element("ol", "magic-search__results");
    this.results.setAttribute("aria-label", this.copy.resultCount(0));

    shell.append(searchRow, this.status, this.results);
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
          return index;
        });
    }
    return this.indexPromise;
  }

  async show(initialQuery = "") {
    if (!this.dialog.open) this.dialog.showModal();
    this.input.value = initialQuery;
    this.input.focus();
    this.results.replaceChildren();
    this.dialog.classList.remove("has-results");
    this.status.textContent = loadingText();
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
    if (!query) return [];

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
    if (!this.semanticResults.length) {
      return this.lexicalResults.map((result) => ({ ...result, lexical: true, semantic: false }));
    }
    const scores = new Map();
    const lexicalChunks = new Set(this.lexicalResults.map((result) => result.chunkIndex));
    const semanticChunks = new Set(this.semanticResults.map((result) => result.chunkIndex));
    const lexicalMaximum = Math.max(this.lexicalResults[0]?.score || 1, 1);
    this.lexicalResults.forEach((result, rank) => {
      scores.set(result.chunkIndex, 1 / (60 + rank) + (result.score / lexicalMaximum) * 0.035);
    });
    this.semanticResults.forEach((result, rank) => {
      scores.set(result.chunkIndex, (scores.get(result.chunkIndex) || 0) + 1 / (60 + rank));
    });
    return [...scores.entries()]
      .map(([chunkIndex, score]) => ({
        chunkIndex,
        lexical: lexicalChunks.has(chunkIndex),
        score,
        semantic: semanticChunks.has(chunkIndex),
      }))
      .sort((left, right) => right.score - left.score);
  }

  visibleResults() {
    const seenDocuments = new Set();
    const visible = [];
    for (const result of this.mergedResults()) {
      const chunk = this.index.chunks[result.chunkIndex];
      const document = this.index.documents[chunk.document];
      if (seenDocuments.has(chunk.document)) continue;
      seenDocuments.add(chunk.document);
      visible.push({ ...result, chunk, document });
      if (visible.length === 6) break;
    }
    return visible;
  }

  renderCurrent(semanticSucceeded = false, semanticFailed = false) {
    const visible = this.visibleResults();
    const query = normalize(this.input.value);
    this.activeResult = visible.length ? 0 : -1;
    const nodes = visible.map((result, index) => this.resultNode(result, index));
    if (query && !visible.length) nodes.push(element("li", "magic-search__empty", this.copy.empty));
    this.results.replaceChildren(...nodes);
    this.dialog.classList.toggle("has-results", Boolean(query));
    this.results.setAttribute("aria-label", this.copy.resultCount(visible.length));

    if (!query) this.status.textContent = this.copy.ready;
    else if (!visible.length) this.status.textContent = this.copy.empty;
    else if (semanticSucceeded) this.status.textContent = `${this.copy.resultCount(visible.length)} · ${this.copy.semantic}`;
    else if (semanticFailed) this.status.textContent = `${this.copy.resultCount(visible.length)} · ${this.copy.unavailable}`;
    else this.status.textContent = this.copy.resultCount(visible.length);
  }

  resultNode(result, index) {
    const item = element("li", "magic-search__result");
    const link = element("a", "magic-search__result-link");
    link.href = result.chunk.url;
    link.dataset.resultIndex = String(index);
    link.classList.toggle("is-active", index === 0);

    const rawQuery = this.input.value;
    const title = element("strong", "magic-search__result-title");
    const titleMatched = appendHighlighted(title, result.document.title, rawQuery);
    const path = result.chunk.chain.filter((part) => !(result.chunk.chain.length > 1 && part === result.document.title));
    const source = [...path, result.document.date].filter(Boolean).join(" › ");
    const chain = element("span", "magic-search__chain");
    const chainMatched = appendHighlighted(chain, source, rawQuery);
    link.append(title, chain);

    const content = evidenceText(result.chunk, result.document);
    const contentMatched = literalRanges(content, rawQuery).length > 0;
    const taxonomy = [...(result.chunk.tags || []), ...(result.chunk.categories || [])].join(" · ");
    const taxonomyMatched = literalRanges(taxonomy, rawQuery).length > 0;
    const semanticOnly = result.semantic && !result.lexical && !titleMatched && !chainMatched && !contentMatched && !taxonomyMatched;
    let evidence = "";
    let evidenceLabel = "";
    if (contentMatched || (result.lexical && !titleMatched && !chainMatched && !taxonomyMatched)) {
      evidence = snippet(content || result.chunk.excerpt, rawQuery);
      evidenceLabel = this.copy.bodyMatch;
    } else if (taxonomyMatched) {
      evidence = taxonomy;
      evidenceLabel = this.copy.tagMatch;
    } else if (semanticOnly) {
      evidence = snippet(content || result.chunk.excerpt, rawQuery);
      evidenceLabel = this.copy.semanticMatch;
    }
    if (evidence) {
      const evidenceRow = element("span", "magic-search__evidence");
      evidenceRow.append(element("span", "magic-search__evidence-label", evidenceLabel));
      const evidenceValue = element("span", "magic-search__evidence-text");
      appendHighlighted(evidenceValue, evidence, rawQuery);
      evidenceRow.append(evidenceValue);
      link.append(evidenceRow);
    }
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
    } else if (event.key === "Enter") {
      event.preventDefault();
      links[Math.max(this.activeResult, 0)].click();
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
