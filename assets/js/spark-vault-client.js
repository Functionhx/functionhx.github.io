(function initializeSparkVaultClient() {
  "use strict";

  const memorySessions = new Map();
  const rootKeys = new Map();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sealedPrefix = "functionhx:zk2:";
  let redirectSession = "";

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = window.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function randomBytes(length) {
    return window.crypto.getRandomValues(new Uint8Array(length));
  }

  async function importRootKey(raw, usages) {
    return window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages);
  }

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
        rootKeys.delete(endpoint);
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
    } catch (error) {
      if (error?.status === 401 || error?.code === "authentication_required") return null;
      throw error;
    }
  }

  async function login(endpointValue, options = {}) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (!endpoint) throw new Error("Spark Vault is not configured.");
    const returnTo = String(options.returnTo || `${window.location.pathname}${window.location.search}`);
    const parameters = new URLSearchParams({ return_to: returnTo, site_origin: window.location.origin });
    const loginUrl = `${endpoint}/auth/login?${parameters}`;
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
    rootKeys.delete(endpoint);
    await forget(endpoint);
    announce(endpoint, false);
  }

  function isUnlocked(endpointValue) {
    const endpoint = normalizeEndpoint(endpointValue);
    return Boolean(endpoint && rootKeys.has(endpoint));
  }

  function lock(endpointValue) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (endpoint) rootKeys.delete(endpoint);
  }

  async function unlock(endpointValue, options = {}) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (!endpoint) throw new Error("Spark Vault is not configured.");
    if (rootKeys.has(endpoint)) return { decoy: false, unlocked: true };
    const token = await storedToken(endpoint);
    const intent = options.intent === "strong" ? "strong" : options.intent === "decoy" ? "decoy" : "";
    let popupUrl = "";
    if (token) {
      const parameters = new URLSearchParams({ session: token, site_origin: window.location.origin });
      if (intent === "strong") parameters.set("intent", intent);
      popupUrl = `${endpoint}/unlock#${parameters}`;
    } else if (intent) {
      const returnTo = String(options.returnTo || `${window.location.pathname}${window.location.search}`);
      const parameters = new URLSearchParams({
        continuation: intent === "strong" ? "strong-unlock" : "decoy-unlock",
        return_to: returnTo,
        site_origin: window.location.origin,
      });
      popupUrl = `${endpoint}/auth/login?${parameters}`;
    } else {
      const error = new Error("Sign in with GitHub before unlocking Spark Vault.");
      error.code = "authentication_required";
      error.status = 401;
      throw error;
    }
    const popup = window.open(popupUrl, "functionhx-spark-vault-unlock", "popup=yes,width=520,height=720");
    if (!popup) throw new Error("Allow the Spark Vault unlock popup and try again.");
    const expectedOrigin = new URL(endpoint).origin;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("Spark Vault unlock timed out.")), 3 * 60 * 1000);
      const closed = window.setInterval(() => {
        if (!popup.closed) return;
        const error = new Error("Spark Vault unlock was canceled.");
        error.code = "unlock_canceled";
        finish(error);
      }, 400);

      function cleanup() {
        window.clearTimeout(timeout);
        window.clearInterval(closed);
        window.removeEventListener("message", onMessage);
      }

      async function finish(error, payload = null) {
        if (settled) return false;
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return false;
        }
        if (payload?.decoy) {
          resolve({ decoy: true, unlocked: false });
          return true;
        }
        try {
          const raw = base64UrlToBytes(payload.root);
          if (raw.length !== 32) throw new Error("Spark Vault returned an invalid root key.");
          rootKeys.set(endpoint, await importRootKey(raw, ["encrypt", "decrypt"]));
          let session = null;
          if (typeof payload.session === "string" && payload.session) {
            const remembered = await remember(endpoint, payload.session);
            session = { endpoint, remembered, user: payload.user || null };
            announce(endpoint, true, session.user);
          }
          resolve({ decoy: false, session, unlocked: true });
          return true;
        } catch (keyError) {
          reject(keyError);
          return false;
        }
      }

      function acknowledge(event) {
        if (typeof event.data?.requestId !== "string" || !event.data.requestId) return;
        try {
          event.source?.postMessage({ requestId: event.data.requestId, type: "functionhx:spark-vault-ack" }, expectedOrigin);
        } catch (_error) {
          // The popup also has a short close fallback when acknowledgement is unavailable.
        }
      }

      async function onMessage(event) {
        if (event.origin !== expectedOrigin || event.source !== popup) return;
        if (event.data?.type === "functionhx:spark-vault-decoy") {
          if (await finish(null, { decoy: true })) acknowledge(event);
          return;
        }
        if (event.data?.type !== "functionhx:spark-vault-unlocked" || typeof event.data.root !== "string") return;
        if (
          await finish(null, {
            root: event.data.root,
            session: event.data.session,
            user: event.data.user,
          })
        ) {
          acknowledge(event);
        }
      }

      window.addEventListener("message", onMessage);
      popup.focus();
    });
  }

  function isSealed(value) {
    return String(value || "").startsWith(sealedPrefix);
  }

  async function sealValues(endpointValue, idValue, values) {
    const endpoint = normalizeEndpoint(endpointValue);
    const id = String(idValue || "");
    const rootKey = rootKeys.get(endpoint);
    if (!rootKey) {
      const error = new Error("Spark Vault must be unlocked before encrypting private content.");
      error.code = "vault_locked";
      throw error;
    }
    const dataKeyBytes = randomBytes(32);
    const dataKey = await window.crypto.subtle.importKey("raw", dataKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
    const contentIv = randomBytes(12);
    const keyIv = randomBytes(12);
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: contentIv, additionalData: encoder.encode(`functionhx:spark-values:${id}:v2`) },
      dataKey,
      encoder.encode(JSON.stringify(values))
    );
    const wrappedKey = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: keyIv, additionalData: encoder.encode(`functionhx:spark-data-key:${id}:v2`) },
      rootKey,
      dataKeyBytes
    );
    const envelope = {
      algorithm: "A256GCM",
      ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
      content_iv: bytesToBase64Url(contentIv),
      id,
      key_iv: bytesToBase64Url(keyIv),
      version: 2,
      wrapped_key: bytesToBase64Url(new Uint8Array(wrappedKey)),
    };
    return sealedPrefix + bytesToBase64Url(encoder.encode(JSON.stringify(envelope)));
  }

  async function openValues(endpointValue, idValue, sealedValue) {
    const endpoint = normalizeEndpoint(endpointValue);
    const id = String(idValue || "");
    const rootKey = rootKeys.get(endpoint);
    if (!rootKey) {
      const error = new Error("Spark Vault must be unlocked before decrypting private content.");
      error.code = "vault_locked";
      throw error;
    }
    try {
      const value = String(sealedValue || "");
      if (!isSealed(value)) throw new Error("not sealed");
      const envelope = JSON.parse(decoder.decode(base64UrlToBytes(value.slice(sealedPrefix.length))));
      if (envelope.version !== 2 || envelope.algorithm !== "A256GCM" || envelope.id !== id) throw new Error("invalid envelope");
      const dataKeyBytes = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64UrlToBytes(envelope.key_iv),
          additionalData: encoder.encode(`functionhx:spark-data-key:${id}:v2`),
        },
        rootKey,
        base64UrlToBytes(envelope.wrapped_key)
      );
      const dataKey = await window.crypto.subtle.importKey("raw", dataKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
      const plaintext = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64UrlToBytes(envelope.content_iv),
          additionalData: encoder.encode(`functionhx:spark-values:${id}:v2`),
        },
        dataKey,
        base64UrlToBytes(envelope.ciphertext)
      );
      return JSON.parse(decoder.decode(plaintext));
    } catch (error) {
      if (error.code === "vault_locked") throw error;
      const failure = new Error("This private Spark could not be decrypted with the current vault key.");
      failure.code = "decrypt_failed";
      throw failure;
    }
  }

  consumeRedirectSession();

  window.functionhxSparkVault = Object.freeze({
    isSealed,
    isUnlocked,
    login,
    lock,
    logout,
    normalizeEndpoint,
    openValues,
    request,
    restore,
    sealValues,
    unlock,
  });
})();
