(function initializeGitHubAuthVault() {
  "use strict";

  const databaseName = "functionhx-site-auth";
  const storeName = "vault";
  const keyRecordId = "device-key";
  const memoryCredentials = new Map();
  const sealingKeys = new Map();
  const revisions = new Map();
  const passkeyAlgorithm = "A256GCM+PBKDF2+WebAuthn-PRF";
  const passkeyIterations = 600_000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let databasePromise = null;
  const channel = typeof window.BroadcastChannel === "function" ? new window.BroadcastChannel("functionhx-owner-lock") : null;

  function vaultError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function revision(id) {
    return revisions.get(id) || 0;
  }

  function invalidate(id) {
    revisions.set(id, revision(id) + 1);
    memoryCredentials.delete(id);
    sealingKeys.delete(id);
  }

  function checkOperation(id, expected, signal) {
    if (signal?.aborted || revision(id) !== expected) throw new DOMException("The vault operation was canceled.", "AbortError");
  }

  if (channel) {
    channel.onmessage = (event) => {
      const repository = event.data?.repository;
      if (event.data?.type !== "lock" || typeof repository !== "string") return;
      invalidate(credentialId(repository));
      announce(repository, false, false);
    };
  }
  window.addEventListener("pagehide", () => {
    for (const [id, credential] of memoryCredentials) {
      if (!credential.protected) continue;
      invalidate(id);
      announce(credential.repository, false, false);
    }
  });

  function credentialId(repository) {
    return `github:${String(repository || "").toLowerCase()}`;
  }

  function supportsTrustedDevice() {
    return Boolean(window.isSecureContext && window.indexedDB && window.crypto?.subtle);
  }

  function openDatabase() {
    if (!supportsTrustedDevice()) return Promise.reject(new Error("Secure browser storage is unavailable."));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the trusted-device vault."));
    });
    return databasePromise;
  }

  async function readRecord(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read the trusted-device vault."));
    });
  }

  async function writeRecord(record) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not update the trusted-device vault."));
      transaction.onabort = () => reject(transaction.error || new Error("The trusted-device vault update was canceled."));
    });
  }

  async function deleteRecord(id) {
    if (!supportsTrustedDevice()) return;
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear the trusted-device vault."));
      transaction.onabort = () => reject(transaction.error || new Error("The trusted-device vault update was canceled."));
    });
  }

  async function deviceKey() {
    const existing = await readRecord(keyRecordId);
    if (existing?.key) return existing.key;
    const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await writeRecord({ id: keyRecordId, key, version: 1 });
    return key;
  }

  function announce(repository, connected, remembered) {
    window.dispatchEvent(
      new CustomEvent("functionhx:github-auth-changed", {
        detail: { connected, remembered, repository },
      })
    );
  }

  function lock({ repository }) {
    invalidate(credentialId(repository));
    announce(repository, false, false);
    channel?.postMessage({ type: "lock", repository });
  }

  async function protection({ owner, repository }) {
    const record = await readRecord(credentialId(repository));
    const enabled = record?.version === 2 && record.owner?.toLowerCase() === String(owner).toLowerCase();
    return { enabled, locked: enabled && !memoryCredentials.has(credentialId(repository)) };
  }

  function supportsPasskey() {
    return Boolean(
      supportsTrustedDevice() && window.PublicKeyCredential && window.navigator?.credentials?.create && window.navigator.credentials.get
    );
  }

  function randomBytes(length) {
    return window.crypto.getRandomValues(new Uint8Array(length));
  }

  function passkeyAad(owner, repository) {
    return encoder.encode(JSON.stringify(["function-owner-passkey-v2", window.location.origin, owner.toLowerCase(), repository.toLowerCase()]));
  }

  function validateProtectedRecord(record) {
    if (
      record.version !== 2 ||
      record.algorithm !== passkeyAlgorithm ||
      record.iterations !== passkeyIterations ||
      !record.ciphertext ||
      !["iv", "passwordSalt", "prfSalt", "combineSalt", "credentialId"].every(
        (field) => Array.isArray(record[field]) && record[field].every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ) ||
      record.iv.length !== 12 ||
      record.passwordSalt.length !== 24 ||
      record.combineSalt.length !== 24 ||
      record.prfSalt.length !== 32 ||
      !record.credentialId.length ||
      record.credentialId.length > 1024
    ) {
      throw vaultError("invalid_protected_record");
    }
  }

  async function deriveSealingKey(password, prf, record) {
    const passwordBytes = encoder.encode(password.normalize("NFKC"));
    const passwordKey = await window.crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
    passwordBytes.fill(0);
    const bits = new Uint8Array(
      await window.crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(record.passwordSalt), iterations: record.iterations },
        passwordKey,
        256
      )
    );
    const material = new Uint8Array(bits.length + prf.length);
    material.set(bits);
    material.set(prf, bits.length);
    const combined = await window.crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
    bits.fill(0);
    material.fill(0);
    return window.crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(record.combineSalt), info: passkeyAad(record.owner, record.repository) },
      combined,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function evaluatePrf(record, signal) {
    const credential = await window.navigator.credentials.get({
      signal,
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: new Uint8Array(record.credentialId), type: "public-key" }],
        extensions: { prf: { eval: { first: new Uint8Array(record.prfSalt) } } },
        userVerification: "required",
        timeout: 60_000,
      },
    });
    if (!credential || String(Array.from(new Uint8Array(credential.rawId))) !== String(record.credentialId)) {
      throw vaultError("wrong_passkey");
    }
    const result = credential.getClientExtensionResults?.().prf?.results?.first;
    if (!result || result.byteLength !== 32) throw vaultError("passkey_prf_unavailable");
    return new Uint8Array(result).slice();
  }

  async function protect({ owner, repository, password, signal }) {
    if (!supportsPasskey()) throw vaultError("passkey_unavailable");
    if (typeof password !== "string" || password.normalize("NFKC").length < 16) throw vaultError("password_too_short");
    const session = await restore({ owner, repository });
    if (!session?.token) throw vaultError("github_connection_required");
    const id = credentialId(repository);
    const expected = revision(id);
    checkOperation(id, expected, signal);
    const record = {
      id,
      owner,
      repository,
      version: 2,
      algorithm: passkeyAlgorithm,
      iterations: passkeyIterations,
      passwordSalt: Array.from(randomBytes(24)),
      combineSalt: Array.from(randomBytes(24)),
      prfSalt: Array.from(randomBytes(32)),
      iv: Array.from(randomBytes(12)),
      savedAt: new Date().toISOString(),
    };
    const credential = await window.navigator.credentials.create({
      signal,
      publicKey: {
        attestation: "none",
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        rp: { name: "Function 站长" },
        user: { id: randomBytes(32), name: owner, displayName: "Function 站长解锁" },
        extensions: { prf: { eval: { first: new Uint8Array(record.prfSalt) } } },
        timeout: 60_000,
      },
    });
    if (!credential?.rawId) throw vaultError("passkey_unavailable");
    checkOperation(id, expected, signal);
    record.credentialId = Array.from(new Uint8Array(credential.rawId));
    // Confirm that a later get() can produce the PRF before replacing the old vault.
    const prf = await evaluatePrf(record, signal);
    const key = await deriveSealingKey(password, prf, record);
    prf.fill(0);
    const plaintext = encoder.encode(JSON.stringify({ owner, repository, token: session.token, savedAt: record.savedAt }));
    record.ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: passkeyAad(owner, repository) },
      key,
      plaintext
    );
    plaintext.fill(0);
    checkOperation(id, expected, signal);
    await writeRecord(record);
    checkOperation(id, expected, signal);
    sealingKeys.set(id, key);
    memoryCredentials.set(id, { ...session, remembered: true, protected: true });
    channel?.postMessage({ type: "lock", repository });
    announce(repository, true, true);
    return { enabled: true };
  }

  async function unlock({ owner, repository, password, signal }) {
    if (!supportsPasskey()) throw vaultError("passkey_unavailable");
    if (typeof password !== "string" || !password) throw vaultError("password_required");
    const id = credentialId(repository);
    const expected = revision(id);
    const record = await readRecord(id);
    if (!record || record.owner?.toLowerCase() !== String(owner).toLowerCase()) throw vaultError("github_connection_required");
    validateProtectedRecord(record);
    checkOperation(id, expected, signal);
    const prf = await evaluatePrf(record, signal);
    const key = await deriveSealingKey(password, prf, record);
    prf.fill(0);
    let plaintext;
    try {
      plaintext = new Uint8Array(
        await window.crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: passkeyAad(owner, repository) },
          key,
          record.ciphertext
        )
      );
    } catch (_error) {
      throw vaultError("invalid_unlock");
    }
    const credential = JSON.parse(decoder.decode(plaintext));
    plaintext.fill(0);
    if (
      credential.owner?.toLowerCase() !== String(owner).toLowerCase() ||
      credential.repository?.toLowerCase() !== repository.toLowerCase() ||
      !credential.token
    ) {
      throw vaultError("invalid_unlock");
    }
    checkOperation(id, expected, signal);
    const session = { ...credential, remembered: true, protected: true };
    sealingKeys.set(id, key);
    memoryCredentials.set(id, session);
    announce(repository, true, true);
    return session;
  }

  async function save({ owner, remember = false, repository, token }) {
    const normalized = {
      owner: String(owner || ""),
      repository: String(repository || ""),
      savedAt: new Date().toISOString(),
      token: String(token || ""),
    };
    if (!normalized.owner || !normalized.repository || !normalized.token) throw new Error("Incomplete GitHub credential.");

    const id = credentialId(normalized.repository);
    const expected = revision(id);
    let storageFailed = false;
    const existing = supportsTrustedDevice()
      ? await readRecord(id).catch((error) => {
          if (remember) throw error;
          storageFailed = true;
          return null;
        })
      : null;
    checkOperation(id, expected);
    if (!remember) {
      // Explicit GitHub recovery may create a page-only session without destroying a protected binding.
      if (!storageFailed && existing?.version !== 2) await deleteRecord(id).catch(() => undefined);
      checkOperation(id, expected);
      memoryCredentials.set(id, { ...normalized, remembered: false });
      announce(normalized.repository, true, false);
      return { remembered: false };
    }
    if (!supportsTrustedDevice()) throw new Error("This browser cannot securely remember the device.");

    if (existing?.version === 2 && !sealingKeys.has(id)) throw vaultError("vault_locked");
    const key = existing?.version === 2 ? sealingKeys.get(id) : await deviceKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const parameters = { name: "AES-GCM", iv };
    if (existing?.version === 2) parameters.additionalData = passkeyAad(owner, repository);
    const ciphertext = await window.crypto.subtle.encrypt(parameters, key, encoder.encode(JSON.stringify(normalized)));
    checkOperation(id, expected);
    await writeRecord({
      ...(existing?.version === 2 ? existing : {}),
      ciphertext,
      id,
      iv: Array.from(iv),
      owner: normalized.owner,
      repository: normalized.repository,
      savedAt: normalized.savedAt,
      version: existing?.version === 2 ? 2 : 1,
    });
    checkOperation(id, expected);
    memoryCredentials.set(id, { ...normalized, remembered: true, protected: existing?.version === 2 });
    announce(normalized.repository, true, true);
    return { remembered: true };
  }

  async function restore({ owner, repository }) {
    const id = credentialId(repository);
    const expected = revision(id);
    const memory = memoryCredentials.get(id);
    if (memory?.token && memory.owner.toLowerCase() === String(owner).toLowerCase()) return memory;
    if (!supportsTrustedDevice()) return null;

    const record = await readRecord(id).catch(() => null);
    if (!record?.ciphertext || !Array.isArray(record.iv)) return null;
    // A page load must never silently decrypt a password + Passkey envelope.
    if (record.version !== 1) return null;
    try {
      const key = await deviceKey();
      const plaintext = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv) }, key, record.ciphertext);
      const credential = JSON.parse(decoder.decode(plaintext));
      if (
        typeof credential.token !== "string" ||
        credential.owner.toLowerCase() !== String(owner).toLowerCase() ||
        credential.repository.toLowerCase() !== String(repository).toLowerCase()
      ) {
        throw new Error("The remembered credential does not match this site.");
      }
      const restored = { ...credential, remembered: true };
      checkOperation(id, expected);
      memoryCredentials.set(id, restored);
      return restored;
    } catch (_error) {
      // Do not erase credentials because storage/decryption temporarily failed.
      return null;
    }
  }

  async function forget({ repository }) {
    const id = credentialId(repository);
    invalidate(id);
    await deleteRecord(id).catch(() => undefined);
    announce(String(repository || ""), false, false);
    channel?.postMessage({ type: "lock", repository });
  }

  function opaqueId(id) {
    const normalized = String(id || "").trim();
    if (!normalized) throw new Error("A device-vault id is required.");
    return `opaque:${normalized}`;
  }

  async function saveOpaque({ id, value }) {
    if (!supportsTrustedDevice()) throw new Error("This browser cannot securely remember the device.");
    const normalized = String(value || "");
    if (!normalized) throw new Error("An opaque device credential is required.");
    const key = await deviceKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(normalized));
    await writeRecord({
      ciphertext,
      id: opaqueId(id),
      iv: Array.from(iv),
      savedAt: new Date().toISOString(),
      version: 1,
    });
  }

  async function restoreOpaque({ id }) {
    if (!supportsTrustedDevice()) return "";
    const recordId = opaqueId(id);
    const record = await readRecord(recordId).catch(() => null);
    if (!record?.ciphertext || !Array.isArray(record.iv)) return "";
    try {
      const key = await deviceKey();
      const plaintext = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv) }, key, record.ciphertext);
      return decoder.decode(plaintext);
    } catch (_error) {
      await deleteRecord(recordId).catch(() => undefined);
      return "";
    }
  }

  async function forgetOpaque({ id }) {
    await deleteRecord(opaqueId(id)).catch(() => undefined);
  }

  window.functionhxGitHubAuth = Object.freeze({
    lock,
    protection,
    protect,
    unlock,
    supportsPasskey,
    forget,
    forgetOpaque,
    restore,
    restoreOpaque,
    save,
    saveOpaque,
    supportsTrustedDevice,
  });
})();
