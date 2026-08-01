import { createUnlockPage } from "./unlock-page.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_GITHUB_API = "https://api.github.com";
const DEFAULT_GITHUB_WEB = "https://github.com";
const DEFAULT_API_VERSION = "2026-03-10";
const NOTE_DIRECTORY = "notes";
const NOTE_SUFFIX = ".spark.json";
const KEYRING_PATH = "vault/keyring.v2.json";
const SEALED_VALUE_PREFIX = "functionhx:zk2:";
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_SKEW_SECONDS = 5 * 60;
const MAX_BODY_LENGTH = 500_000;

class HttpError extends Error {
  constructor(status, message, code = "request_failed") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new HttpError(503, `Spark Vault is missing ${name}.`, "vault_not_configured");
  return value;
}

function siteOrigins(env) {
  const configured = String(env.SITE_ORIGINS || env.SITE_ORIGIN || "").trim();
  if (!configured) throw new HttpError(503, "Spark Vault is missing SITE_ORIGINS.", "vault_not_configured");
  const origins = configured
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((value) => new URL(value).origin);
  const unique = [...new Set(origins)];
  if (!unique.length) throw new HttpError(503, "Spark Vault is missing SITE_ORIGINS.", "vault_not_configured");
  return unique;
}

function siteOrigin(env) {
  return siteOrigins(env)[0];
}

function allowedSiteOrigin(value, env) {
  let origin;
  try {
    origin = new URL(String(value || "")).origin;
  } catch (_error) {
    throw new HttpError(403, "This origin is not allowed to use Spark Vault.", "origin_denied");
  }
  if (!siteOrigins(env).includes(origin)) {
    throw new HttpError(403, "This origin is not allowed to use Spark Vault.", "origin_denied");
  }
  return origin;
}

function allowedApiOrigin(value, request, env) {
  let origin;
  try {
    origin = new URL(String(value || "")).origin;
  } catch (_error) {
    throw new HttpError(403, "This origin is not allowed to use Spark Vault.", "origin_denied");
  }
  if (origin === workerOrigin(request, env) || siteOrigins(env).includes(origin)) return origin;
  throw new HttpError(403, "This origin is not allowed to use Spark Vault.", "origin_denied");
}

function responseSiteOrigin(request, env) {
  const origin = request?.headers?.get("Origin") || "";
  if (!origin) return siteOrigin(env);
  try {
    return allowedApiOrigin(origin, request, env);
  } catch (_error) {
    return siteOrigin(env);
  }
}

function workerOrigin(request, env) {
  const configured = String(env.WORKER_ORIGIN || "").trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

function githubApiBase(env) {
  return String(env.GITHUB_API_BASE || DEFAULT_GITHUB_API).replace(/\/$/, "");
}

function githubWebBase(env) {
  return String(env.GITHUB_WEB_BASE || DEFAULT_GITHUB_WEB).replace(/\/$/, "");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return base64ToBytes(padded);
}

function decodeSecret(value, name) {
  try {
    const bytes = base64UrlDecode(value);
    if (bytes.length !== 32) throw new Error("wrong length");
    return bytes;
  } catch (_error) {
    throw new HttpError(503, `${name} must contain exactly 32 random bytes encoded as base64.`, "invalid_secret");
  }
}

async function importAesKey(bytes, usages) {
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, usages);
}

async function environmentKey(env, name, usages) {
  return importAesKey(decodeSecret(required(env, name), name), usages);
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function sealJson(payload, env, purpose) {
  const key = await environmentKey(env, "SESSION_KEY_B64", ["encrypt"]);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(purpose) },
    key,
    encoder.encode(JSON.stringify(payload))
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

async function unsealJson(token, env, purpose) {
  try {
    const [ivPart, ciphertextPart, extra] = String(token || "").split(".");
    if (!ivPart || !ciphertextPart || extra) throw new Error("invalid token");
    const key = await environmentKey(env, "SESSION_KEY_B64", ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(ivPart), additionalData: encoder.encode(purpose) },
      key,
      base64UrlDecode(ciphertextPart)
    );
    return JSON.parse(decoder.decode(plaintext));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "The Spark Vault session is invalid or expired.", "invalid_session");
  }
}

async function encryptRecord(record, env) {
  const masterKey = await environmentKey(env, "MASTER_KEY_B64", ["encrypt"]);
  const dataKeyBytes = randomBytes(32);
  const dataKey = await importAesKey(dataKeyBytes, ["encrypt"]);
  const contentIv = randomBytes(12);
  const keyIv = randomBytes(12);
  const contentAad = encoder.encode(`functionhx:spark-record:${record.id}:v1`);
  const keyAad = encoder.encode(`functionhx:spark-key:${record.id}:v1`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: contentIv, additionalData: contentAad },
    dataKey,
    encoder.encode(JSON.stringify(record))
  );
  const wrappedKey = await crypto.subtle.encrypt({ name: "AES-GCM", iv: keyIv, additionalData: keyAad }, masterKey, dataKeyBytes);
  return {
    algorithm: "A256GCM",
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    content_iv: base64UrlEncode(contentIv),
    id: record.id,
    key_iv: base64UrlEncode(keyIv),
    version: 1,
    wrapped_key: base64UrlEncode(new Uint8Array(wrappedKey)),
  };
}

async function decryptRecord(envelope, env) {
  try {
    if (!envelope || envelope.version !== 1 || envelope.algorithm !== "A256GCM" || !envelope.id) {
      throw new Error("unsupported envelope");
    }
    const masterKey = await environmentKey(env, "MASTER_KEY_B64", ["decrypt"]);
    const keyBytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlDecode(envelope.key_iv),
        additionalData: encoder.encode(`functionhx:spark-key:${envelope.id}:v1`),
      },
      masterKey,
      base64UrlDecode(envelope.wrapped_key)
    );
    const dataKey = await importAesKey(new Uint8Array(keyBytes), ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlDecode(envelope.content_iv),
        additionalData: encoder.encode(`functionhx:spark-record:${envelope.id}:v1`),
      },
      dataKey,
      base64UrlDecode(envelope.ciphertext)
    );
    const record = JSON.parse(decoder.decode(plaintext));
    if (record.id !== envelope.id) throw new Error("record id mismatch");
    return record;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "This private Spark could not be decrypted.", "decrypt_failed");
  }
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Origin": responseSiteOrigin(request, env),
    "Access-Control-Expose-Headers": "X-Spark-Session",
    Vary: "Origin",
  };
}

function jsonResponse(payload, status, env, sessionToken = "", request = null) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request, env),
  };
  if (sessionToken) headers["X-Spark-Session"] = sessionToken;
  return new Response(JSON.stringify(payload), { headers, status });
}

function emptyResponse(status, env, request) {
  return new Response(null, { headers: corsHeaders(request, env), status });
}

function assertAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (origin) allowedApiOrigin(origin, request, env);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !origin) {
    throw new HttpError(403, "A verified site origin is required.", "origin_required");
  }
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Spark Vault only accepts JSON requests.", "json_required");
  }
  try {
    return await request.json();
  } catch (_error) {
    throw new HttpError(400, "The request body is not valid JSON.", "invalid_json");
  }
}

function encodePath(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function repoEndpoint(repository, suffix) {
  const [owner, name, extra] = String(repository).split("/");
  if (!owner || !name || extra) throw new HttpError(503, "A repository setting is invalid.", "invalid_repository");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

async function githubRequest(env, token, endpoint, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "functionhx-spark-vault",
    "X-GitHub-Api-Version": String(env.GITHUB_API_VERSION || DEFAULT_API_VERSION),
    ...options.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${githubApiBase(env)}${endpoint}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method || "GET",
  });
  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (_error) {
    payload = {};
  }
  if (response.status === 404 && options.allowNotFound) return null;
  if (!response.ok) {
    const githubMessage = String(payload.message || responseText)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    const error = new HttpError(response.status, githubMessage || `GitHub API ${response.status}`, "github_api_error");
    error.githubStatus = response.status;
    throw error;
  }
  return payload;
}

async function exchangeOAuthCode(env, code, redirectUri) {
  const body = new URLSearchParams({
    client_id: required(env, "GITHUB_CLIENT_ID"),
    client_secret: required(env, "GITHUB_CLIENT_SECRET"),
    code,
    redirect_uri: redirectUri,
  });
  const response = await fetch(`${githubWebBase(env)}/login/oauth/access_token`, {
    body,
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new HttpError(401, payload.error_description || payload.error || "GitHub login failed.", "oauth_failed");
  }
  return payload;
}

async function refreshOAuthToken(env, refreshToken) {
  const body = new URLSearchParams({
    client_id: required(env, "GITHUB_CLIENT_ID"),
    client_secret: required(env, "GITHUB_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch(`${githubWebBase(env)}/login/oauth/access_token`, {
    body,
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new HttpError(401, "The GitHub session could not be refreshed.", "refresh_failed");
  }
  return payload;
}

function sessionFromOAuth(payload, user) {
  const now = nowSeconds();
  const expiringAccessToken = Number(payload.expires_in) > 0;
  const accessLifetime = expiringAccessToken ? Number(payload.expires_in) : SESSION_LIFETIME_SECONDS + REFRESH_SKEW_SECONDS;
  const refreshLifetime = Number(payload.refresh_token_expires_in || 180 * 24 * 60 * 60);
  return {
    accessExpiresAt: now + accessLifetime,
    accessToken: payload.access_token,
    expiresAt: now + SESSION_LIFETIME_SECONDS,
    refreshExpiresAt: now + refreshLifetime,
    refreshToken: payload.refresh_token || "",
    user: { id: Number(user.id), login: String(user.login || "") },
    version: 1,
  };
}

async function validateAuthorizedUser(env, accessToken) {
  const user = await githubRequest(env, accessToken, "/user");
  const allowedId = Number(required(env, "ALLOWED_GITHUB_USER_ID"));
  if (!Number.isSafeInteger(allowedId) || Number(user.id) !== allowedId) {
    throw new HttpError(403, "This GitHub account is not allowed to open Spark Vault.", "user_denied");
  }
  const repositories = [required(env, "PRIVATE_REPO"), required(env, "PUBLIC_REPO")];
  for (const repository of repositories) {
    const metadata = await githubRequest(env, accessToken, repoEndpoint(repository, ""));
    if (!metadata.permissions?.push) {
      throw new HttpError(403, `GitHub write access is missing for ${repository}.`, "repository_denied");
    }
  }
  return user;
}

async function authenticate(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "Sign in with GitHub to open Spark Vault.", "authentication_required");
  }
  const sealed = authorization.slice("Bearer ".length).trim();
  const session = await unsealJson(sealed, env, "functionhx:spark-session:v1");
  const now = nowSeconds();
  const allowedId = Number(required(env, "ALLOWED_GITHUB_USER_ID"));
  if (session.version !== 1 || session.expiresAt <= now || Number(session.user?.id) !== allowedId) {
    throw new HttpError(401, "The Spark Vault session has expired.", "session_expired");
  }
  if (session.accessExpiresAt > now + REFRESH_SKEW_SECONDS) {
    return { accessToken: session.accessToken, rotatedToken: "", session };
  }
  if (!session.refreshToken || session.refreshExpiresAt <= now) {
    throw new HttpError(401, "Sign in with GitHub again to continue.", "session_expired");
  }
  const refreshed = await refreshOAuthToken(env, session.refreshToken);
  const next = sessionFromOAuth(
    {
      ...refreshed,
      refresh_token: refreshed.refresh_token || session.refreshToken,
      refresh_token_expires_in: refreshed.refresh_token_expires_in || Math.max(session.refreshExpiresAt - now, 1),
    },
    session.user
  );
  next.expiresAt = session.expiresAt;
  return {
    accessToken: next.accessToken,
    rotatedToken: await sealJson(next, env, "functionhx:spark-session:v1"),
    session: next,
  };
}

function safeReturnPath(value) {
  const candidate = String(value || "/spark/");
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/spark/";
  return candidate;
}

function safeContinuation(value) {
  return value === "strong-unlock" || value === "decoy-unlock" ? value : "";
}

async function handleLogin(request, env) {
  const url = new URL(request.url);
  const requestedOrigin = url.searchParams.get("site_origin");
  const origin = requestedOrigin ? allowedSiteOrigin(requestedOrigin, env) : siteOrigin(env);
  const state = await sealJson(
    {
      expiresAt: nowSeconds() + 10 * 60,
      continuation: safeContinuation(url.searchParams.get("continuation")),
      nonce: base64UrlEncode(randomBytes(24)),
      origin,
      returnPath: safeReturnPath(url.searchParams.get("return_to")),
      version: 1,
    },
    env,
    "functionhx:spark-oauth-state:v1"
  );
  const callback = `${workerOrigin(request, env)}/auth/callback`;
  const authorize = new URL(`${githubWebBase(env)}/login/oauth/authorize`);
  authorize.searchParams.set("client_id", required(env, "GITHUB_CLIENT_ID"));
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "false");
  return Response.redirect(authorize.toString(), 302);
}

function callbackPage(origin, sessionToken, user, returnPath, continuation = "", vaultOrigin = "") {
  const fallback = new URL(returnPath, origin);
  fallback.hash = new URLSearchParams({ "spark-session": sessionToken }).toString();
  const nonce = base64UrlEncode(randomBytes(18));
  let heading = "Spark 已连接";
  let copy = "正在返回个人主页，可以关闭这个窗口。";
  let script;
  const safeContinuationValue = safeContinuation(continuation);
  if (safeContinuationValue) {
    const unlock = new URL("/unlock", vaultOrigin);
    const unlockParameters = new URLSearchParams({
      session: sessionToken,
      site_origin: origin,
      user_id: String(user.id || ""),
      user_login: String(user.login || ""),
    });
    if (safeContinuationValue === "strong-unlock") unlockParameters.set("intent", "strong");
    unlock.hash = unlockParameters.toString();
    heading = safeContinuationValue === "strong-unlock" ? "继续解锁 Spark" : "打开 Spark 私密空间";
    copy =
      safeContinuationValue === "strong-unlock" ? "GitHub 身份已验证，正在继续完成私密库的多重解锁。" : "GitHub 身份已验证，正在继续打开私密空间。";
    script = `const destination=${JSON.stringify(unlock.toString())};const fallback=${JSON.stringify(
      fallback.toString()
    )};if(window.opener&&!window.opener.closed){window.location.replace(destination)}else{window.location.replace(fallback)}`;
  } else {
    const payload = JSON.stringify({ token: sessionToken, type: "functionhx:spark-vault-session", user });
    script = `const payload=${payload};const target=${JSON.stringify(origin)};if(window.opener&&!window.opener.closed){window.opener.postMessage(payload,target);window.close()}else{window.location.replace(${JSON.stringify(fallback.toString())})}`;
  }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${heading}</title><style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;display:grid;min-height:100vh;place-items:center;margin:0;background:#fff;color:#222}main{max-width:28rem;padding:2rem;text-align:center}p{color:#666}</style><main><h1>${heading}</h1><p>${copy}</p></main><script nonce="${nonce}">${script}</script></html>`;
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  });
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const stateToken = url.searchParams.get("state") || "";
  if (!code || !stateToken) throw new HttpError(400, "GitHub did not return a complete login response.", "oauth_incomplete");
  const state = await unsealJson(stateToken, env, "functionhx:spark-oauth-state:v1");
  if (state.version !== 1 || state.expiresAt <= nowSeconds()) {
    throw new HttpError(401, "The GitHub login request expired.", "oauth_state_expired");
  }
  const callback = `${workerOrigin(request, env)}/auth/callback`;
  const oauth = await exchangeOAuthCode(env, code, callback);
  const user = await validateAuthorizedUser(env, oauth.access_token);
  const session = sessionFromOAuth(oauth, user);
  const sealed = await sealJson(session, env, "functionhx:spark-session:v1");
  const origin = state.origin ? allowedSiteOrigin(state.origin, env) : siteOrigin(env);
  return callbackPage(
    origin,
    sealed,
    session.user,
    safeReturnPath(state.returnPath),
    safeContinuation(state.continuation),
    workerOrigin(request, env)
  );
}

function normalizeId(value) {
  const id = String(value || "").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 72) {
    throw new HttpError(400, "The Spark slug is invalid.", "invalid_slug");
  }
  return id;
}

function normalizedText(value, label, maximum, requiredValue = false) {
  const text = String(value || "").replace(/\r\n/g, "\n");
  if (requiredValue && !text.trim()) throw new HttpError(400, `${label} is required.`, "incomplete_note");
  if (text.length > maximum) throw new HttpError(413, `${label} is too long.`, "note_too_large");
  return text;
}

function normalizeValues(input, id) {
  const values = input && typeof input === "object" ? input : {};
  const slug = normalizeId(values.slug);
  if (slug !== id) throw new HttpError(400, "The Spark id and slug do not match.", "slug_mismatch");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(values.date || ""))) {
    throw new HttpError(400, "The Spark date is invalid.", "invalid_date");
  }
  const kind = values.kind === "log" ? "log" : values.kind === "note" ? "note" : "";
  if (!kind) throw new HttpError(400, "The Spark type is invalid.", "invalid_kind");
  const localized = {};
  for (const language of ["zh", "en"]) {
    const requiredLanguage = language === "zh";
    const candidateBody = String(values[language]?.body || "");
    const bodyLimit = language === "zh" && candidateBody.startsWith(SEALED_VALUE_PREFIX) ? 800_000 : MAX_BODY_LENGTH;
    localized[language] = {
      body: normalizedText(candidateBody, `${language} body`, bodyLimit, requiredLanguage),
      summary: normalizedText(values[language]?.summary, `${language} summary`, 1_000),
      title: normalizedText(values[language]?.title, `${language} title`, 200, requiredLanguage).trim(),
    };
  }
  return {
    announce: values.announce === true,
    comments: values.comments !== false,
    date: String(values.date),
    en: localized.en,
    kind,
    published: Boolean(values.published),
    slug,
    zh: localized.zh,
  };
}

function normalizeSha(value) {
  const sha = String(value || "").toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

function validatePublicPath(path, id, language) {
  const value = String(path || "");
  const expectedSuffix = `-${id}-${language}.md`;
  if (!value.startsWith("_posts/") || !value.endsWith(expectedSuffix) || value.includes("..")) {
    throw new HttpError(400, "A public Spark path is invalid.", "invalid_public_path");
  }
  return value;
}

function normalizePublicState(input, id) {
  if (!input) return null;
  const paths = {
    en: validatePublicPath(input.paths?.en, id, "en"),
    zh: validatePublicPath(input.paths?.zh, id, "zh"),
  };
  const shas = { en: normalizeSha(input.shas?.en), zh: normalizeSha(input.shas?.zh) };
  if (!shas.en || !shas.zh) throw new HttpError(400, "Public Spark source SHAs are required.", "invalid_public_sha");
  return { paths, shas };
}

function notePath(id) {
  return `${NOTE_DIRECTORY}/${id}${NOTE_SUFFIX}`;
}

function branchFor(env, kind) {
  return String(env[kind === "private" ? "PRIVATE_BRANCH" : "PUBLIC_BRANCH"] || "main");
}

async function readRepositoryFile(env, token, repository, branch, path, allowNotFound = false) {
  const remote = await githubRequest(env, token, repoEndpoint(repository, `/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`), {
    allowNotFound,
  });
  if (!remote) return null;
  if (remote.type !== "file" || !remote.content || !remote.sha) {
    throw new HttpError(422, "GitHub returned an unsupported private Spark record.", "unsupported_record");
  }
  return { content: decoder.decode(base64ToBytes(remote.content)), sha: remote.sha };
}

async function writeRepositoryFile(env, token, repository, branch, path, content, message, sha = "") {
  const body = {
    branch,
    content: bytesToBase64(encoder.encode(content)),
    message,
  };
  if (sha) body.sha = sha;
  return githubRequest(env, token, repoEndpoint(repository, `/contents/${encodePath(path)}`), {
    body,
    method: "PUT",
  });
}

async function loadEncryptedRecord(env, token, id, allowNotFound = false) {
  const repository = required(env, "PRIVATE_REPO");
  const remote = await readRepositoryFile(env, token, repository, branchFor(env, "private"), notePath(id), allowNotFound);
  if (!remote) return null;
  let envelope;
  try {
    envelope = JSON.parse(remote.content);
  } catch (_error) {
    throw new HttpError(422, "The encrypted Spark record is not valid JSON.", "invalid_envelope");
  }
  return { record: await decryptRecord(envelope, env), sha: remote.sha };
}

async function saveEncryptedRecord(env, token, record, expectedSha = "", message = "") {
  const envelope = await encryptRecord(record, env);
  const result = await writeRepositoryFile(
    env,
    token,
    required(env, "PRIVATE_REPO"),
    branchFor(env, "private"),
    notePath(record.id),
    `${JSON.stringify(envelope, null, 2)}\n`,
    message || `spark: save encrypted ${record.id}`,
    expectedSha
  );
  return result.content?.sha || "";
}

function noteSummary(record, sha) {
  const summary = {
    date: record.values.date,
    id: record.id,
    kind: record.values.kind,
    published: record.values.published === true,
    sha,
    title: { en: record.values.en.title, zh: record.values.zh.title },
    updatedAt: record.updatedAt,
  };
  const sealed = String(record.values?.zh?.body || "");
  if (sealed.startsWith(SEALED_VALUE_PREFIX)) summary.sealed = sealed;
  return summary;
}

function normalizeKeyring(input) {
  if (!input || input.version !== 2 || input.algorithm !== "A256GCM+PBKDF2+WebAuthn-PRF") {
    throw new HttpError(400, "The Spark Vault keyring format is invalid.", "invalid_keyring");
  }
  const requiredFields = [
    "combine_salt",
    "credential_id",
    "passphrase_salt",
    "prf_salt",
    "recovery_iv",
    "recovery_wrapped_root",
    "wrap_iv",
    "wrapped_root",
  ];
  const keyring = {
    algorithm: input.algorithm,
    combine_salt: "",
    created_at: String(input.created_at || new Date().toISOString()).slice(0, 64),
    credential_id: "",
    iterations: Number(input.iterations),
    passphrase_salt: "",
    prf_salt: "",
    recovery_iv: "",
    recovery_wrapped_root: "",
    version: 2,
    wrap_iv: "",
    wrapped_root: "",
  };
  if (!Number.isSafeInteger(keyring.iterations) || keyring.iterations < 310_000 || keyring.iterations > 2_000_000) {
    throw new HttpError(400, "The Spark Vault key derivation cost is invalid.", "invalid_keyring");
  }
  for (const field of requiredFields) {
    const value = String(input[field] || "");
    if (!/^[A-Za-z0-9_-]{12,4096}$/.test(value)) {
      throw new HttpError(400, "The Spark Vault keyring contains invalid key material.", "invalid_keyring");
    }
    keyring[field] = value;
  }
  return keyring;
}

async function loadKeyring(env, token) {
  const remote = await readRepositoryFile(env, token, required(env, "PRIVATE_REPO"), branchFor(env, "private"), KEYRING_PATH, true);
  if (!remote) return { keyring: null, sha: "" };
  try {
    return { keyring: normalizeKeyring(JSON.parse(remote.content)), sha: remote.sha };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "The Spark Vault keyring is not valid JSON.", "invalid_keyring");
  }
}

async function saveKeyring(env, token, payload) {
  const existing = await loadKeyring(env, token);
  const expectedSha = normalizeSha(payload.expectedSha);
  if (existing.sha && expectedSha !== existing.sha) {
    throw new HttpError(409, "The Spark Vault keyring changed after it was opened.", "vault_conflict");
  }
  if (!existing.sha && expectedSha) {
    throw new HttpError(409, "The Spark Vault keyring no longer exists.", "vault_conflict");
  }
  const keyring = normalizeKeyring(payload.keyring);
  const result = await writeRepositoryFile(
    env,
    token,
    required(env, "PRIVATE_REPO"),
    branchFor(env, "private"),
    KEYRING_PATH,
    `${JSON.stringify(keyring, null, 2)}\n`,
    existing.sha ? "vault: rotate zero-knowledge keyring" : "vault: initialize zero-knowledge keyring",
    existing.sha
  );
  return { keyring, sha: result.content?.sha || "" };
}

async function listNotes(env, token) {
  const repository = required(env, "PRIVATE_REPO");
  const branch = branchFor(env, "private");
  const listing = await githubRequest(env, token, repoEndpoint(repository, `/contents/${NOTE_DIRECTORY}?ref=${encodeURIComponent(branch)}`), {
    allowNotFound: true,
  });
  if (!listing) return [];
  if (!Array.isArray(listing)) throw new HttpError(422, "The private Spark directory is invalid.", "invalid_note_directory");
  const files = listing.filter((item) => item.type === "file" && String(item.name).endsWith(NOTE_SUFFIX)).slice(0, 200);
  const notes = [];
  for (const file of files) {
    const id = normalizeId(String(file.name).slice(0, -NOTE_SUFFIX.length));
    const loaded = await loadEncryptedRecord(env, token, id, false);
    notes.push(noteSummary(loaded.record, loaded.sha));
  }
  return notes.sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

async function saveNote(env, token, id, payload) {
  const expectedSha = normalizeSha(payload.expectedSha);
  const existing = await loadEncryptedRecord(env, token, id, true);
  if (existing && (!expectedSha || expectedSha !== existing.sha)) {
    throw new HttpError(409, "This private Spark changed after it was opened.", "vault_conflict");
  }
  if (!existing && expectedSha) throw new HttpError(409, "This private Spark no longer exists.", "vault_conflict");
  const suppliedPublic = existing ? null : normalizePublicState(payload.public, id);
  const values = normalizeValues(payload.values, id);
  values.published = existing?.record.values.published === true || Boolean(suppliedPublic);
  const record = {
    createdAt: existing?.record.createdAt || new Date().toISOString(),
    id,
    public: existing?.record.public || suppliedPublic,
    updatedAt: new Date().toISOString(),
    values,
    version: 1,
  };
  const sha = await saveEncryptedRecord(env, token, record, existing?.sha || "", normalizedText(payload.message, "commit message", 200));
  return { ...noteSummary(record, sha), public: record.public, values: record.values };
}

function plainSummary(body) {
  return String(body)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function jekyllDate(value) {
  return `${String(value).replace("T", " ")}:00 +0800`;
}

function publicLocalization(language, record) {
  const localized = record.values[language];
  if (language !== "en" || (localized.title.trim() && localized.body.trim())) return localized;
  return {
    body: `> English translation pending. [Read the Chinese source](/spark/${record.id}/).`,
    summary: "English translation pending. Read the Chinese source.",
    title: `Translation pending · ${record.values.zh.title.trim()}`,
  };
}

function composePublicSource(language, record, path) {
  const values = record.values;
  const localized = publicLocalization(language, record);
  const description = localized.summary.trim() || plainSummary(localized.body);
  const permalink = language === "en" ? `/en/spark/${record.id}/` : `/spark/${record.id}/`;
  return {
    content: [
      "---",
      "layout: post",
      `title: ${JSON.stringify(localized.title.trim())}`,
      `slug: ${JSON.stringify(record.id)}`,
      `date: ${jekyllDate(values.date)}`,
      "published: true",
      `announce: ${values.announce ? "true" : "false"}`,
      `description: ${JSON.stringify(description)}`,
      `permalink: ${permalink}`,
      `lang: ${language}`,
      `locale: ${language}`,
      `translation_key: spark-${record.id}`,
      `kind: ${values.kind}`,
      "tags: []",
      "categories: []",
      "related_posts: false",
      `giscus_comments: ${values.comments ? "true" : "false"}`,
      "---",
      "",
      localized.body.trimEnd(),
      "",
    ].join("\n"),
    path,
  };
}

function publicPaths(record) {
  if (record.public?.paths?.zh && record.public?.paths?.en) return record.public.paths;
  const prefix = record.values.date.slice(0, 10);
  return {
    en: `_posts/${prefix}-${record.id}-en.md`,
    zh: `_posts/${prefix}-${record.id}-zh.md`,
  };
}

function assertChineseComplete(record) {
  if (!record.values.zh?.title?.trim() || !record.values.zh?.body?.trim()) {
    throw new HttpError(422, "A Chinese title and body are required before publishing.", "chinese_required");
  }
}

async function verifyPublicTargets(env, token, record, paths) {
  const repository = required(env, "PUBLIC_REPO");
  const branch = branchFor(env, "public");
  const remotes = {};
  for (const language of ["zh", "en"]) {
    remotes[language] = await readRepositoryFile(env, token, repository, branch, paths[language], true);
    const expected = normalizeSha(record.public?.shas?.[language]);
    if (expected && remotes[language]?.sha !== expected) {
      throw new HttpError(409, "A public Spark file changed after the private copy was opened.", "public_conflict");
    }
    if (!expected && remotes[language]) {
      throw new HttpError(409, "That public Spark path already exists.", "public_collision");
    }
  }
  return remotes;
}

async function commitPublicPair(env, token, record, remove = false, message = "") {
  const repository = required(env, "PUBLIC_REPO");
  const branch = branchFor(env, "public");
  const paths = publicPaths(record);
  await verifyPublicTargets(env, token, record, paths);
  const head = await githubRequest(env, token, repoEndpoint(repository, `/git/ref/heads/${encodeURIComponent(branch)}`));
  const headSha = head.object?.sha;
  if (!headSha) throw new HttpError(502, "The public branch head is unavailable.", "branch_unavailable");
  const parent = await githubRequest(env, token, repoEndpoint(repository, `/git/commits/${headSha}`));
  const baseTree = parent.tree?.sha;
  if (!baseTree) throw new HttpError(502, "The public branch tree is unavailable.", "tree_unavailable");
  const pair = remove
    ? null
    : {
        en: composePublicSource("en", record, paths.en),
        zh: composePublicSource("zh", record, paths.zh),
      };
  const tree = await githubRequest(env, token, repoEndpoint(repository, "/git/trees"), {
    body: {
      base_tree: baseTree,
      tree: ["zh", "en"].map((language) =>
        remove
          ? { mode: "100644", path: paths[language], sha: null, type: "blob" }
          : { content: pair[language].content, mode: "100644", path: paths[language], type: "blob" }
      ),
    },
    method: "POST",
  });
  const defaultMessage = remove ? `spark: make ${record.id} private` : `spark: publish ${record.id}`;
  const commit = await githubRequest(env, token, repoEndpoint(repository, "/git/commits"), {
    body: { message: message || defaultMessage, parents: [headSha], tree: tree.sha },
    method: "POST",
  });
  await githubRequest(env, token, repoEndpoint(repository, `/git/refs/heads/${encodeURIComponent(branch)}`), {
    body: { force: false, sha: commit.sha },
    method: "PATCH",
  });
  const shas = {};
  if (!remove) {
    for (const language of ["zh", "en"]) {
      shas[language] = tree.tree?.find((item) => item.path === paths[language])?.sha || "";
      if (!normalizeSha(shas[language])) {
        const remote = await readRepositoryFile(env, token, repository, branch, paths[language], false);
        shas[language] = remote.sha;
      }
    }
  }
  return { commit, paths, shas, tree };
}

async function changeVisibility(env, token, id, payload, makePublic) {
  const loaded = await loadEncryptedRecord(env, token, id, false);
  const expectedSha = normalizeSha(payload.expectedSha);
  if (!expectedSha || expectedSha !== loaded.sha) {
    throw new HttpError(409, "This private Spark changed after it was opened.", "vault_conflict");
  }
  if (!makePublic && !loaded.record.values.published) {
    return { commit: null, note: { ...noteSummary(loaded.record, loaded.sha), public: loaded.record.public, values: loaded.record.values } };
  }
  if (makePublic) assertChineseComplete(loaded.record);
  const message = normalizedText(payload.message, "commit message", 200);
  const publicResult = await commitPublicPair(env, token, loaded.record, !makePublic, message);
  loaded.record.values.published = makePublic;
  loaded.record.public = makePublic ? { paths: publicResult.paths, shas: publicResult.shas } : null;
  loaded.record.updatedAt = new Date().toISOString();
  const nextSha = await saveEncryptedRecord(
    env,
    token,
    loaded.record,
    loaded.sha,
    makePublic ? `spark: mark ${id} published` : `spark: mark ${id} private`
  );
  return {
    commit: publicResult.commit,
    note: { ...noteSummary(loaded.record, nextSha), public: loaded.record.public, values: loaded.record.values },
  };
}

async function handleApi(request, env) {
  assertAllowedOrigin(request, env);
  const auth = await authenticate(request, env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const parts = path.split("/").filter(Boolean);
  let payload;
  let status = 200;

  if (parts.length === 1 && parts[0] === "session" && request.method === "GET") {
    payload = { authenticated: true, user: auth.session.user };
  } else if (parts.length === 1 && parts[0] === "logout" && request.method === "POST") {
    payload = { authenticated: false };
  } else if (parts.length === 1 && parts[0] === "keyring" && request.method === "GET") {
    payload = await loadKeyring(env, auth.accessToken);
  } else if (parts.length === 1 && parts[0] === "keyring" && request.method === "PUT") {
    payload = await saveKeyring(env, auth.accessToken, await readJson(request));
  } else if (parts.length === 1 && parts[0] === "notes" && request.method === "GET") {
    payload = { notes: await listNotes(env, auth.accessToken) };
  } else if (parts.length >= 2 && parts[0] === "notes") {
    const id = normalizeId(parts[1]);
    if (parts.length === 2 && request.method === "GET") {
      const loaded = await loadEncryptedRecord(env, auth.accessToken, id, false);
      payload = { note: { ...noteSummary(loaded.record, loaded.sha), public: loaded.record.public, values: loaded.record.values } };
    } else if (parts.length === 2 && request.method === "PUT") {
      payload = { note: await saveNote(env, auth.accessToken, id, await readJson(request)) };
      status = 200;
    } else if (parts.length === 3 && parts[2] === "publish" && request.method === "POST") {
      payload = await changeVisibility(env, auth.accessToken, id, await readJson(request), true);
    } else if (parts.length === 3 && parts[2] === "unpublish" && request.method === "POST") {
      payload = await changeVisibility(env, auth.accessToken, id, await readJson(request), false);
    } else {
      throw new HttpError(404, "Spark Vault endpoint not found.", "not_found");
    }
  } else {
    throw new HttpError(404, "Spark Vault endpoint not found.", "not_found");
  }
  return jsonResponse(payload, status, env, auth.rotatedToken, request);
}

async function routeRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return emptyResponse(204, env, request);
  if (request.method === "GET" && url.pathname === "/health") {
    siteOrigins(env);
    required(env, "ALLOWED_GITHUB_USER_ID");
    required(env, "PRIVATE_REPO");
    required(env, "PUBLIC_REPO");
    required(env, "GITHUB_CLIENT_ID");
    required(env, "GITHUB_CLIENT_SECRET");
    decodeSecret(required(env, "SESSION_KEY_B64"), "SESSION_KEY_B64");
    decodeSecret(required(env, "MASTER_KEY_B64"), "MASTER_KEY_B64");
    return jsonResponse({ ok: true, service: "functionhx-spark-vault", version: 2 }, 200, env, "", request);
  }
  if (request.method === "GET" && url.pathname === "/unlock") return createUnlockPage(siteOrigins(env));
  if (request.method === "GET" && url.pathname === "/auth/login") return handleLogin(request, env);
  if (request.method === "GET" && url.pathname === "/auth/callback") return handleCallback(request, env);
  if (url.pathname.startsWith("/api/")) return handleApi(request, env);
  throw new HttpError(404, "Spark Vault endpoint not found.", "not_found");
}

const worker = {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      const status = Number(error.status) || 500;
      const message = status >= 500 && !(error instanceof HttpError) ? "Spark Vault encountered an internal error." : error.message;
      const code = error.code || "internal_error";
      if (status >= 500) console.error("Spark Vault request failed", error);
      try {
        return jsonResponse({ error: { code, message } }, status, env, "", request);
      } catch (_configurationError) {
        return new Response(JSON.stringify({ error: { code, message } }), {
          headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
          status,
        });
      }
    }
  },
};

export default worker;
export const testing = Object.freeze({ decryptRecord, encryptRecord, normalizeValues, sealJson, unsealJson });
