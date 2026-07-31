(function initializeGitHubAuthVault() {
  "use strict";

  const databaseName = "functionhx-site-auth";
  const storeName = "vault";
  const keyRecordId = "device-key";
  const memoryCredentials = new Map();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let databasePromise = null;

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

  async function save({ owner, remember = false, repository, token }) {
    const normalized = {
      owner: String(owner || ""),
      repository: String(repository || ""),
      savedAt: new Date().toISOString(),
      token: String(token || ""),
    };
    if (!normalized.owner || !normalized.repository || !normalized.token) throw new Error("Incomplete GitHub credential.");

    const id = credentialId(normalized.repository);
    memoryCredentials.set(id, { ...normalized, remembered: Boolean(remember) });
    if (!remember) {
      await deleteRecord(id).catch(() => undefined);
      announce(normalized.repository, true, false);
      return { remembered: false };
    }
    if (!supportsTrustedDevice()) throw new Error("This browser cannot securely remember the device.");

    const key = await deviceKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(normalized)));
    await writeRecord({
      ciphertext,
      id,
      iv: Array.from(iv),
      owner: normalized.owner,
      repository: normalized.repository,
      savedAt: normalized.savedAt,
      version: 1,
    });
    announce(normalized.repository, true, true);
    return { remembered: true };
  }

  async function restore({ owner, repository }) {
    const id = credentialId(repository);
    const memory = memoryCredentials.get(id);
    if (memory?.token && memory.owner.toLowerCase() === String(owner).toLowerCase()) return memory;
    if (!supportsTrustedDevice()) return null;

    const record = await readRecord(id).catch(() => null);
    if (!record?.ciphertext || !Array.isArray(record.iv)) return null;
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
      memoryCredentials.set(id, restored);
      return restored;
    } catch (_error) {
      await deleteRecord(id).catch(() => undefined);
      return null;
    }
  }

  async function forget({ repository }) {
    const id = credentialId(repository);
    memoryCredentials.delete(id);
    await deleteRecord(id).catch(() => undefined);
    announce(String(repository || ""), false, false);
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
    forget,
    forgetOpaque,
    restore,
    restoreOpaque,
    save,
    saveOpaque,
    supportsTrustedDevice,
  });
})();
