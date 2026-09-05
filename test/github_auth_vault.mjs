import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Real Web Crypto; only IndexedDB and the user's authenticator are synthetic.
const source = readFileSync(new URL("../assets/js/github-auth-vault.js", import.meta.url), "utf8");
const owner = "Functionhx";
const repository = "Functionhx/functionhx.github.io";
const identity = { owner, repository };
const recordId = `github:${repository.toLowerCase()}`;
const password = "test-only-owner-password-2026";
const token = "synthetic-github-credential-never-valid";
const encoder = new TextEncoder();

function database(records) {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const transaction = {
              objectStore() {
                return {
                  get(id) {
                    const read = {};
                    queueMicrotask(() => {
                      read.result = structuredClone(records.get(id));
                      read.onsuccess?.();
                    });
                    return read;
                  },
                  put(record) {
                    records.set(record.id, structuredClone(record));
                    queueMicrotask(() => transaction.oncomplete?.());
                  },
                  delete(id) {
                    records.delete(id);
                    queueMicrotask(() => transaction.oncomplete?.());
                  },
                };
              },
            };
            return transaction;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function harness({ records = new Map(), sensor = {}, origin = "https://fanyuchen.com.cn", channels = [] } = {}) {
  const events = [];
  const listeners = new Map();
  const credentialId = Uint8Array.from([1, 4, 9, 16]);
  const calls = [];
  class Channel {
    constructor() {
      channels.push(this);
    }
    postMessage(data) {
      for (const peer of channels) if (peer !== this) peer.onmessage?.({ data });
    }
  }
  const credentials = {
    async create(options) {
      calls.push(["create", options]);
      assert.equal(options.publicKey.authenticatorSelection.authenticatorAttachment, "platform");
      assert.equal(options.publicKey.authenticatorSelection.userVerification, "required");
      if (sensor.cancelCreate) throw new DOMException("Canceled", "NotAllowedError");
      return { rawId: credentialId.buffer };
    },
    async get(options) {
      calls.push(["get", options]);
      assert.equal(options.publicKey.userVerification, "required");
      if (sensor.wait) await sensor.wait;
      if (sensor.cancelGet) throw new DOMException("Canceled", "NotAllowedError");
      const salt = options.publicKey.extensions.prf.eval.first;
      const input = new Uint8Array(salt.length + 1);
      input.set(salt);
      input[salt.length] = sensor.wrongSecret ? 2 : 1;
      const first = await webcrypto.subtle.digest("SHA-256", input);
      return {
        rawId: sensor.wrongId ? new Uint8Array([8, 8]).buffer : credentialId.buffer,
        getClientExtensionResults: () => (sensor.noPrf ? {} : { prf: { results: { first } } }),
      };
    },
  };
  const window = {
    isSecureContext: true,
    indexedDB: database(records),
    crypto: webcrypto,
    navigator: { credentials },
    PublicKeyCredential: class {},
    BroadcastChannel: Channel,
    location: { origin },
    dispatchEvent(event) {
      events.push(event);
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) || []), callback]);
    },
  };
  const context = vm.createContext({
    window,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Map,
    Array,
    Date,
    JSON,
    String,
    Boolean,
    Number,
    Object,
    DOMException,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
  });
  vm.runInContext(source, context);
  return { api: window.functionhxGitHubAuth, records, sensor, events, calls, window };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error.code === code);
}

const a = harness();
await a.api.save({ ...identity, token, remember: true });
assert.equal(a.records.get(recordId).version, 1);
assert.equal((await harness({ records: a.records }).api.restore(identity)).token, token, "legacy trusted devices still restore");
await a.api.saveOpaque({ id: "spark-session", value: "synthetic-spark-session" });

await a.api.protect({ ...identity, password });
const sealed = structuredClone(a.records.get(recordId));
assert.equal(sealed.version, 2);
assert.equal(sealed.token, undefined);
assert.equal(sealed.password, undefined);
assert.equal((await a.api.restore(identity)).token, token);
assert.equal((await a.api.protection(identity)).enabled, true);
assert.equal(new TextDecoder().decode(sealed.ciphertext).includes(token), false);

const b = harness({ records: a.records });
assert.equal(await b.api.restore(identity), null, "refresh must not unlock automatically");
assert.equal((await b.api.protection(identity)).locked, true);
assert.equal(b.calls.length, 0, "page loads must not prompt Touch ID");
assert.equal(await b.api.restoreOpaque({ id: "spark-session" }), "synthetic-spark-session", "Spark stays independent");
await expectCode(b.api.unlock({ ...identity, password: "incorrect-password-value" }), "invalid_unlock");
assert.deepEqual(b.records.get(recordId), sealed, "wrong password must preserve the binding");
assert.equal(await b.api.restore(identity), null);
b.sensor.wrongSecret = true;
await expectCode(b.api.unlock({ ...identity, password }), "invalid_unlock");
b.sensor.wrongSecret = false;
b.sensor.noPrf = true;
await expectCode(b.api.unlock({ ...identity, password }), "passkey_prf_unavailable");
b.sensor.noPrf = false;
b.sensor.wrongId = true;
await expectCode(b.api.unlock({ ...identity, password }), "wrong_passkey");
b.sensor.wrongId = false;
b.sensor.cancelGet = true;
await assert.rejects(b.api.unlock({ ...identity, password }), { name: "NotAllowedError" });
b.sensor.cancelGet = false;
assert.equal(await b.api.restore(identity), null);
assert.deepEqual(b.records.get(recordId), sealed);

const session = await b.api.unlock({ ...identity, password });
assert.equal(session.token, token);
assert.equal((await b.api.restore(identity)).protected, true);
b.api.lock(identity);
assert.equal(await b.api.restore(identity), null);

const wrongOrigin = harness({ records: a.records, origin: "https://functionhx.github.io" });
await expectCode(wrongOrigin.api.unlock({ ...identity, password }), "invalid_unlock");
assert.equal(await wrongOrigin.api.restore(identity), null, "copying the envelope to another origin must fail");

const tampered = structuredClone(sealed);
tampered.ciphertext = tampered.ciphertext.slice(0);
new Uint8Array(tampered.ciphertext)[0] ^= 1;
b.records.set(recordId, tampered);
await expectCode(b.api.unlock({ ...identity, password }), "invalid_unlock");
b.records.set(recordId, structuredClone(sealed));

await b.api.unlock({ ...identity, password });
await b.api.save({ ...identity, token: "synthetic-replacement-token", remember: true });
assert.equal(b.records.get(recordId).version, 2, "saving while unlocked must retain both factors");
b.api.lock(identity);
assert.equal((await b.api.unlock({ ...identity, password })).token, "synthetic-replacement-token");
b.window.dispatchEvent({ type: "pagehide" });
assert.equal(await b.api.restore(identity), null, "back-forward cache must not retain an unlocked credential");
await expectCode(b.api.save({ ...identity, token, remember: true }), "vault_locked");
assert.equal(await b.api.restore(identity), null, "failed saves must not populate the memory cache");

const protectedBeforeRecovery = structuredClone(b.records.get(recordId));
await b.api.save({ ...identity, token: "fresh-explicit-github-recovery", remember: false });
assert.deepEqual(b.records.get(recordId), protectedBeforeRecovery, "manual recovery must not silently delete the binding");
assert.equal((await b.api.restore(identity)).token, "fresh-explicit-github-recovery");

const original = harness();
await original.api.save({ ...identity, token, remember: true });
const oldRecord = structuredClone(original.records.get(recordId));
original.sensor.noPrf = true;
await expectCode(original.api.protect({ ...identity, password }), "passkey_prf_unavailable");
assert.deepEqual(original.records.get(recordId), oldRecord, "unsupported PRF must keep the old connection");
original.sensor.noPrf = false;
original.sensor.cancelCreate = true;
await assert.rejects(original.api.protect({ ...identity, password }), { name: "NotAllowedError" });
assert.deepEqual(original.records.get(recordId), oldRecord);
await expectCode(original.api.protect({ ...identity, password: "short" }), "password_too_short");

const unavailableStorage = harness();
unavailableStorage.window.indexedDB.open = () => {
  throw new Error("Storage blocked");
};
await assert.rejects(unavailableStorage.api.save({ ...identity, token, remember: true }));
await unavailableStorage.api.save({ ...identity, token, remember: false });
assert.equal((await unavailableStorage.api.restore(identity)).token, token, "page-only GitHub recovery works when storage is blocked");

const canceledSetup = harness();
await canceledSetup.api.save({ ...identity, token, remember: true });
const beforeSetup = structuredClone(canceledSetup.records.get(recordId));
let resumeSetup;
canceledSetup.sensor.wait = new Promise((resolve) => {
  resumeSetup = resolve;
});
const setupController = new AbortController();
const setupPending = canceledSetup.api.protect({ ...identity, password, signal: setupController.signal });
await new Promise((resolve) => setImmediate(resolve));
setupController.abort();
resumeSetup();
await assert.rejects(setupPending, { name: "AbortError" });
assert.deepEqual(canceledSetup.records.get(recordId), beforeSetup, "canceled setup must not replace a working connection");

const race = harness({ records: a.records });
let resume;
race.sensor.wait = new Promise((resolve) => {
  resume = resolve;
});
const pending = race.api.unlock({ ...identity, password });
await new Promise((resolve) => setImmediate(resolve));
race.api.lock(identity);
resume();
await assert.rejects(pending, { name: "AbortError" });
assert.equal(await race.api.restore(identity), null, "late WebAuthn completion cannot undo lock");

const aborting = harness({ records: a.records });
const controller = new AbortController();
controller.abort();
await assert.rejects(aborting.api.unlock({ ...identity, password, signal: controller.signal }), { name: "AbortError" });
assert.equal(aborting.calls.length, 0);

const sharedChannels = [];
const firstTab = harness({ records: a.records, channels: sharedChannels });
const secondTab = harness({ records: a.records, channels: sharedChannels });
await firstTab.api.unlock({ ...identity, password });
await secondTab.api.unlock({ ...identity, password });
firstTab.api.lock(identity);
assert.equal(await secondTab.api.restore(identity), null, "explicit lock must invalidate other open tabs");
await firstTab.api.forget(identity);
assert.equal(a.records.has(recordId), false);
assert.equal((await secondTab.api.protection(identity)).enabled, false);

console.log("Owner vault checks passed: both factors, migration, cancellation, tampering, origin binding, recovery, and cross-tab locking.");
