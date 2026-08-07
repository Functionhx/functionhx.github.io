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
  const deleteDialog = document.getElementById("feishu-document-delete-dialog");
  const deleteRoot = document.getElementById("feishu-document-delete");
  const deleteForm = document.getElementById("feishu-document-delete-form");
  const deleteTitle = document.getElementById("feishu-document-delete-title");
  const deleteStatus = document.getElementById("feishu-document-delete-status");
  const deleteCloseButton = document.getElementById("feishu-document-delete-close");
  const deleteCancelButton = document.getElementById("feishu-document-delete-cancel");
  const deleteSubmitButton = document.getElementById("feishu-document-delete-submit");
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
    !refreshButton ||
    !deleteDialog ||
    !deleteRoot ||
    !deleteForm ||
    !deleteTitle ||
    !deleteStatus ||
    !deleteCloseButton ||
    !deleteCancelButton ||
    !deleteSubmitButton
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
    creating: "正在创建…",
    connectingFeishu: "请在飞书官方窗口完成授权。本站不会接触你的飞书密码。",
    connectingFeishuTitle: "正在连接飞书",
    connectFeishu: "连接飞书",
    connectOwner: "连接站长身份",
    createFailed: "暂时无法创建云文档。请保留当前标题后重试；重复尝试不会重复创建同一份文档。",
    createInProgress: "创建请求仍在安全处理中，请稍等片刻后用当前标题重试。",
    createOutcomeUnknown: "飞书可能已经创建了文档，但本站未能确认结果。请先到飞书中核对，避免重复创建。",
    created: "云文档已创建并保存到下方记录。点击链接后会在新标签页打开飞书。",
    createdTitle: "创建成功",
    deleted: (title) => `《${title}》已移到飞书回收站。`,
    deleteFailed: "删除失败，文档仍保留在本站列表中。请稍后重试。",
    deleteInProgress: "这份文档正在移到回收站，请稍后刷新。",
    deleteReauthorization: "删除需要新增的飞书权限。请先打开右上角铅笔，重新连接一次飞书。",
    deleting: "正在移除…",
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
    oauthScopeMissing: "飞书没有授予管理文档所需权限，请重新授权。",
    recordsEmpty: "飞书云空间里暂时没有可管理的文档。",
    recordsFailed: "暂时无法读取云文档记录，请稍后刷新。",
    recordsLoading: "正在读取飞书云空间…",
    recordsProgress: (count) => `已读取 ${count} 份云文档，正在继续整理…`,
    recordsTruncated: "文档较多，本次只显示了最近的一部分。",
    requestFailed: "暂时无法确认飞书连接，请检查网络后重试。",
    requestFailedTitle: "连接检查失败",
    retry: "重新检查",
    showcaseFailed: "暂时无法修改网站展示状态，请刷新文档库后重试。",
    showcaseHiding: "正在从网站隐藏…",
    showcaseShowing: "正在加入网站展示…",
    showcaseVisible: "已展示",
    showcaseHidden: "展示",
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
  const showcaseBusyIds = new Set();
  let deleteBusy = false;
  let deleteRecord = null;
  let deleteTrigger = null;
  let libraryLoadPromise = null;

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
    if (active) root.setAttribute("aria-busy", "true");
    else root.removeAttribute("aria-busy");
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
    const requestId = String(value?.request_id || "");
    const id = String(value?.id || "");
    const selectionToken = String(value?.selection_token || "");
    const title = String(value?.title || "").trim();
    const createdAt = String(value?.created_at || "");
    const modifiedAt = String(value?.modified_at || createdAt);
    const validRequestId = /^feishu-request-[0-9a-f]{64}$/.test(requestId) ? requestId : "";
    const validLibraryId = /^feishu-file-[0-9a-f]{64}$/.test(id) ? id : "";
    const validSelectionToken = /^functionhx:zk2:[A-Za-z0-9_-]+$/.test(selectionToken) ? selectionToken : "";
    if (!url || !title || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(modifiedAt))) return null;
    if (validLibraryId && validSelectionToken) {
      return {
        createdAt,
        id: validLibraryId,
        modifiedAt,
        requestId: validRequestId,
        selectionToken: validSelectionToken,
        title: title.slice(0, 800),
        type: String(value?.type || "docx").slice(0, 24),
        url,
        visible: value?.visible === true,
      };
    }
    if (!validRequestId) return null;
    return {
      createdAt,
      id: validRequestId,
      modifiedAt,
      requestId: validRequestId,
      selectionToken: "",
      title: title.slice(0, 800),
      type: "docx",
      url,
      visible: false,
    };
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
      const icon = document.createElement("span");
      const iconGlyph = document.createElement("i");
      const title = document.createElement("span");
      const time = document.createElement("time");
      const actions = document.createElement("span");
      link.href = documentRecord.url;
      link.target = "_blank";
      link.rel = "external noopener noreferrer";
      icon.className = "feishu-documents__list-icon";
      icon.setAttribute("aria-hidden", "true");
      iconGlyph.className = "fa-regular fa-file-lines";
      icon.append(iconGlyph);
      title.className = "feishu-documents__list-title";
      title.textContent = documentRecord.title;
      time.dateTime = documentRecord.modifiedAt;
      time.textContent = displayDocumentTime(documentRecord.modifiedAt);
      link.append(icon, title, time);
      actions.className = "feishu-documents__list-actions";
      if (documentRecord.selectionToken) {
        const visibilityButton = document.createElement("button");
        const visibilityBusy = showcaseBusyIds.has(documentRecord.id);
        visibilityButton.className = "feishu-documents__visibility";
        visibilityButton.classList.toggle("feishu-documents__visibility--active", documentRecord.visible);
        visibilityButton.type = "button";
        visibilityButton.dataset.feishuShowcase = documentRecord.id;
        visibilityButton.setAttribute("aria-pressed", documentRecord.visible ? "true" : "false");
        visibilityButton.setAttribute(
          "aria-label",
          documentRecord.visible ? `从网站隐藏《${documentRecord.title}》` : `在网站展示《${documentRecord.title}》`
        );
        visibilityButton.disabled = visibilityBusy;
        visibilityButton.textContent = visibilityBusy
          ? documentRecord.visible
            ? strings.showcaseHiding
            : strings.showcaseShowing
          : documentRecord.visible
            ? strings.showcaseVisible
            : strings.showcaseHidden;
        actions.append(visibilityButton);
      }
      if (documentRecord.requestId) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "feishu-documents__delete";
        deleteButton.type = "button";
        deleteButton.dataset.feishuDelete = documentRecord.requestId;
        deleteButton.setAttribute("aria-label", `删除《${documentRecord.title}》`);
        deleteButton.title = "移到飞书回收站";
        deleteButton.innerHTML = '<i class="fa-regular fa-trash-can" aria-hidden="true"></i>';
        actions.append(deleteButton);
      }
      item.append(link, actions);
      documentList.append(item);
    }
  }

  function mergeLibraryDocuments(recordsByUrl, nextRecords) {
    for (const candidate of nextRecords) {
      const record = normalizeDocument(candidate);
      if (!record) continue;
      const existing = recordsByUrl.get(record.url);
      if (existing?.requestId && !record.requestId) record.requestId = existing.requestId;
      recordsByUrl.set(record.url, record);
    }
    documents = [...recordsByUrl.values()].sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
    renderDocuments();
  }

  async function loadDocuments() {
    if (libraryLoadPromise) return libraryLoadPromise;
    if (!endpoint || !vaultClient?.restore) return false;
    libraryLoadPromise = (async () => {
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

        const createdPayload = await withTimeout(vaultRequest("/api/feishu/documents"), 12000, "Feishu document records timed out.");
        const recordsByUrl = new Map();
        mergeLibraryDocuments(recordsByUrl, Array.isArray(createdPayload.documents) ? createdPayload.documents : []);

        const queue = [{ folderToken: "", pageToken: "" }];
        const visitedFolders = new Set(["__root__"]);
        let scannedDocuments = 0;
        let truncated = false;
        while (queue.length && scannedDocuments < 5000) {
          const batch = queue.splice(0, 4);
          const pages = await Promise.all(
            batch.map(async ({ folderToken, pageToken }) => {
              const parameters = new URLSearchParams();
              if (folderToken) parameters.set("folder_token", folderToken);
              if (pageToken) parameters.set("page_token", pageToken);
              const suffix = parameters.toString();
              return withTimeout(vaultRequest(`/api/feishu/library-page${suffix ? `?${suffix}` : ""}`), 25000, "Feishu library page timed out.");
            })
          );
          for (let index = 0; index < pages.length; index += 1) {
            const page = pages[index];
            const task = batch[index];
            const pageDocuments = Array.isArray(page.documents) ? page.documents : [];
            scannedDocuments += pageDocuments.length;
            mergeLibraryDocuments(recordsByUrl, pageDocuments);
            for (const folderToken of Array.isArray(page.folders) ? page.folders : []) {
              if (!folderToken || visitedFolders.has(folderToken)) continue;
              if (visitedFolders.size >= 500) {
                truncated = true;
                break;
              }
              visitedFolders.add(folderToken);
              queue.push({ folderToken, pageToken: "" });
            }
            if (page.has_more === true && page.next_page_token) {
              queue.push({ folderToken: task.folderToken, pageToken: page.next_page_token });
            }
          }
          documentListStatus.hidden = false;
          documentListStatus.textContent = strings.recordsProgress(scannedDocuments);
        }
        if (queue.length || scannedDocuments >= 5000) truncated = true;
        if (!documents.length) {
          documentListStatus.hidden = false;
          documentListStatus.textContent = strings.recordsEmpty;
        } else if (truncated) {
          documentListStatus.hidden = false;
          documentListStatus.textContent = strings.recordsTruncated;
        } else {
          documentListStatus.hidden = true;
        }
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
    })();
    try {
      return await libraryLoadPromise;
    } finally {
      libraryLoadPromise = null;
    }
  }

  async function toggleShowcase(record, triggerButton) {
    if (!record?.selectionToken || showcaseBusyIds.has(record.id)) return;
    const nextVisible = !record.visible;
    showcaseBusyIds.add(record.id);
    renderDocuments();
    try {
      const payload = await withTimeout(
        vaultRequest("/api/feishu/showcase", {
          body: { selection_token: record.selectionToken, visible: nextVisible },
          method: "PUT",
        }),
        12000,
        "Feishu document display update timed out."
      );
      record.visible = payload?.document?.visible === true;
      window.dispatchEvent(new CustomEvent("functionhx:feishu-showcase-updated"));
    } catch (_error) {
      documentListStatus.hidden = false;
      documentListStatus.textContent = strings.showcaseFailed;
    } finally {
      showcaseBusyIds.delete(record.id);
      renderDocuments();
      window.requestAnimationFrame(() => {
        const nextButton = documentList.querySelector(`[data-feishu-showcase="${record.id}"]`);
        if (triggerButton === document.activeElement || !document.activeElement || document.activeElement === document.body) nextButton?.focus();
      });
    }
  }

  function setDeleteBusy(active) {
    deleteBusy = active;
    if (active) deleteRoot.setAttribute("aria-busy", "true");
    else deleteRoot.removeAttribute("aria-busy");
    deleteCloseButton.disabled = active;
    deleteCancelButton.disabled = active;
    deleteSubmitButton.disabled = active;
    deleteSubmitButton.textContent = active ? strings.deleting : "移到回收站";
  }

  function closeDeleteDialog() {
    if (deleteBusy) return;
    if (deleteDialog.open) deleteDialog.close();
    const triggerToFocus = deleteTrigger;
    deleteRecord = null;
    deleteTrigger = null;
    deleteStatus.hidden = true;
    deleteStatus.textContent = "";
    window.requestAnimationFrame(() => triggerToFocus?.isConnected && triggerToFocus.focus());
  }

  function openDeleteDialog(record, triggerButton) {
    if (deleteBusy || !record) return;
    deleteRecord = record;
    deleteTrigger = triggerButton;
    deleteTitle.textContent = record.title;
    deleteStatus.hidden = true;
    deleteStatus.textContent = "";
    if (!deleteDialog.open) deleteDialog.showModal();
    window.requestAnimationFrame(() => deleteCancelButton.focus());
  }

  async function deleteDocument(event) {
    event.preventDefault();
    window.functionhxSitePreferences?.hideLoading?.();
    if (deleteBusy || !deleteRecord) return;
    const record = deleteRecord;
    setDeleteBusy(true);
    deleteStatus.hidden = true;
    deleteStatus.textContent = "";
    try {
      await withTimeout(
        vaultRequest(`/api/feishu/documents/${encodeURIComponent(record.requestId)}`, { method: "DELETE" }),
        20000,
        "Feishu document deletion timed out."
      );
      documents = documents.filter((item) => item.requestId !== record.requestId);
      renderDocuments();
      window.dispatchEvent(new CustomEvent("functionhx:feishu-showcase-updated"));
      documentListStatus.hidden = false;
      documentListStatus.textContent = strings.deleted(record.title);
      setDeleteBusy(false);
      closeDeleteDialog();
    } catch (error) {
      if (error?.code === "feishu_authorization_required" || error?.code === "feishu_reauthorization_required") {
        deleteStatus.textContent = strings.deleteReauthorization;
      } else if (error?.code === "feishu_delete_in_progress") {
        deleteStatus.textContent = strings.deleteInProgress;
      } else {
        deleteStatus.textContent = strings.deleteFailed;
      }
      deleteStatus.hidden = false;
      setDeleteBusy(false);
    } finally {
      window.functionhxSitePreferences?.hideLoading?.();
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
    let popup = null;
    try {
      popup = window.open("about:blank", "functionhx-feishu-oauth", "popup=yes,width=620,height=760");
    } catch (_error) {
      // Browsers and automation/privacy extensions may reject popup creation.
      // The official OAuth flow can safely continue in this tab instead.
    }
    oauthPopup = popup;
    if (popup) {
      try {
        popup.document.title = "连接飞书 · Magic";
        popup.document.body.textContent = "正在前往飞书官方授权页面…";
      } catch (_error) {
        // The placeholder remains useful even when the browser restricts access.
      }
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
      if (!popup) {
        window.location.assign(authorizeUrl);
        return;
      }
      popup.location.replace(authorizeUrl);
      await watchOAuthPopup(popup);
      const connected = await checkConnection({ focus: true });
      if (connected) await loadDocuments();
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      const message = String(error?.code || "").startsWith("feishu_") ? error.message : strings.requestFailed;
      setConnection("feishu-auth-required", strings.feishuRequiredTitle, message);
    } finally {
      finishOAuthWatch();
      setBusy(false);
    }
  }

  async function createDocument(event) {
    event.preventDefault();
    window.functionhxSitePreferences?.hideLoading?.();
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
    submitButton.textContent = strings.creating;
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
      submitButton.textContent = "创建文档";
      setBusy(false);
      window.functionhxSitePreferences?.hideLoading?.();
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
  documentList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-feishu-delete]");
    if (deleteButton && documentList.contains(deleteButton)) {
      const record = documents.find((item) => item.requestId === deleteButton.dataset.feishuDelete);
      openDeleteDialog(record, deleteButton);
      return;
    }
    const visibilityButton = event.target.closest("[data-feishu-showcase]");
    if (!visibilityButton || !documentList.contains(visibilityButton)) return;
    const record = documents.find((item) => item.id === visibilityButton.dataset.feishuShowcase);
    toggleShowcase(record, visibilityButton).catch(() => undefined);
  });
  deleteForm.addEventListener("submit", deleteDocument);
  deleteCloseButton.addEventListener("click", closeDeleteDialog);
  deleteCancelButton.addEventListener("click", closeDeleteDialog);
  deleteDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDeleteDialog();
  });
  deleteDialog.addEventListener("click", (event) => {
    if (event.target === deleteDialog) closeDeleteDialog();
  });
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
