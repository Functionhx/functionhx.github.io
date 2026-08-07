import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import worker, { testing } from "../spark-vault/worker.mjs";

const siteOrigin = "https://functionhx.github.io";
const mirrorOrigin = "https://fanyuchen.com.cn";
const workerOrigin = "https://spark-vault.test";
const privateRepo = "Functionhx/functionhx-spark-private";
const connectionPath = "integrations/feishu/oauth.v1.json";
const validSha = (value) => createHash("sha1").update(String(value)).digest("hex");
const now = Math.floor(Date.now() / 1000);
const env = {
  ALLOWED_FEISHU_OPEN_ID: "ou_owner",
  ALLOWED_FEISHU_TENANT_KEY: "tenant_owner",
  ALLOWED_GITHUB_USER_ID: "172989722",
  FEISHU_ACCOUNTS_BASE: "https://accounts.feishu.test",
  FEISHU_API_BASE: "https://open.feishu.test",
  FEISHU_CLIENT_ID: "cli_feishu_test",
  FEISHU_CLIENT_SECRET: "not-a-real-feishu-secret",
  GITHUB_API_BASE: "https://api.github.test",
  GITHUB_CLIENT_ID: "Iv1.spark-vault-test",
  GITHUB_CLIENT_SECRET: "not-a-real-github-secret",
  MASTER_KEY_B64: Buffer.alloc(32, 29).toString("base64url"),
  PRIVATE_BRANCH: "main",
  PRIVATE_REPO: privateRepo,
  PUBLIC_BRANCH: "main",
  PUBLIC_REPO: "Functionhx/functionhx.github.io",
  SESSION_KEY_B64: Buffer.alloc(32, 17).toString("base64url"),
  SITE_ORIGINS: `${siteOrigin},${mirrorOrigin}`,
  WORKER_ORIGIN: workerOrigin,
};

const files = new Map();
const feishuTokenBodies = [];
const feishuCalls = [];
let currentFeishuIdentity = { name: "Owner", open_id: "ou_owner", tenant_key: "tenant_owner" };
let authorizationCounter = 0;
let createCounter = 0;
let refreshCounter = 0;
let holdCreate = null;
let holdRefresh = null;
let nextCreateFailure = "";
let mismatchNextMetadata = false;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" }, status });
}

function fileKey(repository, path) {
  return `${repository}:${path}`;
}

function decodeRepository(pathname) {
  const match = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
  if (!match) return null;
  return { repository: `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`, suffix: match[3] || "" };
}

function callbackPayload(html) {
  const match = html.match(/const payload=(\{.*?\});const target=/);
  assert.ok(match, "the Feishu callback must post a structured result");
  return JSON.parse(match[1]);
}

async function withoutExpectedServerLog(action) {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    return await action();
  } finally {
    console.error = originalConsoleError;
  }
}

function apiRequest(path, method, sessionToken, body, origin = siteOrigin, environment = env) {
  const headers = { Authorization: `Bearer ${sessionToken}`, Origin: origin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return worker.fetch(
    new Request(`${workerOrigin}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
    }),
    environment
  );
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);

  if (url.origin === "https://api.github.test") {
    const parsed = decodeRepository(decodeURIComponent(url.pathname));
    if (!parsed) return json({ message: "Not Found" }, 404);
    const { repository, suffix } = parsed;
    if (!suffix.startsWith("/contents/")) return json({ message: "Not Found" }, 404);
    const path = decodeURIComponent(suffix.slice("/contents/".length));
    const key = fileKey(repository, path);
    if (request.method === "GET") {
      const file = files.get(key);
      if (file) {
        return json({ content: Buffer.from(file.content, "utf8").toString("base64"), path, sha: file.sha, type: "file" });
      }
      const prefix = `${repository}:${path.replace(/\/$/, "")}/`;
      const entries = [...files.entries()]
        .filter(([storedKey]) => storedKey.startsWith(prefix) && !storedKey.slice(prefix.length).includes("/"))
        .map(([storedKey, storedFile]) => {
          const storedPath = storedKey.slice(`${repository}:`.length);
          return {
            name: storedPath.slice(storedPath.lastIndexOf("/") + 1),
            path: storedPath,
            sha: storedFile.sha,
            type: "file",
          };
        });
      return entries.length ? json(entries) : json({ message: "Not Found" }, 404);
    }
    if (request.method === "PUT") {
      const body = await request.json();
      const existing = files.get(key);
      if ((existing && body.sha !== existing.sha) || (!existing && body.sha)) return json({ message: "Conflict" }, 409);
      const content = Buffer.from(body.content, "base64").toString("utf8");
      const sha = validSha(`${content}:${existing?.sha || "new"}`);
      files.set(key, { content, message: body.message, sha });
      return json({ commit: { sha: validSha(`commit:${sha}`) }, content: { path, sha } }, existing ? 200 : 201);
    }
    return json({ message: "Method Not Allowed" }, 405);
  }

  if (url.origin === "https://open.feishu.test") {
    const authorization = request.headers.get("Authorization") || "";
    feishuCalls.push({ authorization, method: request.method, path: `${url.pathname}${url.search}` });
    if (url.pathname === "/open-apis/authen/v2/oauth/token" && request.method === "POST") {
      const body = await request.json();
      feishuTokenBodies.push(body);
      if (body.grant_type === "authorization_code") {
        authorizationCounter += 1;
        return json({
          access_token: `u_access_authorization_${authorizationCounter}`,
          code: 0,
          expires_in: 7200,
          refresh_token: `u_refresh_authorization_${authorizationCounter}`,
          refresh_token_expires_in: 604800,
          scope: "docx:document:create drive:drive.metadata:readonly offline_access",
          token_type: "Bearer",
        });
      }
      if (body.grant_type === "refresh_token") {
        refreshCounter += 1;
        if (holdRefresh) {
          holdRefresh.notifyStarted();
          await holdRefresh.promise;
        }
        return json({
          access_token: `u_access_refreshed_${refreshCounter}`,
          code: 0,
          expires_in: 7200,
          refresh_token: `u_refresh_rotated_${refreshCounter}`,
          refresh_token_expires_in: 604800,
          scope: "docx:document:create drive:drive.metadata:readonly offline_access",
          token_type: "Bearer",
        });
      }
      return json({ code: 20036, error: "unsupported_grant_type" }, 400);
    }
    if (url.pathname === "/open-apis/authen/v1/user_info" && request.method === "GET") {
      return json({ code: 0, data: currentFeishuIdentity, msg: "success" });
    }
    if (url.pathname === "/open-apis/docx/v1/documents" && request.method === "POST") {
      createCounter += 1;
      const body = await request.json();
      if (holdCreate) {
        holdCreate.notifyStarted();
        await holdCreate.promise;
      }
      if (nextCreateFailure) {
        const failure = nextCreateFailure;
        nextCreateFailure = "";
        if (failure === "rejected") return json({ code: 1770001, msg: "invalid param" }, 400);
        if (failure === "server") return json({ code: 20050, msg: "server error" }, 500);
        if (failure === "token") return json({ code: 99991663, msg: "Invalid access token for authorization." }, 200);
        if (failure === "missing-document-id") return json({ code: 0, data: { document: { title: body.title } }, msg: "success" });
        if (failure === "malformed") return new Response('{"code":0,"data":', { status: 200 });
      }
      return json({
        code: 0,
        data: { document: { document_id: `doxcn_test_${createCounter}`, revision_id: 1, title: body.title } },
        msg: "success",
      });
    }
    if (url.pathname === "/open-apis/drive/v1/metas/batch_query" && request.method === "POST") {
      const body = await request.json();
      assert.equal(body.with_url, true, "the metadata query must explicitly request the official URL");
      assert.equal(body.request_docs?.[0]?.doc_type, "docx");
      const documentToken = body.request_docs?.[0]?.doc_token;
      const responseToken = mismatchNextMetadata ? `${documentToken}-different` : documentToken;
      mismatchNextMetadata = false;
      return json({
        code: 0,
        data: {
          metas: [
            {
              request_doc_info: { doc_token: responseToken, doc_type: "docx" },
              title: `Metadata ${responseToken}`,
              url: `https://owner.feishu.cn/docx/${responseToken}`,
            },
          ],
        },
        msg: "success",
      });
    }
    return json({ code: 404, msg: "Unhandled Feishu test endpoint" }, 404);
  }

  return originalFetch(input, init);
};

try {
  const sessionToken = await testing.sealJson(
    {
      accessExpiresAt: now + 3600,
      accessToken: "ghu_owner_access",
      expiresAt: now + 30 * 24 * 60 * 60,
      refreshExpiresAt: now + 180 * 24 * 60 * 60,
      refreshToken: "ghr_owner_refresh",
      user: { id: 172989722, login: "Functionhx" },
      version: 1,
    },
    env,
    "functionhx:spark-session:v1"
  );

  const unauthenticatedStart = await worker.fetch(
    new Request(`${workerOrigin}/api/feishu/oauth/start`, {
      body: JSON.stringify({ return_to: "/documents/", site_origin: siteOrigin }),
      headers: { "Content-Type": "application/json", Origin: siteOrigin },
      method: "POST",
    }),
    env
  );
  assert.equal(unauthenticatedStart.status, 401, "only the verified GitHub owner may start Feishu OAuth");

  const missingConfiguration = { ...env, FEISHU_CLIENT_ID: "", FEISHU_CLIENT_SECRET: "" };
  const missingStatus = await apiRequest("/api/feishu/session", "GET", sessionToken, undefined, siteOrigin, missingConfiguration);
  assert.equal(missingStatus.status, 200);
  assert.deepEqual(await missingStatus.json(), {
    configured: false,
    connected: false,
    missing: ["FEISHU_CLIENT_ID", "FEISHU_CLIENT_SECRET"],
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  let missingStart;
  try {
    missingStart = await apiRequest(
      "/api/feishu/oauth/start",
      "POST",
      sessionToken,
      { return_to: "/documents/", site_origin: siteOrigin },
      siteOrigin,
      missingConfiguration
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(missingStart.status, 503);
  assert.equal((await missingStart.json()).error.code, "feishu_not_configured");

  const disconnected = await apiRequest("/api/feishu/session", "GET", sessionToken);
  assert.deepEqual(await disconnected.json(), { configured: true, connected: false });

  const mismatchedOriginStart = await apiRequest(
    "/api/feishu/oauth/start",
    "POST",
    sessionToken,
    { return_to: "/documents/", site_origin: mirrorOrigin },
    siteOrigin
  );
  assert.equal(mismatchedOriginStart.status, 403);
  assert.equal((await mismatchedOriginStart.json()).error.code, "origin_denied");

  const start = await apiRequest("/api/feishu/oauth/start", "POST", sessionToken, {
    return_to: "/documents/",
    site_origin: siteOrigin,
  });
  assert.equal(start.status, 200);
  const authorize = new URL((await start.json()).authorize_url);
  assert.equal(authorize.origin, "https://accounts.feishu.test");
  assert.equal(authorize.pathname, "/open-apis/authen/v1/authorize");
  assert.equal(authorize.searchParams.get("client_id"), env.FEISHU_CLIENT_ID);
  assert.equal(authorize.toString().includes(env.FEISHU_CLIENT_SECRET), false, "the App Secret must remain server-only");
  assert.equal(authorize.searchParams.get("redirect_uri"), `${workerOrigin}/auth/feishu/callback`);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(
    new Set(authorize.searchParams.get("scope").split(" ")),
    new Set(["docx:document:create", "drive:drive.metadata:readonly", "offline_access"])
  );
  const state = authorize.searchParams.get("state");
  assert.ok(state);
  assert.equal(state.includes("ghu_owner_access"), false, "OAuth state must conceal the GitHub session");

  const tamperedState = `${state[0] === "A" ? "B" : "A"}${state.slice(1)}`;
  const tamperedCallback = await worker.fetch(
    new Request(`${workerOrigin}/auth/feishu/callback?code=tampered-code&state=${encodeURIComponent(tamperedState)}`),
    env
  );
  assert.equal(tamperedCallback.status, 401, "tampered OAuth state must be rejected before token exchange");
  assert.equal((await tamperedCallback.json()).error.code, "invalid_session");
  assert.equal(authorizationCounter, 0);

  const callback = await worker.fetch(new Request(`${workerOrigin}/auth/feishu/callback?code=official-code&state=${encodeURIComponent(state)}`), env);
  assert.equal(callback.status, 200);
  const callbackHtml = await callback.text();
  const connectedPayload = callbackPayload(callbackHtml);
  assert.deepEqual(connectedPayload, {
    connected: true,
    type: "functionhx:feishu-connected",
    user: { name: "Owner", open_id: "ou_owner" },
  });
  assert.equal(callbackHtml.includes("u_access_authorization_1"), false, "the callback must not expose a Feishu token");
  assert.equal(feishuTokenBodies[0].grant_type, "authorization_code");
  assert.equal(feishuTokenBodies[0].client_secret, env.FEISHU_CLIENT_SECRET);
  assert.equal(feishuTokenBodies[0].redirect_uri, `${workerOrigin}/auth/feishu/callback`);
  assert.equal(feishuTokenBodies[0].scope, "docx:document:create drive:drive.metadata:readonly offline_access");
  assert.equal(
    createHash("sha256").update(feishuTokenBodies[0].code_verifier).digest("base64url"),
    authorize.searchParams.get("code_challenge"),
    "the callback must exchange the code with the matching PKCE verifier"
  );

  const replay = await worker.fetch(new Request(`${workerOrigin}/auth/feishu/callback?code=replayed-code&state=${encodeURIComponent(state)}`), env);
  assert.equal(replay.status, 401, "an OAuth state must be accepted only once");
  assert.equal((await replay.json()).error.code, "feishu_oauth_state_invalid");
  assert.equal(authorizationCounter, 1, "a replay must be rejected before the Feishu token exchange");

  const storedConnection = files.get(fileKey(privateRepo, connectionPath));
  assert.ok(storedConnection);
  assert.equal(storedConnection.content.includes("u_access_authorization_1"), false, "access tokens must be encrypted at rest");
  assert.equal(storedConnection.content.includes("u_refresh_authorization_1"), false, "refresh tokens must be encrypted at rest");
  assert.equal(storedConnection.content.includes(env.FEISHU_CLIENT_SECRET), false, "the App Secret must never be persisted");

  const connected = await apiRequest("/api/feishu/session", "GET", sessionToken);
  assert.deepEqual(await connected.json(), {
    configured: true,
    connected: true,
    user: { name: "Owner", open_id: "ou_owner" },
  });

  const validConnectionFile = structuredClone(files.get(fileKey(privateRepo, connectionPath)));
  const invalidScopeRecord = await testing.decryptRecord(JSON.parse(validConnectionFile.content), env);
  invalidScopeRecord.token.scope.push("drive:drive:readonly");
  const invalidScopeEnvelope = await testing.encryptRecord(invalidScopeRecord, env);
  files.set(fileKey(privateRepo, connectionPath), {
    content: `${JSON.stringify(invalidScopeEnvelope, null, 2)}\n`,
    message: "test: reject broader stored scope",
    sha: validSha(JSON.stringify(invalidScopeEnvelope)),
  });
  const invalidStoredScope = await apiRequest("/api/feishu/session", "GET", sessionToken);
  assert.equal(invalidStoredScope.status, 422);
  assert.equal((await invalidStoredScope.json()).error.code, "invalid_feishu_connection");
  files.set(fileKey(privateRepo, connectionPath), validConnectionFile);

  let releaseCreate;
  let notifyCreateStarted;
  holdCreate = {
    notifyStarted: () => notifyCreateStarted(),
    promise: new Promise((resolve) => {
      releaseCreate = resolve;
    }),
    started: new Promise((resolve) => {
      notifyCreateStarted = resolve;
    }),
  };
  const idempotencyKey = "8fc48f21-a5a0-4a54-8954-5fc5c610ba57";
  const firstCreatePromise = apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: idempotencyKey,
    title: "新的飞书云文档",
  });
  await holdCreate.started;
  const duplicateWhilePending = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: idempotencyKey,
    title: "新的飞书云文档",
  });
  assert.equal(duplicateWhilePending.status, 409);
  assert.equal((await duplicateWhilePending.json()).error.code, "feishu_create_in_progress");
  releaseCreate();
  const firstCreate = await firstCreatePromise;
  holdCreate = null;
  assert.equal(firstCreate.status, 200);
  const firstDocument = await firstCreate.json();
  assert.equal(firstDocument.document_token, "doxcn_test_1");
  assert.equal(firstDocument.idempotent, false);
  assert.equal(firstDocument.title, "Metadata doxcn_test_1");
  assert.equal(firstDocument.url, "https://owner.feishu.cn/docx/doxcn_test_1");
  assert.ok(Number.isFinite(Date.parse(firstDocument.created_at)));

  const listedDocuments = await apiRequest("/api/feishu/documents", "GET", sessionToken);
  assert.equal(listedDocuments.status, 200);
  assert.deepEqual(await listedDocuments.json(), {
    documents: [
      {
        created_at: firstDocument.created_at,
        title: "Metadata doxcn_test_1",
        url: "https://owner.feishu.cn/docx/doxcn_test_1",
      },
    ],
  });

  const duplicateAfterSuccess = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: idempotencyKey,
    title: "新的飞书云文档",
  });
  assert.equal(duplicateAfterSuccess.status, 200);
  assert.equal((await duplicateAfterSuccess.json()).idempotent, true);
  assert.equal(createCounter, 1, "replaying an idempotency key must not create another document");

  const reusedKey = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: idempotencyKey,
    title: "另一个标题",
  });
  assert.equal(reusedKey.status, 409);
  assert.equal((await reusedKey.json()).error.code, "idempotency_key_reused");

  const metadataMismatchKey = "cfe07e57-4419-4f34-af47-a58af8eb0318";
  const createsBeforeMetadataMismatch = createCounter;
  mismatchNextMetadata = true;
  const missingMetadata = await withoutExpectedServerLog(() =>
    apiRequest("/api/feishu/documents", "POST", sessionToken, {
      idempotency_key: metadataMismatchKey,
      title: "校验官方文档地址",
    })
  );
  assert.equal(missingMetadata.status, 502);
  assert.equal((await missingMetadata.json()).error.code, "feishu_document_url_missing");
  assert.equal(createCounter, createsBeforeMetadataMismatch + 1);
  const recoveredMetadata = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: metadataMismatchKey,
    title: "校验官方文档地址",
  });
  assert.equal(recoveredMetadata.status, 200);
  assert.equal((await recoveredMetadata.json()).url, `https://owner.feishu.cn/docx/doxcn_test_${createCounter}`);
  assert.equal(createCounter, createsBeforeMetadataMismatch + 1, "metadata recovery must never create a duplicate document");

  const rejectedKey = "cc76606b-d9ea-4e3a-b4b2-bbbdd82dfac2";
  const createsBeforeRejection = createCounter;
  nextCreateFailure = "rejected";
  const rejectedCreate = await withoutExpectedServerLog(() =>
    apiRequest("/api/feishu/documents", "POST", sessionToken, {
      idempotency_key: rejectedKey,
      title: "飞书明确拒绝的请求",
    })
  );
  assert.equal(rejectedCreate.status, 502);
  assert.equal((await rejectedCreate.json()).error.code, "feishu_create_rejected");
  const rejectedReplay = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: rejectedKey,
    title: "飞书明确拒绝的请求",
  });
  assert.equal(rejectedReplay.status, 409);
  assert.equal((await rejectedReplay.json()).error.code, "feishu_create_rejected");
  assert.equal(createCounter, createsBeforeRejection + 1, "a rejected request key must not be replayed automatically");

  const unknownKey = "f0320bd5-ab65-4484-bb96-357fba735bf4";
  const createsBeforeUnknown = createCounter;
  nextCreateFailure = "server";
  const unknownCreate = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: unknownKey,
    title: "结果不确定的飞书请求",
  });
  assert.equal(unknownCreate.status, 409);
  assert.equal((await unknownCreate.json()).error.code, "feishu_create_outcome_unknown");
  const unknownReplay = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: unknownKey,
    title: "结果不确定的飞书请求",
  });
  assert.equal(unknownReplay.status, 409);
  assert.equal((await unknownReplay.json()).error.code, "feishu_create_outcome_unknown");
  assert.equal(createCounter, createsBeforeUnknown + 1, "an ambiguous request must not risk creating a duplicate document");

  for (const [failure, suffix] of [
    ["missing-document-id", "missing-id"],
    ["malformed", "malformed-json"],
  ]) {
    const key = `feishu-document-${suffix}-00000001`;
    const createsBeforeIncompleteResponse = createCounter;
    nextCreateFailure = failure;
    const incompleteResponse = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
      idempotency_key: key,
      title: `无法确认的响应 ${suffix}`,
    });
    assert.equal(incompleteResponse.status, 409);
    assert.equal((await incompleteResponse.json()).error.code, "feishu_create_outcome_unknown");
    const incompleteReplay = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
      idempotency_key: key,
      title: `无法确认的响应 ${suffix}`,
    });
    assert.equal(incompleteReplay.status, 409);
    assert.equal((await incompleteReplay.json()).error.code, "feishu_create_outcome_unknown");
    assert.equal(createCounter, createsBeforeIncompleteResponse + 1, `${failure} must never be retried automatically`);
  }

  const connectionEnvelope = JSON.parse(files.get(fileKey(privateRepo, connectionPath)).content);
  const expiredConnection = await testing.decryptRecord(connectionEnvelope, env);
  expiredConnection.token.accessExpiresAt = now - 1;
  const expiredEnvelope = await testing.encryptRecord(expiredConnection, env);
  files.set(fileKey(privateRepo, connectionPath), {
    content: `${JSON.stringify(expiredEnvelope, null, 2)}\n`,
    message: "test: expire access token",
    sha: validSha(JSON.stringify(expiredEnvelope)),
  });

  let releaseRefresh;
  let notifyRefreshStarted;
  holdRefresh = {
    notifyStarted: () => notifyRefreshStarted(),
    promise: new Promise((resolve) => {
      releaseRefresh = resolve;
    }),
    started: new Promise((resolve) => {
      notifyRefreshStarted = resolve;
    }),
  };
  const refreshedCreatePromise = apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: "b105fae7-b937-405b-81ac-e3c9c2f676e6",
    title: "刷新后创建",
  });
  await holdRefresh.started;
  const concurrentRefresh = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: "32867726-285e-48fa-a96a-081217e43bb3",
    title: "并发刷新不应创建",
  });
  assert.equal(concurrentRefresh.status, 409);
  assert.equal((await concurrentRefresh.json()).error.code, "feishu_refresh_in_progress");
  releaseRefresh();
  const refreshedCreate = await refreshedCreatePromise;
  holdRefresh = null;
  assert.equal(refreshedCreate.status, 200);
  assert.equal(refreshCounter, 1);
  assert.equal(feishuTokenBodies.at(-1).grant_type, "refresh_token");
  assert.equal(feishuTokenBodies.at(-1).refresh_token, "u_refresh_authorization_1");
  assert.equal(feishuTokenBodies.at(-1).scope, "docx:document:create drive:drive.metadata:readonly offline_access");
  assert.ok(
    feishuCalls.some((call) => call.path === "/open-apis/docx/v1/documents" && call.authorization === "Bearer u_access_refreshed_1"),
    "document creation after expiry must use the refreshed access token"
  );
  const rotatedConnection = files.get(fileKey(privateRepo, connectionPath)).content;
  assert.equal(rotatedConnection.includes("u_refresh_authorization_1"), false);
  assert.equal(rotatedConnection.includes("u_refresh_rotated_1"), false, "the rotated refresh token must remain encrypted");

  const reconnectStart = await apiRequest("/api/feishu/oauth/start", "POST", sessionToken, {
    return_to: "/documents/",
    site_origin: siteOrigin,
  });
  const reconnectState = new URL((await reconnectStart.json()).authorize_url).searchParams.get("state");
  currentFeishuIdentity = { name: "Another user", open_id: "ou_attacker", tenant_key: "tenant_owner" };
  const wrongOwner = await worker.fetch(
    new Request(`${workerOrigin}/auth/feishu/callback?code=wrong-owner&state=${encodeURIComponent(reconnectState)}`),
    env
  );
  assert.equal(wrongOwner.status, 200, "the OAuth popup should return a usable completion page even when identity is denied");
  const wrongOwnerPayload = callbackPayload(await wrongOwner.text());
  assert.equal(wrongOwnerPayload.connected, false, "a different Feishu identity must not replace the pinned owner");
  assert.equal(wrongOwnerPayload.error.code, "feishu_user_denied");

  assert.ok(
    feishuCalls.some((call) => call.path === "/open-apis/authen/v1/user_info"),
    "the OAuth callback must pin the official Feishu open_id"
  );
  assert.ok(
    feishuCalls.some((call) => call.path === "/open-apis/drive/v1/metas/batch_query?user_id_type=open_id"),
    "the backend must ask the official Drive API for the exact document URL"
  );

  const expiredTokenKey = "d9cf3a0b-455d-4ae7-ad92-524db748d9a7";
  nextCreateFailure = "token";
  const invalidTokenCreate = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: expiredTokenKey,
    title: "令牌失效时重新授权",
  });
  assert.equal(invalidTokenCreate.status, 409, "Feishu reauthorization must not invalidate the GitHub owner session");
  assert.equal((await invalidTokenCreate.json()).error.code, "feishu_reauthorization_required");
  const invalidTokenReplay = await apiRequest("/api/feishu/documents", "POST", sessionToken, {
    idempotency_key: expiredTokenKey,
    title: "令牌失效时重新授权",
  });
  assert.equal(invalidTokenReplay.status, 409);
  assert.equal((await invalidTokenReplay.json()).error.code, "feishu_create_rejected");
  const disconnectedAfterInvalidToken = await apiRequest("/api/feishu/session", "GET", sessionToken);
  assert.deepEqual(await disconnectedAfterInvalidToken.json(), { configured: true, connected: false });
} finally {
  globalThis.fetch = originalFetch;
}
