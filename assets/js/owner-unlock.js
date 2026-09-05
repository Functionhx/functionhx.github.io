(function initializeOwnerUnlock() {
  "use strict";
  const dialog = document.getElementById("site-owner-unlock");
  const vault = window.functionhxGitHubAuth;
  if (!dialog || !vault) return;
  const english = document.documentElement.lang === "en";
  const text = english
    ? {
        setupTitle: "Set up owner unlock",
        unlockTitle: "Unlock owner access",
        setupCopy: "Choose a separate password of at least 16 characters, then follow the system prompts to set up Touch ID.",
        unlockCopy: "Enter your owner password, then verify with Touch ID. Refreshing or leaving this page locks it again.",
        setupSubmit: "Set up Touch ID",
        unlockSubmit: "Continue with Touch ID",
        device: "This binding is for this browser on {host}. macOS may offer a device password instead of Touch ID.",
        waiting: "Follow the system prompts. First-time setup may ask you to verify twice.",
        mismatch: "The passwords do not match.",
        canceled: "System verification was canceled. You can try again.",
        storage: "The browser could not save the binding. Your existing GitHub connection is unchanged.",
        errors: {
          password_too_short: "Use at least 16 characters for your owner password.",
          password_required: "Enter your owner password.",
          passkey_unavailable: "Touch ID unlock is unavailable in this browser. Your GitHub connection still works.",
          passkey_prf_unavailable:
            "This browser or passkey does not support encrypted unlock. Try a supported browser or passkey; your existing connection is unchanged.",
          github_connection_required: "Connect GitHub first, then set up Touch ID.",
          invalid_unlock: "The password or passkey did not unlock this binding. Please try again.",
          wrong_passkey: "Use the passkey registered for this owner binding.",
          invalid_protected_record: "This browser's binding cannot be read. Reconnect GitHub to set it up again.",
        },
      }
    : {
        setupTitle: "设置站长解锁",
        unlockTitle: "解锁站长",
        setupCopy: "设置一个至少 16 个字符的独立密码，再按系统提示绑定 Touch ID。",
        unlockCopy: "输入站长密码，再通过 Touch ID 验证。刷新或离开本页后会重新锁定。",
        setupSubmit: "绑定 Touch ID",
        unlockSubmit: "继续验证 Touch ID",
        device: "此绑定用于当前浏览器的 {host}。macOS 也可能提供设备密码验证选项。",
        waiting: "请按系统提示操作，首次绑定可能需要验证两次。",
        mismatch: "两次输入的密码不一致。",
        canceled: "已取消系统验证，可以重新尝试。",
        storage: "浏览器未能保存绑定，原有 GitHub 连接仍然可用。",
        errors: {
          password_too_short: "站长密码至少需要 16 个字符。",
          password_required: "请输入站长密码。",
          passkey_unavailable: "当前浏览器无法使用 Touch ID 解锁，原有 GitHub 连接仍然可用。",
          passkey_prf_unavailable: "当前浏览器或通行密钥不支持此加密解锁方式，请换用支持的浏览器或通行密钥重试；原有连接未改变。",
          github_connection_required: "请先连接 GitHub，再绑定 Touch ID。",
          invalid_unlock: "密码或通行密钥未能解锁此绑定，请重试。",
          wrong_passkey: "请选择绑定本站时创建的通行密钥。",
          invalid_protected_record: "无法读取当前浏览器的绑定，请重新连接 GitHub 后设置。",
        },
      };
  const elements = {
    form: document.getElementById("site-owner-unlock-form"),
    heading: document.getElementById("site-owner-unlock-heading"),
    copy: document.getElementById("site-owner-unlock-copy"),
    password: document.getElementById("site-owner-password"),
    confirmation: document.getElementById("site-owner-password-confirmation"),
    confirm: document.getElementById("site-owner-password-confirm"),
    device: document.getElementById("site-owner-unlock-device"),
    status: document.getElementById("site-owner-unlock-status"),
    submit: document.getElementById("site-owner-unlock-submit"),
    close: document.getElementById("site-owner-unlock-close"),
    reconnect: document.getElementById("site-owner-unlock-reconnect"),
  };
  if (Object.values(elements).some((element) => !element)) return;
  let request = null;

  function setStatus(message = "", error = false) {
    elements.status.textContent = message;
    elements.status.dataset.state = error ? "error" : "";
  }

  function finish(value = null) {
    const pending = request;
    request = null;
    pending?.controller?.abort();
    elements.password.value = "";
    elements.confirm.value = "";
    if (dialog.open) dialog.close();
    pending?.resolve(value);
  }

  function open({ owner, repository, setup = false }) {
    if (request) return request.promise;
    const pending = { owner, repository, setup, controller: null };
    pending.promise = new Promise((resolve) => {
      pending.resolve = resolve;
    });
    request = pending;
    elements.heading.textContent = setup ? text.setupTitle : text.unlockTitle;
    elements.copy.textContent = setup ? text.setupCopy : text.unlockCopy;
    elements.device.textContent = text.device.replace("{host}", window.location.hostname);
    elements.submit.textContent = setup ? text.setupSubmit : text.unlockSubmit;
    elements.password.autocomplete = setup ? "new-password" : "current-password";
    elements.password.minLength = setup ? 16 : 1;
    elements.password.value = "";
    elements.confirm.value = "";
    elements.confirm.required = setup;
    elements.confirmation.hidden = !setup;
    elements.reconnect.hidden = setup;
    elements.submit.disabled = false;
    elements.reconnect.disabled = false;
    setStatus();
    dialog.showModal();
    elements.password.focus();
    return pending.promise;
  }

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pending = request;
    if (!pending || pending.controller) return;
    if (pending.setup && elements.password.value !== elements.confirm.value) {
      setStatus(text.mismatch, true);
      return;
    }
    const password = elements.password.value;
    elements.password.value = "";
    elements.confirm.value = "";
    pending.controller = new AbortController();
    elements.submit.disabled = true;
    elements.reconnect.disabled = true;
    setStatus(text.waiting);
    try {
      const options = { owner: pending.owner, repository: pending.repository, password, signal: pending.controller.signal };
      if (pending.setup) await vault.protect(options);
      else await vault.unlock(options);
      if (request === pending) finish({ success: true });
    } catch (error) {
      if (request !== pending) return;
      const canceled = error.name === "NotAllowedError" || error.name === "AbortError";
      setStatus(canceled ? text.canceled : text.errors[error.code] || text.storage, true);
      elements.password.focus();
    } finally {
      if (request === pending) {
        pending.controller = null;
        elements.submit.disabled = false;
        elements.reconnect.disabled = false;
      }
    }
  });
  elements.close.addEventListener("click", () => finish());
  elements.reconnect.addEventListener("click", () => finish({ reconnect: true }));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  dialog.addEventListener("close", () => {
    if (request) finish();
  });
  window.addEventListener("pagehide", () => finish());
  window.functionhxOwnerUnlock = Object.freeze({ open });
})();
