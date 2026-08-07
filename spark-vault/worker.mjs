import { createUnlockPage } from "./unlock-page.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_GITHUB_API = "https://api.github.com";
const DEFAULT_GITHUB_WEB = "https://github.com";
const DEFAULT_FEISHU_ACCOUNTS = "https://accounts.feishu.cn";
const DEFAULT_FEISHU_API = "https://open.feishu.cn";
const DEFAULT_API_VERSION = "2026-03-10";
const NOTE_DIRECTORY = "notes";
const NOTE_SUFFIX = ".spark.json";
const KEYRING_PATH = "vault/keyring.v2.json";
const FEISHU_CONNECTION_PATH = "integrations/feishu/oauth.v1.json";
const FEISHU_OAUTH_STATE_DIRECTORY = "integrations/feishu/oauth-states";
const FEISHU_REQUEST_DIRECTORY = "integrations/feishu/requests";
const FEISHU_CONNECTION_ID = "feishu-oauth";
const FEISHU_STATE_ID = "feishu-oauth-state";
const FEISHU_OAUTH_STATE_LIFETIME_SECONDS = 5 * 60;
const FEISHU_REFRESH_LEASE_SECONDS = 2 * 60;
const FEISHU_REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const FEISHU_SCOPES = Object.freeze(["docx:document:create", "drive:drive.metadata:readonly", "offline_access"]);
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

function feishuAccountsBase(env) {
  return String(env.FEISHU_ACCOUNTS_BASE || DEFAULT_FEISHU_ACCOUNTS).replace(/\/$/, "");
}

function feishuApiBase(env) {
  return String(env.FEISHU_API_BASE || DEFAULT_FEISHU_API).replace(/\/$/, "");
}

function feishuConfiguration(env) {
  const missing = ["FEISHU_CLIENT_ID", "FEISHU_CLIENT_SECRET"].filter((name) => !String(env[name] || "").trim());
  return { configured: missing.length === 0, missing };
}

function requireFeishuConfiguration(env) {
  const configuration = feishuConfiguration(env);
  if (!configuration.configured) {
    throw new HttpError(503, "Feishu Documents is not configured yet.", "feishu_not_configured");
  }
  return configuration;
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

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
}

async function sha256Base64Url(value) {
  return base64UrlEncode(await sha256Bytes(value));
}

async function sha256Hex(value) {
  return Array.from(await sha256Bytes(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function authenticateSealedSession(sealed, env) {
  const session = await unsealJson(sealed, env, "functionhx:spark-session:v1");
  const now = nowSeconds();
  const allowedId = Number(required(env, "ALLOWED_GITHUB_USER_ID"));
  if (session.version !== 1 || session.expiresAt <= now || Number(session.user?.id) !== allowedId) {
    throw new HttpError(401, "The Spark Vault session has expired.", "session_expired");
  }
  if (session.accessExpiresAt > now + REFRESH_SKEW_SECONDS) {
    return { accessToken: session.accessToken, rotatedToken: "", sealedToken: sealed, session };
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
  const rotatedToken = await sealJson(next, env, "functionhx:spark-session:v1");
  return {
    accessToken: next.accessToken,
    rotatedToken,
    sealedToken: rotatedToken,
    session: next,
  };
}

async function authenticate(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "Sign in with GitHub to open Spark Vault.", "authentication_required");
  }
  const sealed = authorization.slice("Bearer ".length).trim();
  if (!sealed) throw new HttpError(401, "Sign in with GitHub to open Spark Vault.", "authentication_required");
  return authenticateSealedSession(sealed, env);
}

function safeReturnPath(value) {
  const candidate = String(value || "/spark/");
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/spark/";
  return candidate;
}

function safeFeishuReturnPath(value) {
  const candidate = String(value || "/documents/");
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/documents/";
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

async function readRepositoryDirectory(env, token, repository, branch, path, allowNotFound = false) {
  const remote = await githubRequest(env, token, repoEndpoint(repository, `/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`), {
    allowNotFound,
  });
  if (!remote) return [];
  if (!Array.isArray(remote)) {
    throw new HttpError(422, "GitHub returned an unsupported integration directory.", "unsupported_record");
  }
  return remote.filter((entry) => entry?.type === "file" && typeof entry.path === "string" && typeof entry.name === "string");
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

async function loadIntegrationRecord(env, token, path, expectedId, allowNotFound = true) {
  const remote = await readRepositoryFile(env, token, required(env, "PRIVATE_REPO"), branchFor(env, "private"), path, allowNotFound);
  if (!remote) return null;
  let envelope;
  try {
    envelope = JSON.parse(remote.content);
  } catch (_error) {
    throw new HttpError(422, "An encrypted integration record is not valid JSON.", "invalid_integration_record");
  }
  const record = await decryptRecord(envelope, env);
  if (record.id !== expectedId) {
    throw new HttpError(422, "An encrypted integration record has the wrong identity.", "invalid_integration_record");
  }
  return { record, sha: remote.sha };
}

async function saveIntegrationRecord(env, token, path, record, expectedSha = "", message = "") {
  const envelope = await encryptRecord(record, env);
  const result = await writeRepositoryFile(
    env,
    token,
    required(env, "PRIVATE_REPO"),
    branchFor(env, "private"),
    path,
    `${JSON.stringify(envelope, null, 2)}\n`,
    message,
    expectedSha
  );
  return { record, sha: result.content?.sha || "" };
}

function feishuErrorMessage(payload, fallback) {
  return String(payload?.error_description || payload?.msg || payload?.error || fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function feishuApiError(response, payload, fallback = "Feishu rejected the request.") {
  const status = response?.status === 401 ? 401 : response?.status === 403 ? 403 : response?.status >= 500 ? 503 : 502;
  const error = new HttpError(status, feishuErrorMessage(payload, fallback), "feishu_api_error");
  error.feishuCode = Number(payload?.code) || 0;
  error.feishuStatus = Number(response?.status) || 0;
  return error;
}

async function feishuJsonRequest(env, endpoint, options = {}) {
  const headers = { "Content-Type": "application/json; charset=utf-8", ...options.headers };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEISHU_REQUEST_TIMEOUT_MILLISECONDS);
  let response;
  let payload;
  try {
    response = await fetch(`${feishuApiBase(env)}${endpoint}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method || "GET",
      signal: controller.signal,
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      payload = {};
    }
  } catch (_error) {
    throw new HttpError(503, "Feishu could not be reached.", "feishu_network_error");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok || Number(payload.code) !== 0) throw feishuApiError(response, payload);
  return payload;
}

function validateFeishuScopes(scope) {
  const granted = new Set(
    String(scope || "")
      .split(/\s+/)
      .filter(Boolean)
  );
  const missing = FEISHU_SCOPES.filter((item) => !granted.has(item));
  if (missing.length) {
    throw new HttpError(403, `Feishu did not grant the required scopes: ${missing.join(", ")}.`, "feishu_scope_missing");
  }
  const unexpected = [...granted].filter((item) => !FEISHU_SCOPES.includes(item));
  if (unexpected.length) {
    throw new HttpError(403, "Feishu returned a token broader than this integration permits.", "feishu_scope_excess");
  }
  return [...granted].sort();
}

function normalizeFeishuTokenPayload(payload, requireRefresh = true) {
  const accessToken = String(payload.access_token || "");
  const refreshToken = String(payload.refresh_token || "");
  const accessLifetime = Number(payload.expires_in);
  const refreshLifetime = Number(payload.refresh_token_expires_in);
  if (!accessToken || !Number.isFinite(accessLifetime) || accessLifetime <= 0) {
    throw new HttpError(502, "Feishu returned an incomplete user access token.", "feishu_token_invalid");
  }
  if (requireRefresh && (!refreshToken || !Number.isFinite(refreshLifetime) || refreshLifetime <= 0)) {
    throw new HttpError(502, "Feishu did not return the required rotating refresh token.", "feishu_refresh_token_missing");
  }
  const now = nowSeconds();
  return {
    accessExpiresAt: now + Math.floor(accessLifetime),
    accessToken,
    refreshExpiresAt: refreshToken ? now + Math.floor(refreshLifetime) : 0,
    refreshToken,
    scope: validateFeishuScopes(payload.scope),
    tokenType: String(payload.token_type || "Bearer"),
  };
}

async function exchangeFeishuAuthorizationCode(env, code, redirectUri, verifier) {
  requireFeishuConfiguration(env);
  return feishuJsonRequest(env, "/open-apis/authen/v2/oauth/token", {
    body: {
      client_id: required(env, "FEISHU_CLIENT_ID"),
      client_secret: required(env, "FEISHU_CLIENT_SECRET"),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      scope: FEISHU_SCOPES.join(" "),
    },
    method: "POST",
  });
}

async function exchangeFeishuRefreshToken(env, refreshToken) {
  requireFeishuConfiguration(env);
  return feishuJsonRequest(env, "/open-apis/authen/v2/oauth/token", {
    body: {
      client_id: required(env, "FEISHU_CLIENT_ID"),
      client_secret: required(env, "FEISHU_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: FEISHU_SCOPES.join(" "),
    },
    method: "POST",
  });
}

async function fetchFeishuIdentity(env, accessToken) {
  const payload = await feishuJsonRequest(env, "/open-apis/authen/v1/user_info", { accessToken });
  const openId = String(payload.data?.open_id || "");
  if (!openId) throw new HttpError(502, "Feishu did not return an owner identity.", "feishu_identity_missing");
  return {
    name: String(payload.data?.name || payload.data?.en_name || "Feishu user").slice(0, 200),
    openId,
    tenantKey: String(payload.data?.tenant_key || "").slice(0, 200),
  };
}

function assertAllowedFeishuIdentity(env, identity, existing = null) {
  const allowedOpenId = String(env.ALLOWED_FEISHU_OPEN_ID || "").trim();
  const allowedTenantKey = String(env.ALLOWED_FEISHU_TENANT_KEY || "").trim();
  const pinnedOpenId = String(existing?.record?.identity?.openId || "");
  const pinnedTenantKey = String(existing?.record?.identity?.tenantKey || "");
  if (allowedOpenId && identity.openId !== allowedOpenId) {
    throw new HttpError(403, "This Feishu account is not allowed to connect.", "feishu_user_denied");
  }
  if (allowedTenantKey && identity.tenantKey !== allowedTenantKey) {
    throw new HttpError(403, "This Feishu tenant is not allowed to connect.", "feishu_tenant_denied");
  }
  if (pinnedOpenId && identity.openId !== pinnedOpenId) {
    throw new HttpError(403, "A different Feishu account is already pinned to this site.", "feishu_user_denied");
  }
  if (pinnedTenantKey && identity.tenantKey !== pinnedTenantKey) {
    throw new HttpError(403, "A different Feishu tenant is already pinned to this site.", "feishu_tenant_denied");
  }
}

function normalizeFeishuConnection(record) {
  const token = record?.token || {};
  const identity = record?.identity || {};
  const storedScopes = Array.isArray(token.scope) ? [...token.scope].sort() : [];
  const expectedScopes = [...FEISHU_SCOPES].sort();
  if (
    record?.version !== 1 ||
    record?.id !== FEISHU_CONNECTION_ID ||
    !identity.openId ||
    !token.accessToken ||
    !Number.isSafeInteger(token.accessExpiresAt) ||
    !token.refreshToken ||
    !Number.isSafeInteger(token.refreshExpiresAt) ||
    String(token.tokenType || "").toLowerCase() !== "bearer" ||
    storedScopes.length !== expectedScopes.length ||
    storedScopes.some((scope, index) => scope !== expectedScopes[index])
  ) {
    throw new HttpError(422, "The encrypted Feishu connection is invalid.", "invalid_feishu_connection");
  }
  return record;
}

async function loadFeishuConnection(env, githubToken, allowNotFound = true) {
  const loaded = await loadIntegrationRecord(env, githubToken, FEISHU_CONNECTION_PATH, FEISHU_CONNECTION_ID, allowNotFound);
  if (!loaded) return null;
  normalizeFeishuConnection(loaded.record);
  assertAllowedFeishuIdentity(env, loaded.record.identity);
  return loaded;
}

function publicFeishuIdentity(identity) {
  return { name: String(identity?.name || "Feishu user"), open_id: String(identity?.openId || "") };
}

function feishuConnectionUsable(record) {
  const token = record?.token || {};
  const now = nowSeconds();
  return (
    !record?.reauthorizationRequired && (Number(token.accessExpiresAt) > now || (Boolean(token.refreshToken) && Number(token.refreshExpiresAt) > now))
  );
}

function isRepositoryConflict(error) {
  return error?.githubStatus === 409 || error?.githubStatus === 422;
}

async function acquireFreshFeishuAccessToken(env, githubToken) {
  let loaded = await loadFeishuConnection(env, githubToken, true);
  if (!loaded) throw new HttpError(409, "Connect Feishu before creating a document.", "feishu_authorization_required");
  const now = nowSeconds();
  if (!loaded.record.reauthorizationRequired && loaded.record.token.accessExpiresAt > now + REFRESH_SKEW_SECONDS) {
    return { accessToken: loaded.record.token.accessToken, connection: loaded };
  }
  if (loaded.record.reauthorizationRequired || !loaded.record.token.refreshToken || loaded.record.token.refreshExpiresAt <= now) {
    throw new HttpError(409, "Reconnect Feishu before creating another document.", "feishu_reauthorization_required");
  }
  if (loaded.record.refreshLease?.expiresAt > now) {
    throw new HttpError(409, "Another request is refreshing Feishu. Retry shortly.", "feishu_refresh_in_progress");
  }

  const leaseId = base64UrlEncode(randomBytes(24));
  const leasedRecord = structuredClone(loaded.record);
  leasedRecord.refreshLease = { expiresAt: now + FEISHU_REFRESH_LEASE_SECONDS, id: leaseId };
  let leased;
  try {
    leased = await saveIntegrationRecord(env, githubToken, FEISHU_CONNECTION_PATH, leasedRecord, loaded.sha, "feishu: acquire refresh-token lease");
  } catch (error) {
    if (!isRepositoryConflict(error)) throw error;
    loaded = await loadFeishuConnection(env, githubToken, false);
    if (loaded.record.token.accessExpiresAt > nowSeconds() + REFRESH_SKEW_SECONDS) {
      return { accessToken: loaded.record.token.accessToken, connection: loaded };
    }
    throw new HttpError(409, "Another request is refreshing Feishu. Retry shortly.", "feishu_refresh_in_progress");
  }

  let refreshedPayload;
  try {
    refreshedPayload = await exchangeFeishuRefreshToken(env, loaded.record.token.refreshToken);
  } catch (error) {
    const recoveryRecord = structuredClone(leased.record);
    recoveryRecord.refreshLease = null;
    // A refresh token is single-use. Once the request leaves this service, any
    // non-success outcome is ambiguous enough that retrying the old token could
    // destroy the only valid rotation. Require a fresh owner authorization.
    recoveryRecord.reauthorizationRequired = true;
    try {
      await saveIntegrationRecord(env, githubToken, FEISHU_CONNECTION_PATH, recoveryRecord, leased.sha, "feishu: require OAuth reconnect");
    } catch (_saveError) {
      // A later request will observe the short lease or force a fresh authorization.
    }
    throw new HttpError(409, "Reconnect Feishu before creating another document.", "feishu_reauthorization_required");
  }

  let rotated;
  try {
    rotated = normalizeFeishuTokenPayload(refreshedPayload, true);
  } catch (error) {
    const recoveryRecord = structuredClone(leased.record);
    recoveryRecord.refreshLease = null;
    recoveryRecord.reauthorizationRequired = true;
    try {
      await saveIntegrationRecord(
        env,
        githubToken,
        FEISHU_CONNECTION_PATH,
        recoveryRecord,
        leased.sha,
        "feishu: require OAuth reconnect after invalid rotation"
      );
    } catch (_saveError) {
      // The short lease prevents another refresh until the owner reconnects.
    }
    throw error;
  }
  const refreshedRecord = structuredClone(leased.record);
  refreshedRecord.refreshLease = null;
  refreshedRecord.reauthorizationRequired = false;
  refreshedRecord.token = rotated;
  refreshedRecord.updatedAt = new Date().toISOString();
  let saved;
  try {
    saved = await saveIntegrationRecord(env, githubToken, FEISHU_CONNECTION_PATH, refreshedRecord, leased.sha, "feishu: rotate user refresh token");
  } catch (_error) {
    const current = await loadFeishuConnection(env, githubToken, true).catch(() => null);
    if (current?.record?.token?.accessExpiresAt > nowSeconds() + REFRESH_SKEW_SECONDS) {
      return { accessToken: current.record.token.accessToken, connection: current };
    }
    throw new HttpError(409, "The rotated Feishu token could not be stored safely. Reconnect Feishu.", "feishu_reauthorization_required");
  }
  return { accessToken: rotated.accessToken, connection: saved };
}

function feishuErrorRequiresReconnect(error) {
  const tokenCodes = new Set([20005, 99991663, 99991668, 99991671]);
  return Number(error?.status) === 401 || tokenCodes.has(Number(error?.feishuCode));
}

function feishuReauthorizationError() {
  return new HttpError(409, "Reconnect Feishu before creating another document.", "feishu_reauthorization_required");
}

async function markFeishuReauthorizationRequired(env, githubToken) {
  const loaded = await loadFeishuConnection(env, githubToken, true);
  if (!loaded || loaded.record.reauthorizationRequired) return;
  const record = structuredClone(loaded.record);
  record.reauthorizationRequired = true;
  record.refreshLease = null;
  record.updatedAt = new Date().toISOString();
  try {
    await saveIntegrationRecord(env, githubToken, FEISHU_CONNECTION_PATH, record, loaded.sha, "feishu: require owner OAuth reconnect");
  } catch (error) {
    if (!isRepositoryConflict(error)) throw error;
  }
}

async function handleFeishuOAuthStart(request, env, auth) {
  requireFeishuConfiguration(env);
  const candidate = await readJson(request);
  const input = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
  const requestOrigin = allowedSiteOrigin(request.headers.get("Origin"), env);
  const origin = allowedSiteOrigin(input.site_origin || requestOrigin, env);
  if (origin !== requestOrigin) throw new HttpError(403, "The Feishu return origin does not match this request.", "origin_denied");

  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = await sha256Base64Url(verifier);
  const stateId = base64UrlEncode(randomBytes(24));
  const stateHash = await sha256Hex(stateId);
  const stateIdentity = {
    id: `${FEISHU_STATE_ID}-${stateHash}`,
    path: `${FEISHU_OAUTH_STATE_DIRECTORY}/${stateHash}.json`,
  };
  const expiresAt = nowSeconds() + FEISHU_OAUTH_STATE_LIFETIME_SECONDS;
  const state = await sealJson(
    {
      expiresAt,
      githubSession: auth.sealedToken,
      id: stateId,
      origin,
      returnPath: safeFeishuReturnPath(input.return_to),
      verifier,
      version: 1,
    },
    env,
    "functionhx:feishu-oauth-state:v1"
  );
  const marker = {
    expiresAt,
    id: stateIdentity.id,
    stateHash,
    usedAt: null,
    version: 1,
  };
  try {
    await saveIntegrationRecord(env, auth.accessToken, stateIdentity.path, marker, "", "feishu: start owner OAuth");
  } catch (error) {
    if (isRepositoryConflict(error)) {
      throw new HttpError(409, "Another Feishu authorization was started. Retry once.", "feishu_oauth_start_conflict");
    }
    throw error;
  }

  const redirectUri = `${workerOrigin(request, env)}/auth/feishu/callback`;
  const authorize = new URL(`${feishuAccountsBase(env)}/open-apis/authen/v1/authorize`);
  authorize.searchParams.set("client_id", required(env, "FEISHU_CLIENT_ID"));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", FEISHU_SCOPES.join(" "));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return { authorize_url: authorize.toString() };
}

async function consumeFeishuOAuthState(env, githubToken, state) {
  const stateHash = await sha256Hex(state.id);
  const stateIdentity = {
    id: `${FEISHU_STATE_ID}-${stateHash}`,
    path: `${FEISHU_OAUTH_STATE_DIRECTORY}/${stateHash}.json`,
  };
  const loaded = await loadIntegrationRecord(env, githubToken, stateIdentity.path, stateIdentity.id, false);
  if (loaded.record.version !== 1 || loaded.record.expiresAt <= nowSeconds() || loaded.record.usedAt || loaded.record.stateHash !== stateHash) {
    throw new HttpError(401, "The Feishu authorization request is expired or was already used.", "feishu_oauth_state_invalid");
  }
  const consumed = { ...loaded.record, usedAt: new Date().toISOString() };
  try {
    return await saveIntegrationRecord(env, githubToken, stateIdentity.path, consumed, loaded.sha, "feishu: consume owner OAuth state");
  } catch (error) {
    if (isRepositoryConflict(error)) {
      throw new HttpError(401, "The Feishu authorization request was already used.", "feishu_oauth_state_invalid");
    }
    throw error;
  }
}

function feishuCallbackPage(origin, _returnPath, payload) {
  const nonce = base64UrlEncode(randomBytes(18));
  const safePayload = JSON.stringify({ type: "functionhx:feishu-connected", ...payload }).replace(/</g, "\\u003c");
  const safeTarget = JSON.stringify(origin);
  const heading = payload.connected ? "飞书已连接" : "飞书未连接";
  const copy = payload.connected ? "正在返回文档页，可以关闭这个窗口。" : "授权没有完成，请返回文档页后重试。";
  const script = `const payload=${safePayload};const target=${safeTarget};if(window.opener&&!window.opener.closed){window.opener.postMessage(payload,target);window.close()}`;
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

async function handleFeishuCallback(request, env) {
  requireFeishuConfiguration(env);
  const url = new URL(request.url);
  const stateToken = url.searchParams.get("state") || "";
  if (!stateToken) throw new HttpError(400, "Feishu did not return OAuth state.", "feishu_oauth_incomplete");
  const state = await unsealJson(stateToken, env, "functionhx:feishu-oauth-state:v1");
  if (state.version !== 1 || state.expiresAt <= nowSeconds() || !state.id || !state.verifier || !state.githubSession) {
    throw new HttpError(401, "The Feishu authorization request expired.", "feishu_oauth_state_invalid");
  }
  const origin = allowedSiteOrigin(state.origin, env);
  const auth = await authenticateSealedSession(state.githubSession, env);
  await consumeFeishuOAuthState(env, auth.accessToken, state);

  if (url.searchParams.get("error")) {
    return feishuCallbackPage(origin, safeFeishuReturnPath(state.returnPath), {
      connected: false,
      error: { code: "feishu_access_denied" },
    });
  }
  try {
    const code = url.searchParams.get("code") || "";
    if (!code) throw new HttpError(400, "Feishu did not return an authorization code.", "feishu_oauth_incomplete");
    const redirectUri = `${workerOrigin(request, env)}/auth/feishu/callback`;
    const tokenPayload = await exchangeFeishuAuthorizationCode(env, code, redirectUri, state.verifier);
    const token = normalizeFeishuTokenPayload(tokenPayload, true);
    const identity = await fetchFeishuIdentity(env, token.accessToken);
    const existing = await loadFeishuConnection(env, auth.accessToken, true);
    assertAllowedFeishuIdentity(env, identity, existing);
    const connection = {
      createdAt: existing?.record?.createdAt || new Date().toISOString(),
      id: FEISHU_CONNECTION_ID,
      identity,
      reauthorizationRequired: false,
      refreshLease: null,
      token,
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    await saveIntegrationRecord(
      env,
      auth.accessToken,
      FEISHU_CONNECTION_PATH,
      connection,
      existing?.sha || "",
      existing ? "feishu: reconnect owner OAuth" : "feishu: connect owner OAuth"
    );
    return feishuCallbackPage(origin, safeFeishuReturnPath(state.returnPath), {
      connected: true,
      user: publicFeishuIdentity(identity),
    });
  } catch (error) {
    if (Number(error.status) >= 500) console.error("Feishu OAuth callback failed", error);
    return feishuCallbackPage(origin, safeFeishuReturnPath(state.returnPath), {
      connected: false,
      error: { code: String(error.code || "feishu_oauth_failed") },
    });
  }
}

function normalizeFeishuTitle(value) {
  const title = String(value || "").trim();
  if (!title || title.length > 800 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new HttpError(400, "A plain-text Feishu document title of 1 to 800 characters is required.", "invalid_feishu_title");
  }
  return title;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "");
  if (key.length < 16 || key.length > 200 || /\s/.test(key)) {
    throw new HttpError(400, "A stable idempotency_key of 16 to 200 non-space characters is required.", "invalid_idempotency_key");
  }
  return key;
}

async function feishuRequestIdentity(key) {
  const hash = await sha256Hex(key);
  return {
    hash,
    id: `feishu-request-${hash}`,
    path: `${FEISHU_REQUEST_DIRECTORY}/${hash}.json`,
  };
}

async function loadFeishuCreateRequest(env, githubToken, identity) {
  return loadIntegrationRecord(env, githubToken, identity.path, identity.id, true);
}

async function queryFeishuDocumentUrl(env, accessToken, documentToken) {
  const payload = await feishuJsonRequest(env, "/open-apis/drive/v1/metas/batch_query?user_id_type=open_id", {
    accessToken,
    body: { request_docs: [{ doc_token: documentToken, doc_type: "docx" }], with_url: true },
    method: "POST",
  });
  const metas = Array.isArray(payload.data?.metas) ? payload.data.metas : [];
  const metadata = metas.find((item) => item.request_doc_info?.doc_token === documentToken && item.request_doc_info?.doc_type === "docx");
  let url;
  try {
    url = new URL(String(metadata?.url || ""));
  } catch (_error) {
    throw new HttpError(502, "Feishu created the document but did not return its official URL.", "feishu_document_url_missing");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (hostname !== "feishu.cn" && !hostname.endsWith(".feishu.cn"))) {
    throw new HttpError(502, "Feishu returned an invalid document URL.", "feishu_document_url_invalid");
  }
  return { title: String(metadata?.title || "").slice(0, 800), url: url.toString() };
}

function feishuCreateResponse(record, idempotent = false) {
  return {
    created_at: record.completedAt || record.createdAt,
    document_token: record.documentToken,
    idempotent,
    title: record.resultTitle || record.title,
    url: record.url,
  };
}

function feishuDocumentSummary(record) {
  if (record?.status !== "succeeded") return null;
  let url;
  try {
    url = new URL(String(record.url || ""));
  } catch (_error) {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const officialHost = hostname === "feishu.cn" || hostname.endsWith(".feishu.cn");
  if (url.protocol !== "https:" || !officialHost || url.username || url.password) return null;
  const createdAt = String(record.completedAt || record.createdAt || "");
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
  const title = String(record.resultTitle || record.title || "")
    .trim()
    .slice(0, 800);
  if (!title) return null;
  return { created_at: createdAt, title, url: url.toString() };
}

async function listFeishuDocuments(env, githubToken) {
  const entries = await readRepositoryDirectory(
    env,
    githubToken,
    required(env, "PRIVATE_REPO"),
    branchFor(env, "private"),
    FEISHU_REQUEST_DIRECTORY,
    true
  );
  const identities = entries
    .map((entry) => {
      const match = entry.name.match(/^([0-9a-f]{64})\.json$/);
      if (!match || entry.path !== `${FEISHU_REQUEST_DIRECTORY}/${entry.name}`) return null;
      return { id: `feishu-request-${match[1]}`, path: entry.path };
    })
    .filter(Boolean);

  const documents = [];
  for (let offset = 0; offset < identities.length; offset += 12) {
    const batch = identities.slice(offset, offset + 12);
    const loaded = await Promise.all(batch.map((identity) => loadIntegrationRecord(env, githubToken, identity.path, identity.id, false)));
    for (const item of loaded) {
      const summary = feishuDocumentSummary(item.record);
      if (summary) documents.push(summary);
    }
  }
  documents.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  return documents.slice(0, 200);
}

function feishuCreateOutcomeIsUnknown(error) {
  if (error?.code === "feishu_network_error") return true;
  if (error?.code !== "feishu_api_error") return false;
  return (
    Number(error.feishuStatus) >= 500 ||
    (Number(error.feishuStatus) === 200 && Number(error.feishuCode) === 0) ||
    [20050, 20072].includes(Number(error.feishuCode))
  );
}

function feishuCreateOutcomeUnknownError() {
  return new HttpError(
    409,
    "Feishu may have created the document, but the result could not be confirmed. Check Feishu before trying a new request.",
    "feishu_create_outcome_unknown"
  );
}

async function finishFeishuDocumentRequest(env, githubToken, accessToken, loaded) {
  let metadata;
  try {
    metadata = await queryFeishuDocumentUrl(env, accessToken, loaded.record.documentToken);
  } catch (error) {
    if (feishuErrorRequiresReconnect(error)) {
      await markFeishuReauthorizationRequired(env, githubToken);
      throw feishuReauthorizationError();
    }
    throw error;
  }
  const completed = {
    ...loaded.record,
    completedAt: new Date().toISOString(),
    resultTitle: metadata.title || loaded.record.title,
    status: "succeeded",
    url: metadata.url,
  };
  try {
    const saved = await saveIntegrationRecord(env, githubToken, loaded.record.path, completed, loaded.sha, "feishu: record created document URL");
    return feishuCreateResponse(saved.record, false);
  } catch (error) {
    if (!isRepositoryConflict(error)) throw error;
    const current = await loadFeishuCreateRequest(env, githubToken, {
      id: loaded.record.id,
      path: loaded.record.path,
    });
    if (current?.record?.status === "succeeded") return feishuCreateResponse(current.record, true);
    throw new HttpError(409, "The document result is being finalized. Retry shortly.", "feishu_create_in_progress");
  }
}

async function createFeishuDocument(env, githubToken, input) {
  requireFeishuConfiguration(env);
  const candidate = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const title = normalizeFeishuTitle(candidate.title);
  const key = normalizeIdempotencyKey(candidate.idempotency_key);
  const requestIdentity = await feishuRequestIdentity(key);
  let existing = await loadFeishuCreateRequest(env, githubToken, requestIdentity);
  if (existing) {
    if (existing.record.title !== title) {
      throw new HttpError(409, "That idempotency key is already bound to another document title.", "idempotency_key_reused");
    }
    if (existing.record.status === "succeeded") return feishuCreateResponse(existing.record, true);
    if (existing.record.status === "created") {
      const auth = await acquireFreshFeishuAccessToken(env, githubToken);
      return finishFeishuDocumentRequest(env, githubToken, auth.accessToken, existing);
    }
    if (existing.record.status === "failed") {
      throw new HttpError(409, "That document request was rejected earlier. Start a new request to retry.", "feishu_create_rejected");
    }
    if (existing.record.status === "unknown") {
      throw feishuCreateOutcomeUnknownError();
    }
    throw new HttpError(409, "Document creation already started; its outcome must be reconciled before retrying.", "feishu_create_in_progress");
  }

  const auth = await acquireFreshFeishuAccessToken(env, githubToken);
  const pending = {
    createdAt: new Date().toISOString(),
    id: requestIdentity.id,
    keyHash: requestIdentity.hash,
    path: requestIdentity.path,
    status: "pending",
    title,
    version: 1,
  };
  try {
    existing = await saveIntegrationRecord(env, githubToken, requestIdentity.path, pending, "", "feishu: reserve idempotent document request");
  } catch (error) {
    if (!isRepositoryConflict(error)) throw error;
    throw new HttpError(409, "Document creation already started. Retry shortly.", "feishu_create_in_progress");
  }

  let createdPayload;
  try {
    const body = { title };
    const folderToken = String(env.FEISHU_FOLDER_TOKEN || "").trim();
    if (folderToken) body.folder_token = folderToken;
    createdPayload = await feishuJsonRequest(env, "/open-apis/docx/v1/documents", {
      accessToken: auth.accessToken,
      body,
      method: "POST",
    });
  } catch (error) {
    if (feishuErrorRequiresReconnect(error)) {
      await markFeishuReauthorizationRequired(env, githubToken);
      const rejectedForAuthorization = {
        ...existing.record,
        failedAt: new Date().toISOString(),
        failure: "authorization",
        status: "failed",
      };
      try {
        await saveIntegrationRecord(
          env,
          githubToken,
          requestIdentity.path,
          rejectedForAuthorization,
          existing.sha,
          "feishu: record authorization-rejected document request"
        );
      } catch (_saveError) {
        // The upstream authorization rejection happened before document
        // creation, so a fresh request key is safe after the owner reconnects.
      }
      throw feishuReauthorizationError();
    }
    const unknown = feishuCreateOutcomeIsUnknown(error);
    const terminal = {
      ...existing.record,
      ...(unknown ? { unknownAt: new Date().toISOString() } : { failedAt: new Date().toISOString() }),
      status: unknown ? "unknown" : "failed",
    };
    try {
      await saveIntegrationRecord(
        env,
        githubToken,
        requestIdentity.path,
        terminal,
        existing.sha,
        unknown ? "feishu: record unknown document outcome" : "feishu: record rejected document request"
      );
    } catch (_saveError) {
      // Keeping a pending record is safer than risking a duplicate document.
    }
    if (unknown) throw feishuCreateOutcomeUnknownError();
    throw new HttpError(Number(error.status) || 502, error.message, "feishu_create_rejected");
  }

  const document = createdPayload.data?.document;
  const documentToken = String(document?.document_id || "");
  if (!documentToken) {
    const unknown = {
      ...existing.record,
      unknownAt: new Date().toISOString(),
      status: "unknown",
    };
    try {
      await saveIntegrationRecord(env, githubToken, requestIdentity.path, unknown, existing.sha, "feishu: record missing document identifier");
    } catch (_saveError) {
      // Keeping the request reserved is safer than creating another document.
    }
    throw feishuCreateOutcomeUnknownError();
  }
  const created = {
    ...existing.record,
    documentToken,
    resultTitle: String(document?.title || title).slice(0, 800),
    status: "created",
  };
  try {
    existing = await saveIntegrationRecord(env, githubToken, requestIdentity.path, created, existing.sha, "feishu: record created document token");
  } catch (_error) {
    const current = await loadFeishuCreateRequest(env, githubToken, requestIdentity).catch(() => null);
    if (current?.record?.status === "succeeded") return feishuCreateResponse(current.record, true);
    if (current?.record?.status === "created") return finishFeishuDocumentRequest(env, githubToken, auth.accessToken, current);
    if (current?.record?.status === "pending") {
      try {
        existing = await saveIntegrationRecord(
          env,
          githubToken,
          requestIdentity.path,
          { ...current.record, documentToken, resultTitle: created.resultTitle, status: "created" },
          current.sha,
          "feishu: recover created document token"
        );
      } catch (_recoveryError) {
        throw feishuCreateOutcomeUnknownError();
      }
    } else {
      throw feishuCreateOutcomeUnknownError();
    }
  }
  return finishFeishuDocumentRequest(env, githubToken, auth.accessToken, existing);
}

async function feishuSessionStatus(env, githubToken) {
  const configuration = feishuConfiguration(env);
  if (!configuration.configured) return { configured: false, connected: false, missing: configuration.missing };
  const connection = await loadFeishuConnection(env, githubToken, true);
  if (!connection || !feishuConnectionUsable(connection.record)) {
    return { configured: true, connected: false };
  }
  return { configured: true, connected: true, user: publicFeishuIdentity(connection.record.identity) };
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
  } else if (parts.length === 2 && parts[0] === "feishu" && parts[1] === "session" && request.method === "GET") {
    payload = await feishuSessionStatus(env, auth.accessToken);
  } else if (parts.length === 3 && parts[0] === "feishu" && parts[1] === "oauth" && parts[2] === "start" && request.method === "POST") {
    payload = await handleFeishuOAuthStart(request, env, auth);
  } else if (parts.length === 2 && parts[0] === "feishu" && parts[1] === "documents" && request.method === "GET") {
    payload = { documents: await listFeishuDocuments(env, auth.accessToken) };
  } else if (parts.length === 2 && parts[0] === "feishu" && parts[1] === "documents" && request.method === "POST") {
    payload = await createFeishuDocument(env, auth.accessToken, await readJson(request));
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
  if (request.method === "GET" && url.pathname === "/auth/feishu/callback") return handleFeishuCallback(request, env);
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
