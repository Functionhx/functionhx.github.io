// Letter Mailer：首页「一封信」彩蛋的发信服务。
//
// 访客在信封页面填写邮箱并提交暗号，本服务核对暗号后，用站长的 Gmail
// 把六位密码发到这个邮箱。它只做这一件事，与 Spark Vault 分开部署。
//
// 防滥用：只接受站点来源的请求；暗号不对不发；按 IP 与全站每天限量；
// 收件人地址严格校验（拒绝换行，防止邮件头注入）；邮件正文是固定模板。
// 隐私：不记录收件人地址。暗号、密码与 Gmail 凭据都放在 Worker 密钥里，不进仓库。

const MAX_BODY_BYTES = 2048;
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT_MS = 15000;

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function siteOrigins(env) {
  return String(env.SITE_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return siteOrigins(env).includes(origin) ? origin : "";
}

function json(status, body, origin) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

// 与浏览器端解锁时的规范化一致：全角转半角、去空白、统一小写。
export function normalizePhrase(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

// 先各自取摘要再逐字节比较，比较时间与输入内容无关。
async function phraseMatches(candidate, expected) {
  const [left, right] = await Promise.all([digest(normalizePhrase(candidate)), digest(normalizePhrase(expected))]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0 && normalizePhrase(expected).length > 0;
}

// 只接受普通邮箱地址：单个地址、无空白与控制字符、长度受限。
export function validRecipient(value) {
  const address = String(value || "").trim();
  if (address.length < 6 || address.length > 254) return "";
  if (/[\s<>"(),;:\\\[\]\u0000-\u001f\u007f]/.test(address)) return "";
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(address)) return "";
  return address;
}

function clientAddress(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// 用 KV 记每天的次数。KV 是最终一致的，所以这是「大致」上限，足够挡住滥用。
async function consume(env, key, limit) {
  if (!env.LETTER_LIMITS) throw new HttpError(503, "Rate limiting is not configured.", "limits_missing");
  const current = Number((await env.LETTER_LIMITS.get(key)) || 0);
  if (current >= limit) return false;
  await env.LETTER_LIMITS.put(key, String(current + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
}

async function readBody(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send JSON.", "unsupported_media_type");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large.", "too_large");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error("not an object");
    return value;
  } catch {
    throw new HttpError(400, "Invalid JSON.", "invalid_json");
  }
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodedWord(value) {
  return `=?UTF-8?B?${base64Utf8(value)}?=`;
}

export function composeMessage({ from, to, pin, date = new Date(), messageId }) {
  const body = [
    "你好，",
    "",
    "有人（也许就是你）在 Function 的主页上找到了一封上了锁的信。",
    "",
    `打开它的密码是：${pin}`,
    "",
    "回到那个页面，输入这六位数字就能拆信。",
    "",
    "—— ƒ",
  ].join("\r\n");
  const encodedBody = base64Utf8(body).replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${encodedWord("Function")} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodedWord("一封信的密码")}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ].join("\r\n");
}

// 最小的 SMTP 客户端：隐式 TLS（465），AUTH PLAIN，一封信。
export async function sendMail(connect, { username, password, to, message }) {
  const socket = connect({ hostname: SMTP_HOST, port: SMTP_PORT }, { secureTransport: "on", allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timeout = setTimeout(() => socket.close?.(), SMTP_TIMEOUT_MS);

  async function readReply() {
    // 多行回复形如 "250-..."，最后一行是 "250 ..."。
    for (;;) {
      const lines = buffer.split("\r\n");
      for (let index = 0; index < lines.length - 1; index += 1) {
        if (/^\d{3} /.test(lines[index])) {
          const code = Number(lines[index].slice(0, 3));
          buffer = lines.slice(index + 1).join("\r\n");
          return code;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP connection closed");
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function command(line, expected) {
    if (line !== null) await writer.write(new TextEncoder().encode(`${line}\r\n`));
    const code = await readReply();
    if (!expected.includes(code)) throw new Error(`SMTP ${code}`);
    return code;
  }

  try {
    await command(null, [220]);
    await command("EHLO functionhx.github.io", [250]);
    await command(`AUTH PLAIN ${base64Utf8(`\u0000${username}\u0000${password}`)}`, [235]);
    await command(`MAIL FROM:<${username}>`, [250]);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", [354]);
    // 行首的 "." 需要转义（dot-stuffing），再以单独一行 "." 结束。
    const stuffed = message.replace(/\r\n\./g, "\r\n..");
    await command(`${stuffed}\r\n.`, [250]);
    await command("QUIT", [221]).catch(() => undefined);
  } finally {
    clearTimeout(timeout);
    try {
      await writer.close();
    } catch {
      /* already closed */
    }
    socket.close?.();
  }
}

export async function handleRequest(request, env, { connect } = {}) {
  const origin = allowedOrigin(request, env);
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    if (!origin) return json(403, { error: "origin_denied" });
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }

  if (url.pathname === "/health") return json(200, { ok: true }, origin);
  if (url.pathname !== "/send-pin") return json(404, { error: "not_found" }, origin);

  try {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.", "method_not_allowed");
    if (!origin) throw new HttpError(403, "This origin is not allowed.", "origin_denied");
    for (const name of ["LETTER_PHRASE", "LETTER_PIN", "GMAIL_ADDRESS", "GMAIL_APP_PASSWORD"]) {
      if (!env[name]) throw new HttpError(503, "The letter mailer is not configured yet.", "not_configured");
    }
    if (!/^\d{6}$/.test(String(env.LETTER_PIN))) throw new HttpError(503, "The letter PIN must be 6 digits.", "not_configured");

    const body = await readBody(request);
    const ip = clientAddress(request);
    const day = today();
    const perIpLimit = Number(env.PER_IP_DAILY_LIMIT || 3);
    const siteLimit = Number(env.DAILY_LIMIT || 20);

    // 猜暗号也要限量，避免把这里当成暗号的在线爆破口。
    if (!(await consume(env, `attempt:${day}:${ip}`, perIpLimit * 5))) {
      throw new HttpError(429, "Too many attempts today.", "rate_limited");
    }
    if (!(await phraseMatches(body.phrase, env.LETTER_PHRASE))) {
      throw new HttpError(403, "The phrase is not right.", "wrong_phrase");
    }
    const to = validRecipient(body.email);
    if (!to) throw new HttpError(400, "That email address does not look right.", "invalid_email");
    if (!(await consume(env, `sent:${day}:${ip}`, perIpLimit))) {
      throw new HttpError(429, "Too many emails today.", "rate_limited");
    }
    if (!(await consume(env, `sent:${day}:site`, siteLimit))) {
      throw new HttpError(429, "Too many emails today.", "rate_limited");
    }

    const socketConnect = connect || (await import("cloudflare:sockets")).connect;
    const message = composeMessage({
      from: env.GMAIL_ADDRESS,
      to,
      pin: String(env.LETTER_PIN),
      messageId: `${crypto.randomUUID()}@functionhx.github.io`,
    });
    try {
      await sendMail(socketConnect, {
        username: env.GMAIL_ADDRESS,
        password: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ""),
        to,
        message,
      });
    } catch (error) {
      // 只记录失败类型，不记录收件人。
      console.error("letter-mailer: send failed", error?.message || "unknown");
      throw new HttpError(502, "The email could not be sent right now.", "send_failed");
    }
    return json(200, { ok: true }, origin);
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.code }, origin);
    console.error("letter-mailer: unexpected error", error?.message || "unknown");
    return json(500, { error: "internal_error" }, origin);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
