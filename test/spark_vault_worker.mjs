import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import worker, { testing } from "../spark-vault/worker.mjs";

const siteOrigin = "https://functionhx.github.io";
const mirrorOrigin = "https://fanyuchen.com.cn";
const workerOrigin = "https://spark-vault.test";
const privateRepo = "Functionhx/functionhx-spark-private";
const publicRepo = "Functionhx/functionhx.github.io";
const validSha = (value) => createHash("sha1").update(String(value)).digest("hex");
const sessionSecret = Buffer.alloc(32, 17).toString("base64url");
const masterSecret = Buffer.alloc(32, 29).toString("base64url");
const env = {
  ALLOWED_GITHUB_USER_ID: "172989722",
  GITHUB_API_BASE: "https://api.github.test",
  GITHUB_CLIENT_ID: "Iv1.spark-vault-test",
  GITHUB_CLIENT_SECRET: "not-a-real-client-secret",
  GITHUB_WEB_BASE: "https://github.test",
  MASTER_KEY_B64: masterSecret,
  PRIVATE_BRANCH: "main",
  PRIVATE_REPO: privateRepo,
  PUBLIC_BRANCH: "main",
  PUBLIC_REPO: publicRepo,
  SESSION_KEY_B64: sessionSecret,
  SITE_ORIGINS: `${siteOrigin},${mirrorOrigin}`,
  WORKER_ORIGIN: workerOrigin,
};

const files = new Map();
const requests = [];
let treeCounter = 0;
let commitCounter = 0;

function fileKey(repository, path) {
  return `${repository}:${path}`;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" }, status });
}

function decodeRepository(pathname) {
  const match = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
  if (!match) return null;
  return { repository: `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`, suffix: match[3] || "" };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  requests.push({ method: request.method, url: request.url, userAgent: request.headers.get("User-Agent") || "" });

  if (url.origin === "https://github.test" && url.pathname === "/login/oauth/access_token") {
    return json({
      access_token: "ghu_not-a-real-user-token",
      expires_in: 28_800,
      refresh_token: "ghr_not-a-real-refresh-token",
      refresh_token_expires_in: 15_897_600,
      token_type: "bearer",
    });
  }

  if (url.origin !== "https://api.github.test") return originalFetch(input, init);
  if (url.pathname === "/user") return json({ id: 172989722, login: "Functionhx" });

  const parsed = decodeRepository(decodeURIComponent(url.pathname));
  if (!parsed) return json({ message: "Not Found" }, 404);
  const { repository, suffix } = parsed;
  if (!suffix) return json({ permissions: { pull: true, push: true } });

  if (suffix === "/contents/notes" && request.method === "GET") {
    const listing = Array.from(files.entries())
      .filter(([key]) => key.startsWith(`${repository}:notes/`))
      .map(([key, file]) => {
        const path = key.slice(repository.length + 1);
        return { name: path.slice("notes/".length), path, sha: file.sha, type: "file" };
      });
    return listing.length ? json(listing) : json({ message: "Not Found" }, 404);
  }

  if (suffix.startsWith("/contents/")) {
    const path = decodeURIComponent(suffix.slice("/contents/".length));
    const key = fileKey(repository, path);
    if (request.method === "GET") {
      const file = files.get(key);
      return file
        ? json({ content: Buffer.from(file.content, "utf8").toString("base64"), path, sha: file.sha, type: "file" })
        : json({ message: "Not Found" }, 404);
    }
    if (request.method === "PUT") {
      const body = await request.json();
      const existing = files.get(key);
      if ((existing && body.sha !== existing.sha) || (!existing && body.sha)) return json({ message: "Conflict" }, 409);
      const content = Buffer.from(body.content, "base64").toString("utf8");
      const sha = validSha(content);
      files.set(key, { content, sha });
      return json({ commit: { sha: validSha(`private-${sha}`) }, content: { path, sha } }, existing ? 200 : 201);
    }
  }

  if (suffix === "/git/ref/heads/main" && request.method === "GET") {
    return json({ object: { sha: validSha(`head-${treeCounter}`) } });
  }
  if (/^\/git\/commits\/[0-9a-f]{40}$/.test(suffix) && request.method === "GET") {
    return json({ tree: { sha: validSha(`base-tree-${treeCounter}`) } });
  }
  if (suffix === "/git/trees" && request.method === "POST") {
    const body = await request.json();
    treeCounter += 1;
    const tree = body.tree.map((entry) => {
      const key = fileKey(repository, entry.path);
      if (entry.sha === null) {
        files.delete(key);
        return { path: entry.path, sha: null };
      }
      const sha = validSha(entry.content);
      files.set(key, { content: entry.content, sha });
      return { path: entry.path, sha };
    });
    return json({ sha: validSha(`tree-${treeCounter}`), tree }, 201);
  }
  if (suffix === "/git/commits" && request.method === "POST") {
    commitCounter += 1;
    const sha = validSha(`commit-${commitCounter}`);
    return json({ html_url: `https://github.com/${repository}/commit/${sha}`, sha }, 201);
  }
  if (suffix === "/git/refs/heads/main" && request.method === "PATCH") {
    const body = await request.json();
    return json({ object: { sha: body.sha } });
  }

  return json({ message: `Unhandled test endpoint: ${request.method} ${url.pathname}` }, 404);
};

function apiRequest(path, method, token, body, origin = siteOrigin) {
  const headers = { Authorization: `Bearer ${token}`, Origin: origin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return worker.fetch(
    new Request(`${workerOrigin}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
    }),
    env
  );
}

function extractCallbackPayload(html) {
  const match = html.match(/const payload=(\{.*?\});const target=/);
  assert.ok(match, "the OAuth callback should contain a postMessage payload");
  return JSON.parse(match[1]);
}

function extractCallbackTarget(html) {
  const match = html.match(/const target=(".*?");if\(window\.opener/);
  assert.ok(match, "the OAuth callback should contain a postMessage target");
  return JSON.parse(match[1]);
}

const values = {
  comments: true,
  date: "2026-07-31T21:30",
  en: {
    body: "An encrypted English thought.",
    summary: "An encrypted thought.",
    title: "Encrypted Spark",
  },
  kind: "note",
  published: false,
  slug: "encrypted-spark",
  zh: {
    body: "这是一条只应由樊宇琛读取的加密闪耀。",
    summary: "一条加密闪耀。",
    title: "加密闪耀",
  },
};

try {
  const encrypted = await testing.encryptRecord({ id: values.slug, values }, env);
  const serialized = JSON.stringify(encrypted);
  assert.equal(serialized.includes(values.zh.body), false, "encrypted records must not expose plaintext");
  assert.deepEqual(await testing.decryptRecord(encrypted, env), { id: values.slug, values });

  const health = await worker.fetch(new Request(`${workerOrigin}/health`), env);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: "functionhx-spark-vault", version: 1 });

  const login = await worker.fetch(new Request(`${workerOrigin}/auth/login?return_to=/spark/`), env);
  assert.equal(login.status, 302);
  const authorize = new URL(login.headers.get("Location"));
  assert.equal(authorize.origin, "https://github.test");
  assert.equal(authorize.searchParams.get("client_id"), env.GITHUB_CLIENT_ID);
  const state = authorize.searchParams.get("state");
  assert.ok(state);

  const callback = await worker.fetch(new Request(`${workerOrigin}/auth/callback?code=test-code&state=${encodeURIComponent(state)}`), env);
  assert.equal(callback.status, 200);
  const callbackHtml = await callback.text();
  const callbackPayload = extractCallbackPayload(callbackHtml);
  assert.equal(extractCallbackTarget(callbackHtml), siteOrigin);
  assert.equal(callbackPayload.type, "functionhx:spark-vault-session");
  assert.equal(callbackPayload.user.id, 172989722);
  assert.equal(callbackPayload.token.includes("ghu_not-a-real-user-token"), false, "the browser session must conceal the GitHub token");
  let sessionToken = callbackPayload.token;

  const mirrorLogin = await worker.fetch(
    new Request(`${workerOrigin}/auth/login?return_to=/spark/&site_origin=${encodeURIComponent(mirrorOrigin)}`),
    env
  );
  assert.equal(mirrorLogin.status, 302);
  const mirrorState = new URL(mirrorLogin.headers.get("Location")).searchParams.get("state");
  const mirrorCallback = await worker.fetch(
    new Request(`${workerOrigin}/auth/callback?code=mirror-code&state=${encodeURIComponent(mirrorState)}`),
    env
  );
  assert.equal(mirrorCallback.status, 200);
  const mirrorCallbackHtml = await mirrorCallback.text();
  assert.equal(extractCallbackTarget(mirrorCallbackHtml), mirrorOrigin);

  const deniedLogin = await worker.fetch(
    new Request(`${workerOrigin}/auth/login?site_origin=${encodeURIComponent("https://attacker.example")}`),
    env
  );
  assert.equal(deniedLogin.status, 403, "OAuth must reject a return origin outside the allowlist");

  const session = await apiRequest("/api/session", "GET", sessionToken);
  assert.equal(session.status, 200);
  assert.deepEqual((await session.json()).user, { id: 172989722, login: "Functionhx" });

  const mirrorSession = await apiRequest("/api/session", "GET", sessionToken, undefined, mirrorOrigin);
  assert.equal(mirrorSession.status, 200);
  assert.equal(mirrorSession.headers.get("access-control-allow-origin"), mirrorOrigin);

  const crossOriginSave = await apiRequest(`/api/notes/${values.slug}`, "PUT", sessionToken, { values }, "https://attacker.example");
  assert.equal(crossOriginSave.status, 403, "write requests from another origin must be denied");

  const chineseOnlyValues = {
    ...structuredClone(values),
    en: { body: "", summary: "", title: "" },
    slug: "chinese-only-draft",
  };
  const chineseOnlySave = await apiRequest(`/api/notes/${chineseOnlyValues.slug}`, "PUT", sessionToken, {
    values: chineseOnlyValues,
  });
  assert.equal(chineseOnlySave.status, 200, "a Chinese source draft must save without an English version");
  const chineseOnlyNote = (await chineseOnlySave.json()).note;
  assert.equal(chineseOnlyNote.published, false);
  const prematurePublish = await apiRequest(`/api/notes/${chineseOnlyValues.slug}/publish`, "POST", sessionToken, {
    expectedSha: chineseOnlyNote.sha,
  });
  assert.equal(prematurePublish.status, 422, "publishing must still require a complete bilingual pair");
  assert.equal(
    files.has(fileKey(publicRepo, `_posts/2026-07-31-${chineseOnlyValues.slug}-zh.md`)),
    false,
    "an incomplete private draft must never leak into the public repository"
  );

  const saved = await apiRequest(`/api/notes/${values.slug}`, "PUT", sessionToken, {
    message: "spark: save encrypted test note",
    values,
  });
  assert.equal(saved.status, 200);
  const savedNote = (await saved.json()).note;
  assert.equal(savedNote.published, false);
  assert.match(savedNote.sha, /^[0-9a-f]{40}$/);
  const storedEnvelope = files.get(fileKey(privateRepo, `notes/${values.slug}.spark.json`)).content;
  assert.equal(storedEnvelope.includes(values.zh.body), false, "the private repository must receive ciphertext only");
  assert.equal(storedEnvelope.includes(values.en.body), false, "both languages must be encrypted");

  const loaded = await apiRequest(`/api/notes/${values.slug}`, "GET", sessionToken);
  assert.equal(loaded.status, 200);
  const loadedNote = (await loaded.json()).note;
  assert.equal(loadedNote.values.zh.body, values.zh.body);
  assert.equal(loadedNote.values.en.body, values.en.body);

  const listed = await apiRequest("/api/notes", "GET", sessionToken);
  const notes = (await listed.json()).notes;
  assert.equal(notes.length, 2);
  assert.ok(notes.some((note) => note.title.zh === values.zh.title));

  const published = await apiRequest(`/api/notes/${values.slug}/publish`, "POST", sessionToken, {
    expectedSha: loadedNote.sha,
    message: "spark: publish encrypted-spark",
  });
  assert.equal(published.status, 200);
  const publishPayload = await published.json();
  assert.match(publishPayload.commit.sha, /^[0-9a-f]{40}$/);
  assert.equal(publishPayload.note.published, true);
  const publicZh = files.get(fileKey(publicRepo, `_posts/2026-07-31-${values.slug}-zh.md`));
  const publicEn = files.get(fileKey(publicRepo, `_posts/2026-07-31-${values.slug}-en.md`));
  assert.ok(publicZh && publicEn, "publishing must create both language files");
  assert.match(publicZh.content, /^published: true$/m);
  assert.match(publicEn.content, /^published: true$/m);
  assert.match(publicZh.content, /translation_key: spark-encrypted-spark/);
  assert.match(publicEn.content, /translation_key: spark-encrypted-spark/);

  const unpublished = await apiRequest(`/api/notes/${values.slug}/unpublish`, "POST", sessionToken, {
    expectedSha: publishPayload.note.sha,
    message: "spark: make encrypted-spark private",
  });
  assert.equal(unpublished.status, 200);
  const unpublishPayload = await unpublished.json();
  assert.equal(unpublishPayload.note.published, false);
  assert.equal(files.has(fileKey(publicRepo, `_posts/2026-07-31-${values.slug}-zh.md`)), false);
  assert.equal(files.has(fileKey(publicRepo, `_posts/2026-07-31-${values.slug}-en.md`)), false);

  const staleSave = await apiRequest(`/api/notes/${values.slug}`, "PUT", sessionToken, {
    expectedSha: savedNote.sha,
    values,
  });
  assert.equal(staleSave.status, 409, "stale private updates must be rejected");

  assert.ok(
    requests.some((request) => request.url.endsWith("/user")),
    "OAuth callback must verify the GitHub user"
  );
  assert.ok(
    requests.some((request) => request.url.includes("/repos/Functionhx/functionhx-spark-private")),
    "OAuth callback must verify private repository access"
  );
  assert.ok(
    requests
      .filter((request) => request.url.startsWith("https://api.github.test/"))
      .every((request) => request.userAgent === "functionhx-spark-vault"),
    "every GitHub REST request must include the app User-Agent"
  );
} finally {
  globalThis.fetch = originalFetch;
}
