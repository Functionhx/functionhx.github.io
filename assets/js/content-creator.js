(function initializeContentCreator() {
  "use strict";

  const root = document.getElementById("site-content-creator");
  if (!root) return;

  const repository = root.dataset.repository;
  const owner = root.dataset.owner;
  const branch = root.dataset.branch;
  const maxCoverBytes = 5 * 1024 * 1024;
  const allowedCoverTypes = new Map([
    ["image/webp", "webp"],
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
  ]);

  const elements = {
    announce: document.getElementById("site-content-creator-announce"),
    announceField: document.getElementById("site-content-creator-announce-field"),
    bodyEn: document.getElementById("site-content-creator-body-en"),
    bodyZh: document.getElementById("site-content-creator-body-zh"),
    category: document.getElementById("site-content-creator-category"),
    categoryField: document.getElementById("site-content-creator-category-field"),
    close: document.getElementById("site-content-creator-close"),
    comments: document.getElementById("site-content-creator-comments"),
    commentsField: document.getElementById("site-content-creator-comments-field"),
    commit: document.getElementById("site-content-creator-commit"),
    connect: document.getElementById("site-content-creator-connect"),
    cover: document.getElementById("site-content-creator-cover"),
    coverField: document.getElementById("site-content-creator-cover-field"),
    coverName: document.getElementById("site-content-creator-cover-name"),
    date: document.getElementById("site-content-creator-date"),
    descriptionEn: document.getElementById("site-content-creator-description-en"),
    descriptionZh: document.getElementById("site-content-creator-description-zh"),
    draft: document.getElementById("site-content-creator-draft"),
    english: document.getElementById("site-content-creator-english"),
    github: document.getElementById("site-content-creator-github"),
    githubField: document.getElementById("site-content-creator-github-field"),
    heading: document.getElementById("site-content-creator-heading"),
    kind: document.getElementById("site-content-creator-kind"),
    message: document.getElementById("site-content-creator-message"),
    result: document.getElementById("site-content-creator-result"),
    settings: document.getElementById("site-content-creator-settings"),
    settingsLabel: document.getElementById("site-content-creator-settings-label"),
    slug: document.getElementById("site-content-creator-slug"),
    status: document.getElementById("site-content-creator-status"),
    tags: document.getElementById("site-content-creator-tags"),
    tagsField: document.getElementById("site-content-creator-tags-field"),
    titleEn: document.getElementById("site-content-creator-title-en"),
    titleZh: document.getElementById("site-content-creator-title-zh"),
    translate: document.getElementById("site-content-creator-translate"),
    url: document.getElementById("site-content-creator-url"),
    urlField: document.getElementById("site-content-creator-url-field"),
  };

  if (Object.values(elements).some((element) => element === null)) return;

  const typeLabels = {
    activity: "动态",
    article: "文章",
    project: "项目",
    tool: "工具",
  };
  const actionTypes = new Map([
    ["activity-create", "activity"],
    ["article-create", "article"],
    ["project-create", "project"],
    ["tool-create", "tool"],
  ]);

  let activeToken = "";
  let activeTrigger = null;
  let baselineSnapshot = "";
  let busy = false;
  let coverFile = null;
  let currentType = "article";
  let previousScrollY = 0;
  let restorePromise = Promise.resolve(null);
  let slugIsAutomatic = true;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDateTime(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function defaultSlug(type, date = new Date()) {
    return `${type}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
  }

  function setStatus(message, state = "") {
    elements.status.textContent = message;
    if (state) elements.status.dataset.state = state;
    else delete elements.status.dataset.state;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    root.setAttribute("aria-busy", String(nextBusy));
    for (const element of [elements.close, elements.commit, elements.connect, elements.draft, elements.translate]) element.disabled = nextBusy;
  }

  function draftStorageId(type = currentType) {
    return `content-creator:${repository}:${branch}:${type}`;
  }

  function readValues() {
    return {
      announce: elements.announce.checked,
      bodyEn: elements.bodyEn.value,
      bodyZh: elements.bodyZh.value,
      category: elements.category.value,
      comments: elements.comments.checked,
      date: elements.date.value,
      descriptionEn: elements.descriptionEn.value,
      descriptionZh: elements.descriptionZh.value,
      github: elements.github.value,
      message: elements.message.value,
      slug: elements.slug.value,
      tags: elements.tags.value,
      titleEn: elements.titleEn.value,
      titleZh: elements.titleZh.value,
      type: currentType,
      url: elements.url.value,
    };
  }

  function formValues(values) {
    return {
      announce: values.announce,
      bodyEn: values.bodyEn,
      bodyZh: values.bodyZh,
      category: values.category,
      comments: values.comments,
      date: values.date,
      descriptionEn: values.descriptionEn,
      descriptionZh: values.descriptionZh,
      github: values.github,
      message: values.message,
      slug: values.slug,
      tags: values.tags,
      titleEn: values.titleEn,
      titleZh: values.titleZh,
      type: values.type,
      url: values.url,
    };
  }

  function serializeFormValues(values) {
    return JSON.stringify(formValues(values));
  }

  function writeValues(values) {
    elements.announce.checked = values.announce !== false;
    elements.bodyEn.value = values.bodyEn || "";
    elements.bodyZh.value = values.bodyZh || "";
    elements.category.value = values.category || (currentType === "tool" ? "fun" : currentType === "project" ? "work" : "");
    elements.comments.checked = values.comments !== false;
    elements.date.value = values.date || localDateTime();
    elements.descriptionEn.value = values.descriptionEn || "";
    elements.descriptionZh.value = values.descriptionZh || "";
    elements.github.value = values.github || "";
    elements.message.value = values.message || `content: add ${currentType}`;
    elements.slug.value = values.slug || defaultSlug(currentType);
    elements.tags.value = values.tags || "";
    elements.titleEn.value = values.titleEn || "";
    elements.titleZh.value = values.titleZh || "";
    elements.url.value = values.url || "";
  }

  async function restoreDraft() {
    try {
      const serialized = await window.functionhxGitHubAuth?.restoreOpaque?.({ id: draftStorageId() });
      const draft = JSON.parse(serialized || "null");
      if (!draft?.values || draft.values.type !== currentType) return false;
      writeValues(draft.values);
      slugIsAutomatic = draft.slugIsAutomatic !== false;
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function saveDraft(showStatus = true) {
    try {
      if (!window.functionhxGitHubAuth?.saveOpaque) throw new Error("Encrypted device storage is unavailable.");
      await window.functionhxGitHubAuth.saveOpaque({
        id: draftStorageId(),
        value: JSON.stringify({ savedAt: new Date().toISOString(), slugIsAutomatic, values: readValues() }),
      });
      if (showStatus) {
        const coverNote = coverFile ? "；封面请在下次打开时重新选择" : "";
        setStatus(`草稿已加密保存在这台设备中${coverNote}。`, "success");
      }
      return true;
    } catch (_error) {
      if (showStatus) setStatus("无法在这台设备上加密保存草稿。", "error");
      return false;
    }
  }

  async function forgetDraft(type = currentType) {
    await window.functionhxGitHubAuth?.forgetOpaque?.({ id: draftStorageId(type) }).catch(() => undefined);
  }

  function configureType(type) {
    currentType = type;
    root.dataset.creatorType = type;
    elements.heading.textContent = elements.heading.dataset[`heading${type[0].toUpperCase()}${type.slice(1)}`] || "新建内容";
    elements.kind.textContent = typeLabels[type];
    const isArticle = type === "article";
    const isCard = type === "tool" || type === "project";
    const isActivity = type === "activity";
    elements.tagsField.hidden = !isArticle;
    elements.categoryField.hidden = isActivity;
    elements.urlField.hidden = !isCard;
    elements.githubField.hidden = !isCard;
    elements.coverField.hidden = !isCard;
    elements.commentsField.hidden = !isArticle;
    elements.announceField.hidden = isActivity;
    elements.settingsLabel.textContent = type === "tool" ? "封面与链接 · 发布设置" : "发布设置";
    elements.bodyZh.placeholder = isActivity ? "写下这条动态，可使用 Markdown 链接……" : "从这里开始写……";
    elements.descriptionZh.placeholder = isActivity ? "动态摘要" : "一句话说明这是什么";
  }

  async function openCreator(type, trigger) {
    if (!typeLabels[type] || busy) return;
    activeTrigger = trigger;
    previousScrollY = window.scrollY;
    configureType(type);
    coverFile = null;
    elements.cover.value = "";
    elements.coverName.textContent = "未选择封面";
    slugIsAutomatic = true;
    writeValues({
      announce: true,
      comments: true,
      date: localDateTime(),
      slug: defaultSlug(type),
      type,
    });
    elements.english.open = false;
    elements.settings.open = type === "tool";
    elements.result.hidden = true;
    root.hidden = false;
    document.body.classList.add("site-content-creator-active");
    root.scrollIntoView({ block: "start" });
    const restored = await restoreDraft();
    baselineSnapshot = restored ? "" : serializeFormValues(readValues());
    setStatus(restored ? "已恢复这台设备上的加密草稿。" : "中文写完即可创建；英文镜像可以留空，稍后再翻译。", restored ? "success" : "");
    window.requestAnimationFrame(() => elements.titleZh.focus());
  }

  function closeCreator() {
    if (busy) return;
    if (serializeFormValues(readValues()) === baselineSnapshot) forgetDraft();
    else saveDraft(false);
    root.hidden = true;
    document.body.classList.remove("site-content-creator-active");
    window.requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
    if (activeTrigger && typeof activeTrigger.focus === "function") activeTrigger.focus();
  }

  function parseList(value) {
    return String(value || "")
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  function plainSummary(body) {
    return String(body || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function normalizedUrl(value, label) {
    const text = String(value || "").trim();
    if (!text) return "";
    let parsed;
    try {
      parsed = new URL(text);
    } catch (_error) {
      throw new Error(`${label}不是有效网址。`);
    }
    if (!new Set(["https:", "http:"]).has(parsed.protocol)) throw new Error(`${label}只支持 HTTP 或 HTTPS。`);
    return parsed.href;
  }

  function validate(values, type, selectedCover) {
    if (!values.titleZh.trim() || !values.descriptionZh.trim()) {
      setStatus("请先填写中文标题和摘要。", "error");
      (values.titleZh.trim() ? elements.descriptionZh : elements.titleZh).focus();
      return false;
    }
    if (["article", "activity"].includes(type) && !values.bodyZh.trim()) {
      setStatus("请先填写中文正文。", "error");
      elements.bodyZh.focus();
      return false;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) {
      elements.settings.open = true;
      setStatus("网址短名只能包含小写字母、数字和连字符。", "error");
      elements.slug.focus();
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(values.date)) {
      elements.settings.open = true;
      setStatus("请选择有效的日期与时间。", "error");
      elements.date.focus();
      return false;
    }
    try {
      normalizedUrl(values.url, "公开网址");
      normalizedUrl(values.github, "GitHub 网址");
    } catch (error) {
      elements.settings.open = true;
      setStatus(error.message, "error");
      return false;
    }
    if (selectedCover && (!allowedCoverTypes.has(selectedCover.type) || selectedCover.size > maxCoverBytes)) {
      elements.settings.open = true;
      setStatus("封面必须是 WebP、PNG 或 JPEG，且不超过 5 MB。", "error");
      return false;
    }
    return true;
  }

  function dateParts(value) {
    const date = value.slice(0, 10);
    return { date, year: date.slice(0, 4), jekyll: `${value.replace("T", " ")}:00 +0800` };
  }

  function englishLocalization(values, targetPath) {
    const complete = values.titleEn.trim() && values.bodyEn.trim();
    if (complete) {
      return {
        body: values.bodyEn.trim(),
        description: values.descriptionEn.trim() || plainSummary(values.bodyEn),
        title: values.titleEn.trim(),
      };
    }
    return {
      body: `> English translation pending. [Read the Chinese source](${targetPath}).`,
      description: "English translation pending. Read the Chinese source.",
      title: `Translation pending · ${values.titleZh.trim()}`,
    };
  }

  function sourceBlock(frontMatter, body) {
    return `${["---", ...frontMatter, "---", "", body.trimEnd(), ""].join("\n")}`;
  }

  function composeArticle(language, values) {
    const parts = dateParts(values.date);
    const zhPath = `/blog/${parts.year}/${values.slug}/`;
    const localized =
      language === "zh"
        ? { body: values.bodyZh.trim(), description: values.descriptionZh.trim(), title: values.titleZh.trim() }
        : englishLocalization(values, zhPath);
    const permalink = language === "zh" ? zhPath : `/en/blog/${parts.year}/${values.slug}/`;
    return sourceBlock(
      [
        "layout: post",
        `title: ${JSON.stringify(localized.title)}`,
        `slug: ${JSON.stringify(values.slug)}`,
        `date: ${parts.jekyll}`,
        "published: true",
        `announce: ${values.announce ? "true" : "false"}`,
        `description: ${JSON.stringify(localized.description)}`,
        `permalink: ${permalink}`,
        `lang: ${language}`,
        `locale: ${language}`,
        `translation_key: post-${values.slug}`,
        "kind: writing",
        `tags: ${JSON.stringify(parseList(values.tags))}`,
        `categories: ${JSON.stringify(parseList(values.category))}`,
        "related_posts: false",
        `giscus_comments: ${values.comments ? "true" : "false"}`,
      ],
      localized.body
    );
  }

  function composeCard(language, values, coverPath, type) {
    const isTool = type === "tool";
    const zhPath = `/${isTool ? "tools" : "projects"}/${values.slug}/`;
    const localized =
      language === "zh"
        ? {
            body: values.bodyZh.trim() || values.descriptionZh.trim(),
            description: values.descriptionZh.trim(),
            title: values.titleZh.trim(),
          }
        : englishLocalization(values, zhPath);
    const frontMatter = [
      "layout: page",
      `title: ${JSON.stringify(localized.title)}`,
      `description: ${JSON.stringify(localized.description)}`,
      `permalink: ${language === "zh" ? zhPath : `/en${zhPath}`}`,
    ];
    const url = normalizedUrl(values.url, "产品网址");
    const github = normalizedUrl(values.github, "GitHub 网址");
    if (url) frontMatter.push(`redirect: ${url}`);
    if (github) frontMatter.push(`github: ${github}`);
    frontMatter.push(
      `lang: ${language}`,
      `translation_key: ${values.slug}`,
      `kind: ${type}`,
      "importance: 99",
      `category: ${JSON.stringify(values.category.trim() || (isTool ? "fun" : "work"))}`
    );
    if (coverPath) frontMatter.push(`img: ${coverPath}`);
    return sourceBlock(frontMatter, localized.body);
  }

  function composeActivity(language, values, options = {}) {
    const parts = dateParts(values.date);
    const zhPath = options.link || `/news/${values.slug}/`;
    const localized =
      language === "zh"
        ? { body: options.zhBody || values.bodyZh.trim(), title: options.zhTitle || values.titleZh.trim() }
        : values.titleEn.trim() && values.bodyEn.trim()
          ? { body: options.enBody || values.bodyEn.trim(), title: options.enTitle || values.titleEn.trim() }
          : {
              body: options.enBody || `English translation pending. [Read the Chinese update](${zhPath}).`,
              title: options.enTitle || `Translation pending · ${values.titleZh.trim()}`,
            };
    return sourceBlock(
      [
        "layout: post",
        `title: ${JSON.stringify(localized.title)}`,
        `date: ${parts.date}`,
        "inline: true",
        "related_posts: false",
        `lang: ${language}`,
        `translation_key: news-${options.key || values.slug}`,
        `permalink: ${language === "zh" ? `/news/${options.key || values.slug}/` : `/en/news/${options.key || values.slug}/`}`,
      ],
      localized.body
    );
  }

  function sourceEntries(type, values, coverPath) {
    const parts = dateParts(values.date);
    if (type === "article") {
      const prefix = `_posts/${parts.date}-${values.slug}`;
      return [
        { content: composeArticle("zh", values), path: `${prefix}-zh.md` },
        { content: composeArticle("en", values), path: `${prefix}-en.md` },
      ];
    }
    if (type === "activity") {
      const prefix = `_news/${parts.date}-${values.slug}`;
      return [
        { content: composeActivity("zh", values), path: `${prefix}-zh.md` },
        { content: composeActivity("en", values), path: `${prefix}-en.md` },
      ];
    }

    const entries = [
      { content: composeCard("zh", values, coverPath, type), path: `_projects/${values.slug}-zh.md` },
      { content: composeCard("en", values, coverPath, type), path: `_projects/${values.slug}-en.md` },
    ];
    if (values.announce) {
      const destination = `/${type === "tool" ? "tools" : "projects"}/${values.slug}/`;
      const key = `${values.slug}-launched`;
      const zhLabel = type === "tool" ? "工具" : "项目";
      const enLabel = type === "tool" ? "tool" : "project";
      const newsPrefix = `_news/${parts.date}-${key}`;
      entries.push(
        {
          content: composeActivity("zh", values, {
            key,
            link: destination,
            zhBody: `[${values.titleZh.trim()}](${destination}) 已加入${zhLabel}页。`,
            zhTitle: `${values.titleZh.trim()}上线`,
          }),
          path: `${newsPrefix}-zh.md`,
        },
        {
          content: composeActivity("en", values, {
            enBody: `[${values.titleEn.trim() || values.titleZh.trim()}](/en${destination}) is now listed on the ${enLabel} page.`,
            enTitle: `${values.titleEn.trim() || values.titleZh.trim()} is live`,
            key,
            link: destination,
          }),
          path: `${newsPrefix}-en.md`,
        }
      );
    }
    return entries;
  }

  function encodePath(path) {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  async function githubRequest(endpoint, options = {}) {
    const headers = {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await window.fetch(`https://api.github.com${endpoint}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      headers,
      method: options.method || "GET",
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404 && options.allowNotFound) return null;
    if (!response.ok) {
      const error = new Error(payload.message || `GitHub API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function restoreGitHubSession() {
    const session = await window.functionhxGitHubAuth?.restore({ owner, repository }).catch(() => null);
    activeToken = session?.token || "";
    elements.connect.innerHTML = activeToken
      ? '<i class="fa-brands fa-github" aria-hidden="true"></i> @Functionhx 已连接'
      : '<i class="fa-solid fa-gear" aria-hidden="true"></i> 站长连接';
    return session;
  }

  function openConnection() {
    setStatus("请先在“站点设置 → 站长设置”中连接 @Functionhx。", "error");
    const settingsToggle = document.getElementById("site-settings-toggle");
    if (settingsToggle) settingsToggle.click();
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return window.btoa(binary);
  }

  function createCommitIntent(type, values, selectedCover) {
    const frozenValues = Object.freeze(formValues({ ...values, type }));
    let cover = null;
    if (selectedCover) {
      const extension = allowedCoverTypes.get(selectedCover.type);
      const directory = type === "tool" ? "tools" : "projects";
      cover = Object.freeze({
        file: selectedCover,
        path: `assets/img/${directory}/${frozenValues.slug}-cover.${extension}`,
      });
    }
    const sources = Object.freeze(
      sourceEntries(type, frozenValues, cover?.path || "").map((entry) => Object.freeze({ content: entry.content, path: entry.path }))
    );
    return Object.freeze({
      branch,
      cover,
      message: frozenValues.message.trim() || `content: add ${type} "${frozenValues.slug}"`,
      repository,
      sources,
      type,
      values: frozenValues,
    });
  }

  async function createCoverBlob(file, snapshot) {
    const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const blob = await githubRequest(`/repos/${snapshot.repository}/git/blobs`, {
      body: { content, encoding: "base64" },
      method: "POST",
      token: snapshot.token,
    });
    if (!blob.sha) throw new Error("GitHub 未返回封面文件标识。");
    return blob.sha;
  }

  async function ensurePathsAvailable(entries, headSha, snapshot) {
    const collisions = await Promise.all(
      entries.map((entry) =>
        githubRequest(`/repos/${snapshot.repository}/contents/${encodePath(entry.path)}?ref=${encodeURIComponent(headSha)}`, {
          allowNotFound: true,
          token: snapshot.token,
        })
      )
    );
    if (collisions.some(Boolean)) throw new Error("同名内容已经存在，请修改网址短名。 ");
  }

  async function createCommit(snapshot) {
    const head = await githubRequest(`/repos/${snapshot.repository}/git/ref/heads/${encodeURIComponent(snapshot.branch)}`, {
      token: snapshot.token,
    });
    const headSha = head.object?.sha;
    if (!headSha) throw new Error("无法读取 main 分支。");
    const parent = await githubRequest(`/repos/${snapshot.repository}/git/commits/${headSha}`, { token: snapshot.token });
    const baseTree = parent.tree?.sha;
    if (!baseTree) throw new Error("无法读取 main 分支文件树。");

    const coverEntry = snapshot.cover ? { mode: "100644", path: snapshot.cover.path, type: "blob" } : null;
    await ensurePathsAvailable([...snapshot.sources, ...(coverEntry ? [coverEntry] : [])], headSha, snapshot);
    if (coverEntry) coverEntry.sha = await createCoverBlob(snapshot.cover.file, snapshot);

    const treeEntries = snapshot.sources.map((entry) => ({ content: entry.content, mode: "100644", path: entry.path, type: "blob" }));
    if (coverEntry) treeEntries.push(coverEntry);
    const tree = await githubRequest(`/repos/${snapshot.repository}/git/trees`, {
      body: { base_tree: baseTree, tree: treeEntries },
      method: "POST",
      token: snapshot.token,
    });
    const commit = await githubRequest(`/repos/${snapshot.repository}/git/commits`, {
      body: {
        message: snapshot.message,
        parents: [headSha],
        tree: tree.sha,
      },
      method: "POST",
      token: snapshot.token,
    });
    await githubRequest(`/repos/${snapshot.repository}/git/refs/heads/${encodeURIComponent(snapshot.branch)}`, {
      body: { force: false, sha: commit.sha },
      method: "PATCH",
      token: snapshot.token,
    });
    return commit;
  }

  async function commitContent() {
    if (busy) return;
    setBusy(true);
    const type = currentType;
    const values = Object.freeze(formValues({ ...readValues(), type }));
    const selectedCover = coverFile;
    try {
      if (!validate(values, type, selectedCover)) return;
      const intent = createCommitIntent(type, values, selectedCover);
      await restorePromise;
      const token = activeToken;
      if (!token) {
        openConnection();
        return;
      }
      const snapshot = Object.freeze({ ...intent, token });

      setStatus("正在创建双语内容与 Commit…");
      elements.result.hidden = true;
      const commit = await createCommit(snapshot);
      await forgetDraft(snapshot.type);
      baselineSnapshot = serializeFormValues(snapshot.values);
      setStatus("已创建 Commit；发布进度会显示在页面右下角。", "success");
      if (commit.html_url) {
        elements.result.href = commit.html_url;
        elements.result.textContent = "在 GitHub 查看 Commit →";
        elements.result.hidden = false;
      }
      window.functionhxDeployment?.watch(commit);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        activeToken = "";
        window.functionhxOwnerUi?.setVerified?.(false);
      }
      setStatus(`无法创建内容。${error.message || ""}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function translateChinese() {
    if (!elements.titleZh.value.trim() || !elements.bodyZh.value.trim()) {
      setStatus("请先填写中文标题和正文。", "error");
      elements.titleZh.focus();
      return;
    }
    if (
      (elements.titleEn.value.trim() || elements.descriptionEn.value.trim() || elements.bodyEn.value.trim()) &&
      !window.confirm("用新的 DeepSeek 翻译覆盖当前英文稿？")
    ) {
      return;
    }
    if (!window.functionhxDeepSeek?.translate) {
      setStatus("翻译工具尚未载入。", "error");
      return;
    }

    elements.translate.disabled = true;
    setStatus("正在等待 DeepSeek 翻译中文稿…");
    try {
      const translated = await window.functionhxDeepSeek.translate({
        body: elements.bodyZh.value,
        summary: elements.descriptionZh.value,
        title: elements.titleZh.value,
      });
      elements.titleEn.value = translated.title;
      elements.descriptionEn.value = translated.summary;
      elements.bodyEn.value = translated.body;
      if (slugIsAutomatic) {
        const generated = slugify(translated.title);
        if (generated) elements.slug.value = generated;
      }
      elements.english.open = true;
      setStatus("英文译稿已生成，请检查后再提交。", "success");
    } catch (error) {
      if (error.name === "AbortError") setStatus("已取消翻译，中文稿保持不变。");
      else setStatus(`无法生成英文译稿。${error.message || ""}`, "error");
    } finally {
      elements.translate.disabled = false;
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const trigger = event.target.closest("[data-author-action]");
      const type = actionTypes.get(trigger?.dataset.authorAction || "");
      if (!type) return;
      if (busy) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setStatus("当前 Commit 完成前不能切换创作类型。");
        return;
      }
      openCreator(type, trigger);
    },
    true
  );

  elements.close.addEventListener("click", closeCreator);
  elements.commit.addEventListener("click", commitContent);
  elements.connect.addEventListener("click", async () => {
    await restorePromise;
    if (activeToken) setStatus("已连接为 @Functionhx，可以直接创建 Commit。", "success");
    else openConnection();
  });
  elements.draft.addEventListener("click", () => saveDraft(true));
  elements.translate.addEventListener("click", translateChinese);
  elements.cover.addEventListener("change", () => {
    coverFile = elements.cover.files?.[0] || null;
    elements.coverName.textContent = coverFile ? `${coverFile.name} · ${(coverFile.size / 1024 / 1024).toFixed(2)} MB` : "未选择封面";
    if (coverFile && (!allowedCoverTypes.has(coverFile.type) || coverFile.size > maxCoverBytes)) {
      setStatus("封面必须是 WebP、PNG 或 JPEG，且不超过 5 MB。", "error");
    }
  });

  elements.slug.addEventListener("input", () => {
    slugIsAutomatic = false;
    elements.slug.value = slugify(elements.slug.value);
  });
  elements.titleZh.addEventListener("input", () => {
    if (!slugIsAutomatic) return;
    const generated = slugify(elements.titleZh.value);
    if (generated) elements.slug.value = generated;
  });
  elements.titleEn.addEventListener("input", () => {
    if (!slugIsAutomatic) return;
    const generated = slugify(elements.titleEn.value);
    if (generated) elements.slug.value = generated;
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !root.hidden) {
        if (busy) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setStatus("Commit 进行中，完成后才能关闭创作区。");
          return;
        }
        closeCreator();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !root.hidden) {
        event.preventDefault();
        commitContent();
      }
    },
    true
  );

  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (String(event.detail?.repository || "").toLowerCase() !== repository.toLowerCase()) return;
    restorePromise = restoreGitHubSession();
  });

  restorePromise = restoreGitHubSession();
})();
