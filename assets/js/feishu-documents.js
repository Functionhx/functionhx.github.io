(function initializeFeishuDocuments() {
  "use strict";

  const dialog = document.getElementById("feishu-document-dialog");
  const root = document.getElementById("feishu-document-creator");
  const trigger = document.querySelector('[data-author-action="feishu-document-create"]');
  const form = document.getElementById("feishu-document-form");
  const titleInput = document.getElementById("feishu-document-title");
  const connectButton = document.getElementById("feishu-document-connect");
  const submitButton = document.getElementById("feishu-document-submit");
  const closeButton = document.getElementById("feishu-document-close");
  const connection = document.getElementById("feishu-document-connection");
  const connectionTitle = document.getElementById("feishu-document-connection-title");
  const status = document.getElementById("feishu-document-status");
  const resultLink = document.getElementById("feishu-document-result");
  const library = document.getElementById("feishu-document-library");
  const documentList = document.getElementById("feishu-document-list");
  const documentListStatus = document.getElementById("feishu-document-list-status");
  const refreshButton = document.getElementById("feishu-document-refresh");
  const pencilToggle = document.getElementById("site-inline-editor-toggle");
  const vaultClient = window.functionhxSparkVault;
  if (
    !dialog ||
    !root ||
    !trigger ||
    !form ||
    !titleInput ||
    !connectButton ||
    !submitButton ||
    !closeButton ||
    !connection ||
    !connectionTitle ||
    !status ||
    !resultLink ||
    !library ||
    !documentList ||
    !documentListStatus ||
    !refreshButton
  ) {
    return;
  }

  const strings = {
    awaitingConfiguration: "飞书应用尚未完成配置。请先在服务端加入 App ID、App Secret 与精确回调地址。",
    awaitingConfigurationTitle: "等待飞书配置",
    checking: "正在检查站长身份与飞书官方授权状态…",
    checkingTitle: "检查连接",
    connected: "现在可以创建空白云文档；正文会在飞书中继续编辑。",
    connectedAs: (name) => `飞书官方授权有效 · ${name}`,
    connectedTitle: "已连接飞书",
    connectingFeishu: "请在飞书官方窗口完成授权。本站不会接触你的飞书密码。",
    connectingFeishuTitle: "正在连接飞书",
    connectFeishu: "连接飞书",
    connectOwner: "连接站长身份",
    createFailed: "暂时无法创建云文档。请保留当前标题后重试；重复尝试不会重复创建同一份文档。",
    createInProgress: "创建请求仍在安全处理中，请稍等片刻后用当前标题重试。",
    createOutcomeUnknown: "飞书可能已经创建了文档，但本站未能确认结果。请先到飞书中核对，避免重复创建。",
    created: "云文档已创建并保存到下方记录。点击链接后会在新标签页打开飞书。",
    createdTitle: "创建成功",
    feishuRequired: "站长身份已验证。继续通过飞书官方 OAuth 授权后即可创建。",
    feishuRequiredTitle: "需要飞书授权",
    invalidResponse: "服务端没有返回可安全打开的飞书文档地址。请稍后重试。",
    ownerConnected: "站长身份已连接。再次点按“连接飞书”继续官方授权。",
    ownerRequired: "先连接本站的站长身份，再由飞书官方页面完成授权。",
    ownerRequiredTitle: "需要站长身份",
    oauthAccessDenied: "你取消了飞书授权，未创建任何文档。",
    oauthAccountDenied: "当前飞书账号未获本站授权，请使用已经绑定的账号。",
    oauthFailed: "飞书官方授权暂时没有完成，请稍后重试。",
    oauthIncomplete: "飞书授权信息不完整，请重新发起授权。",
    oauthScopeMissing: "飞书没有授予创建文档所需权限，请重新授权。",
    popupBlocked: "浏览器拦截了授权窗口。请允许本站打开弹窗后重试。",
    recordsEmpty: "还没有通过本站创建的飞书云文档。",
    recordsFailed: "暂时无法读取云文档记录，请稍后刷新。",
    recordsLoading: "正在读取私有云文档记录…",
    requestFailed: "暂时无法确认飞书连接，请检查网络后重试。",
    requestFailedTitle: "连接检查失败",
    retry: "重新检查",
    titleRequired: "请先填写文档标题。",
  };

  const officialAuthorizeOrigin = "https://accounts.feishu.cn";
  let endpoint = "";
  let state = "idle";
  let busy = false;
  let idempotencyKey = "";
  let oauthPopup = null;
  let oauthCancel = null;
  let documents = [];

  try {
    endpoint = vaultClient?.normalizeEndpoint?.(root.dataset.endpoint || "") || "";
  } catch (_error) {
    endpoint = "";
  }

  function withTimeout(promise, milliseconds, message) {
    let timer = 0;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          const error = new Error(message);
          error.code = "timeout";
          reject(error);
        }, milliseconds);
      }),
    ]).finally(() => window.clearTimeout(timer));
  }

  function setConnection(nextState, heading, message) {
    state = nextState;
    connection.dataset.state = nextState;
    connectionTitle.textContent = heading;
    status.textContent = message;
    updateControls();
  }

  function setBusy(active) {
    busy = active;
    root.dataset.busy = active ? "true" : "false";
    updateControls();
  }

  function updateControls() {
    const connected = state === "connected" || state === "created" || state === "connected-error";
    titleInput.disabled = busy || !connected;
    submitButton.disabled = busy || !connected;
    connectButton.disabled = busy || state === "unconfigured" || state === "authorizing";
    connectButton.hidden = connected;
    if (state === "site-auth-required") connectButton.textContent = strings.connectOwner;
    else if (state === "error") connectButton.textContent = strings.retry;
    else connectButton.textContent = strings.connectFeishu;
  }

  function currentReturnTo() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function safeAuthorizeUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      if (parsed.origin !== officialAuthorizeOrigin || parsed.pathname !== "/open-apis/authen/v1/authorize") return "";
      return parsed.href;
    } catch (_error) {
      return "";
    }
  }

  function safeDocumentUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      const hostname = parsed.hostname.toLowerCase();
      const officialHost = hostname === "feishu.cn" || hostname.endsWith(".feishu.cn");
      return parsed.protocol === "https:" && officialHost && !parsed.username && !parsed.password ? parsed.href : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeDocument(value) {
    const url = safeDocumentUrl(value?.url);
    const title = String(value?.title || "").trim();
    const createdAt = String(value?.created_at || "");
    if (!url || !title || !Number.isFinite(Date.parse(createdAt))) return null;
    return { createdAt, title: title.slice(0, 800), url };
  }

  function displayDocumentTime(value) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(value));
    } catch (_error) {
      return "";
    }
  }

  function renderDocuments() {
    documentList.replaceChildren();
    library.hidden = false;
    if (!documents.length) {
      documentListStatus.textContent = strings.recordsEmpty;
      documentListStatus.hidden = false;
      return;
    }
    documentListStatus.hidden = true;
    for (const documentRecord of documents) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const title = document.createElement("span");
      const time = document.createElement("time");
      link.href = documentRecord.url;
      link.target = "_blank";
      link.rel = "external noopener noreferrer";
      title.textContent = documentRecord.title;
      time.dateTime = documentRecord.createdAt;
      time.textContent = displayDocumentTime(documentRecord.createdAt);
      link.append(title, time);
      item.append(link);
      documentList.append(item);
    }
  }

  function upsertDocument(value) {
    const record = normalizeDocument(value);
    if (!record) return;
    documents = [record, ...documents.filter((item) => item.url !== record.url)].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
    renderDocuments();
  }

  async function loadDocuments() {
    if (!endpoint || !vaultClient?.restore) return false;
    documentListStatus.hidden = false;
    documentListStatus.textContent = strings.recordsLoading;
    refreshButton.disabled = true;
    try {
      const ownerSession = await withTimeout(vaultClient.restore(endpoint), 9000, "Owner session check timed out.");
      if (!ownerSession) {
        library.hidden = true;
        return false;
      }
      library.hidden = false;
      const payload = await withTimeout(vaultRequest("/api/feishu/documents"), 12000, "Feishu document records timed out.");
      documents = (Array.isArray(payload.documents) ? payload.documents : []).map(normalizeDocument).filter(Boolean);
      documents.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      renderDocuments();
      return true;
    } catch (error) {
      if (error?.status === 401 || error?.code === "authentication_required") {
        library.hidden = true;
      } else {
        library.hidden = false;
        documentListStatus.hidden = false;
        documentListStatus.textContent = strings.recordsFailed;
      }
      return false;
    } finally {
      refreshButton.disabled = false;
    }
  }

  function newIdempotencyKey() {
    if (window.crypto?.randomUUID) return `feishu-document-${window.crypto.randomUUID()}`;
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    return `feishu-document-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  function oauthErrorMessage(code) {
    if (code === "feishu_access_denied") return strings.oauthAccessDenied;
    if (code === "feishu_user_denied" || code === "feishu_tenant_denied") return strings.oauthAccountDenied;
    if (code === "feishu_scope_missing") return strings.oauthScopeMissing;
    if (code === "feishu_oauth_incomplete") return strings.oauthIncomplete;
    return strings.oauthFailed;
  }

  async function vaultRequest(path, options = {}) {
    if (!vaultClient?.request || !endpoint) {
      const error = new Error("Feishu backend is not configured.");
      error.code = "not_configured";
      throw error;
    }
    return vaultClient.request(endpoint, path, options);
  }

  async function checkConnection({ focus = false } = {}) {
    resultLink.hidden = true;
    if (!endpoint || !vaultClient?.restore) {
      setConnection("unconfigured", strings.awaitingConfigurationTitle, strings.awaitingConfiguration);
      return false;
    }

    setConnection("checking", strings.checkingTitle, strings.checking);
    setBusy(true);
    try {
      const ownerSession = await withTimeout(vaultClient.restore(endpoint), 9000, "Owner session check timed out.");
      if (!ownerSession) {
        setConnection("site-auth-required", strings.ownerRequiredTitle, strings.ownerRequired);
        return false;
      }

      const payload = await withTimeout(vaultRequest("/api/feishu/session"), 9000, "Feishu session check timed out.");
      if (payload.configured === false) {
        setConnection("unconfigured", strings.awaitingConfigurationTitle, strings.awaitingConfiguration);
        return false;
      }
      if (!payload.connected) {
        setConnection("feishu-auth-required", strings.feishuRequiredTitle, strings.feishuRequired);
        return false;
      }

      const displayName = String(payload.user?.name || payload.user?.display_name || "").trim();
      setConnection("connected", strings.connectedTitle, displayName ? strings.connectedAs(displayName) : strings.connected);
      if (focus && dialog.open) titleInput.focus();
      return true;
    } catch (error) {
      if (error?.status === 401 || error?.code === "authentication_required") {
        setConnection("site-auth-required", strings.ownerRequiredTitle, strings.ownerRequired);
      } else if (error?.status === 503 || error?.code === "not_configured" || error?.code === "feishu_not_configured") {
        setConnection("unconfigured", strings.awaitingConfigurationTitle, strings.awaitingConfiguration);
      } else {
        setConnection("error", strings.requestFailedTitle, strings.requestFailed);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  function finishOAuthWatch() {
    oauthCancel?.();
    oauthCancel = null;
    oauthPopup = null;
  }

  function watchOAuthPopup(popup) {
    const expectedOrigin = new URL(endpoint).origin;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("Feishu authorization timed out.")), 3 * 60 * 1000);
      const closed = window.setInterval(() => {
        if (popup.closed) finish(null, { closed: true });
      }, 400);

      function cleanup() {
        window.clearTimeout(timeout);
        window.clearInterval(closed);
        window.removeEventListener("message", onMessage);
      }

      function finish(error, payload = null) {
        if (settled) return;
        settled = true;
        cleanup();
        oauthCancel = null;
        oauthPopup = null;
        if (error) reject(error);
        else resolve(payload);
      }

      function onMessage(event) {
        if (event.origin !== expectedOrigin || event.source !== popup) return;
        if (event.data?.type !== "functionhx:feishu-connected") return;
        if (event.data.connected === true) {
          finish(null, { connected: true, user: event.data.user || null });
          return;
        }
        if (event.data.connected !== false) return;
        const code = String(event.data.error?.code || "feishu_oauth_failed");
        const error = new Error(oauthErrorMessage(code));
        error.code = code;
        finish(error);
      }

      oauthCancel = () => finish(new Error("Feishu authorization was canceled."));
      window.addEventListener("message", onMessage);
    });
  }

  async function connect() {
    if (busy || state === "unconfigured") return;

    if (state === "site-auth-required" || state === "error" || state === "checking" || state === "idle") {
      if (state === "error") {
        await checkConnection({ focus: true });
        return;
      }
      setBusy(true);
      try {
        await vaultClient.login(endpoint, { returnTo: currentReturnTo() });
        await checkConnection({ focus: true });
        if (state === "feishu-auth-required") status.textContent = strings.ownerConnected;
      } catch (_error) {
        setConnection("site-auth-required", strings.ownerRequiredTitle, strings.ownerRequired);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (state !== "feishu-auth-required") return;
    const popup = window.open("about:blank", "functionhx-feishu-oauth", "popup=yes,width=620,height=760");
    if (!popup) {
      setConnection("feishu-auth-required", strings.feishuRequiredTitle, strings.popupBlocked);
      return;
    }
    oauthPopup = popup;
    try {
      popup.document.title = "连接飞书 · Magic";
      popup.document.body.textContent = "正在前往飞书官方授权页面…";
    } catch (_error) {
      // The placeholder remains useful even when the browser restricts access.
    }

    setConnection("authorizing", strings.connectingFeishuTitle, strings.connectingFeishu);
    setBusy(true);
    try {
      const payload = await withTimeout(
        vaultRequest("/api/feishu/oauth/start", {
          body: { return_to: currentReturnTo(), site_origin: window.location.origin },
          method: "POST",
        }),
        12000,
        "Feishu authorization could not start."
      );
      const authorizeUrl = safeAuthorizeUrl(payload.authorize_url);
      if (!authorizeUrl) throw new Error("Invalid Feishu authorization URL.");
      popup.location.replace(authorizeUrl);
      await watchOAuthPopup(popup);
      await checkConnection({ focus: true });
    } catch (error) {
      if (!popup.closed) popup.close();
      const message = String(error?.code || "").startsWith("feishu_") ? error.message : strings.requestFailed;
      setConnection("feishu-auth-required", strings.feishuRequiredTitle, message);
    } finally {
      finishOAuthWatch();
      setBusy(false);
    }
  }

  async function createDocument(event) {
    event.preventDefault();
    if (busy) return;
    const title = titleInput.value.trim();
    if (!title) {
      status.textContent = strings.titleRequired;
      titleInput.focus();
      return;
    }
    if (state !== "connected" && state !== "created" && state !== "connected-error") {
      await checkConnection({ focus: true });
      return;
    }

    if (!idempotencyKey) idempotencyKey = newIdempotencyKey();
    setBusy(true);
    resultLink.hidden = true;
    status.textContent = "正在通过飞书官方 API 创建云文档…";
    try {
      const payload = await withTimeout(
        vaultRequest("/api/feishu/documents", {
          body: { idempotency_key: idempotencyKey, title },
          method: "POST",
        }),
        20000,
        "Feishu document creation timed out."
      );
      const documentUrl = safeDocumentUrl(payload.url);
      if (!documentUrl) throw new Error(strings.invalidResponse);
      resultLink.href = documentUrl;
      resultLink.hidden = false;
      resultLink.textContent = payload.title ? `打开《${payload.title}》` : "打开刚创建的飞书云文档";
      upsertDocument(payload);
      setConnection("created", strings.createdTitle, strings.created);
      titleInput.value = "";
      idempotencyKey = "";
      loadDocuments().catch(() => undefined);
    } catch (error) {
      if (error?.code === "feishu_authorization_required" || error?.code === "feishu_reauthorization_required") {
        idempotencyKey = "";
        setConnection("feishu-auth-required", strings.feishuRequiredTitle, strings.feishuRequired);
      } else if (error?.status === 401 || error?.code === "authentication_required") {
        setConnection("site-auth-required", strings.ownerRequiredTitle, strings.ownerRequired);
      } else if (error?.status === 503 || error?.code === "feishu_not_configured") {
        setConnection("unconfigured", strings.awaitingConfigurationTitle, strings.awaitingConfiguration);
      } else if (error?.code === "feishu_create_outcome_unknown") {
        setConnection("connected-error", strings.connectedTitle, strings.createOutcomeUnknown);
      } else if (error?.code === "feishu_create_in_progress") {
        setConnection("connected-error", strings.connectedTitle, strings.createInProgress);
      } else {
        if (error?.code === "feishu_create_rejected") idempotencyKey = "";
        setConnection(
          "connected-error",
          strings.connectedTitle,
          error?.message === strings.invalidResponse ? strings.invalidResponse : strings.createFailed
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function closeCreator() {
    if (dialog.open) dialog.close();
    if (oauthPopup && !oauthPopup.closed) oauthPopup.close();
    finishOAuthWatch();
    window.requestAnimationFrame(() => pencilToggle?.focus());
  }

  function openCreator() {
    window.functionhxOwnerUi?.closeMenu?.();
    resultLink.hidden = true;
    if (!dialog.open) dialog.showModal();
    checkConnection({ focus: true }).catch(() => undefined);
    loadDocuments().catch(() => undefined);
  }

  trigger.addEventListener("click", openCreator);
  connectButton.addEventListener("click", () => connect().catch(() => undefined));
  form.addEventListener("submit", createDocument);
  closeButton.addEventListener("click", closeCreator);
  refreshButton.addEventListener("click", () => loadDocuments().catch(() => undefined));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCreator();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeCreator();
  });
  titleInput.addEventListener("input", () => {
    idempotencyKey = "";
  });
  loadDocuments().catch(() => undefined);
})();
