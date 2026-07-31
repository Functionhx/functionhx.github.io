(function initializeSparkVaultClient() {
  "use strict";

  const memorySessions = new Map();
  let redirectSession = "";

  function normalizeEndpoint(value) {
    const candidate = String(value || "")
      .trim()
      .replace(/\/$/, "");
    if (!candidate) return "";
    const parsed = new URL(candidate, window.location.href);
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      throw new Error("Spark Vault requires HTTPS.");
    }
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  }

  function consumeRedirectSession() {
    if (!window.location.hash) return;
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    if (!parameters.has("spark-session")) return;
    redirectSession = parameters.get("spark-session") || "";
    parameters.delete("spark-session");
    const suffix = parameters.toString();
    const clean = `${window.location.pathname}${window.location.search}${suffix ? `#${suffix}` : ""}`;
    window.history.replaceState(window.history.state, "", clean);
  }

  function storageId(endpoint) {
    return `spark-vault:${endpoint}`;
  }

  function announce(endpoint, connected, user = null) {
    window.dispatchEvent(
      new CustomEvent("functionhx:spark-vault-auth-changed", {
        detail: { connected, endpoint, user },
      })
    );
  }

  async function remember(endpoint, token) {
    memorySessions.set(endpoint, token);
    if (!window.functionhxGitHubAuth?.saveOpaque) return false;
    try {
      await window.functionhxGitHubAuth.saveOpaque({ id: storageId(endpoint), value: token });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function forget(endpoint) {
    memorySessions.delete(endpoint);
    await window.functionhxGitHubAuth?.forgetOpaque?.({ id: storageId(endpoint) }).catch(() => undefined);
  }

  async function storedToken(endpoint) {
    if (memorySessions.has(endpoint)) return memorySessions.get(endpoint);
    if (redirectSession) {
      const token = redirectSession;
      redirectSession = "";
      await remember(endpoint, token);
      return token;
    }
    const restored = await window.functionhxGitHubAuth?.restoreOpaque?.({ id: storageId(endpoint) }).catch(() => "");
    if (restored) memorySessions.set(endpoint, restored);
    return restored || "";
  }

  async function parseResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Spark Vault ${response.status}`);
      error.code = payload.error?.code || "request_failed";
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function request(endpointValue, path, options = {}) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (!endpoint) {
      const error = new Error("Spark Vault is not configured.");
      error.code = "vault_not_configured";
      error.status = 503;
      throw error;
    }
    const token = await storedToken(endpoint);
    if (!token) {
      const error = new Error("Sign in with GitHub to open Spark Vault.");
      error.code = "authentication_required";
      error.status = 401;
      throw error;
    }
    const headers = { Accept: "application/json", Authorization: `Bearer ${token}`, ...options.headers };
    let body;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const response = await window.fetch(`${endpoint}${path}`, {
      body,
      cache: "no-store",
      headers,
      method: options.method || "GET",
      mode: "cors",
    });
    const rotated = response.headers.get("X-Spark-Session") || "";
    if (rotated) await remember(endpoint, rotated);
    try {
      return await parseResponse(response);
    } catch (error) {
      if (error.status === 401) {
        await forget(endpoint);
        announce(endpoint, false);
      }
      throw error;
    }
  }

  async function restore(endpointValue) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (!endpoint) return null;
    const token = await storedToken(endpoint);
    if (!token) return null;
    try {
      const payload = await request(endpoint, "/api/session");
      const session = { endpoint, remembered: true, user: payload.user };
      announce(endpoint, true, session.user);
      return session;
    } catch (_error) {
      return null;
    }
  }

  async function login(endpointValue, options = {}) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (!endpoint) throw new Error("Spark Vault is not configured.");
    const returnTo = String(options.returnTo || `${window.location.pathname}${window.location.search}`);
    const loginUrl = `${endpoint}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
    const popup = window.open(loginUrl, "functionhx-spark-vault-login", "popup=yes,width=600,height=760");
    if (!popup) {
      window.location.assign(loginUrl);
      return new Promise(() => undefined);
    }
    const expectedOrigin = new URL(endpoint).origin;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("GitHub login timed out.")), 2 * 60 * 1000);
      const closed = window.setInterval(() => {
        if (popup.closed) finish(new Error("GitHub login was canceled."));
      }, 400);

      async function finish(error, message) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.clearInterval(closed);
        window.removeEventListener("message", onMessage);
        if (error) {
          reject(error);
          return;
        }
        const remembered = await remember(endpoint, message.data.token);
        const session = { endpoint, remembered, user: message.data.user || null };
        announce(endpoint, true, session.user);
        resolve(session);
      }

      function onMessage(event) {
        if (event.origin !== expectedOrigin || event.source !== popup) return;
        if (event.data?.type !== "functionhx:spark-vault-session" || typeof event.data.token !== "string") return;
        finish(null, event);
      }

      window.addEventListener("message", onMessage);
      popup.focus();
    });
  }

  async function logout(endpointValue) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (!endpoint) return;
    const token = await storedToken(endpoint);
    if (token) await request(endpoint, "/api/logout", { body: {}, method: "POST" }).catch(() => undefined);
    await forget(endpoint);
    announce(endpoint, false);
  }

  consumeRedirectSession();

  window.functionhxSparkVault = Object.freeze({
    login,
    logout,
    normalizeEndpoint,
    request,
    restore,
  });
})();
