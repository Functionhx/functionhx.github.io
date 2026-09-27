import assert from "node:assert/strict";
import { composeMessage, handleRequest, normalizePhrase, validRecipient } from "../letter-mailer/worker.mjs";

const ORIGIN = "https://functionhx.github.io";

function memoryKv() {
  const store = new Map();
  return { get: async (key) => store.get(key) ?? null, put: async (key, value) => void store.set(key, value) };
}

function configuredEnv(overrides = {}) {
  return {
    SITE_ORIGINS: "https://functionhx.github.io,https://fanyuchen.com.cn",
    PER_IP_DAILY_LIMIT: "3",
    DAILY_LIMIT: "20",
    LETTER_LIMITS: memoryKv(),
    LETTER_PHRASE: "口令",
    LETTER_PIN: "135790",
    GMAIL_ADDRESS: "owner@example.com",
    GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
    ...overrides,
  };
}

// 假的 Gmail SMTP：按顺序回应命令，并记下收到的全部内容。
function fakeSmtp({ authCode = 235 } = {}) {
  const transcript = [];
  let sessions = 0;
  const connect = () => {
    sessions += 1;
    const encoder = new TextEncoder();
    let controller;
    let inData = false;
    let pending = "";
    const readable = new ReadableStream({
      start(value) {
        controller = value;
        controller.enqueue(encoder.encode("220 fake.gmail ready\r\n"));
      },
    });
    const reply = (text) => controller.enqueue(encoder.encode(`${text}\r\n`));
    const writable = new WritableStream({
      write(chunk) {
        pending += new TextDecoder().decode(chunk);
        let index;
        while ((index = pending.indexOf("\r\n")) >= 0) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 2);
          transcript.push(line);
          if (inData) {
            if (line === ".") {
              inData = false;
              reply("250 queued");
            }
            continue;
          }
          if (line.startsWith("EHLO")) reply("250-fake.gmail\r\n250 AUTH PLAIN LOGIN");
          else if (line.startsWith("AUTH PLAIN")) reply(authCode === 235 ? "235 accepted" : `${authCode} bad credentials`);
          else if (line.startsWith("MAIL FROM")) reply("250 ok");
          else if (line.startsWith("RCPT TO")) reply("250 ok");
          else if (line === "DATA") {
            inData = true;
            reply("354 go ahead");
          } else if (line === "QUIT") reply("221 bye");
        }
      },
    });
    return { readable, writable, close() {} };
  };
  return { connect, transcript, sessions: () => sessions };
}

function post(body, { origin = ORIGIN, ip = "203.0.113.7" } = {}) {
  return new Request("https://functionhx-letter.example.workers.dev/send-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}

async function call(request, env, smtp = fakeSmtp()) {
  const response = await handleRequest(request, env, { connect: smtp.connect });
  return { status: response.status, body: await response.json().catch(() => null), response };
}

// 暗号规范化与收件人校验
assert.equal(normalizePhrase(" 口 令 "), "口令");
assert.equal(normalizePhrase("ＭｏＯｎ"), "moon");
assert.equal(validRecipient("her@qq.com"), "her@qq.com");
assert.equal(validRecipient("her@qq.com\r\nBcc: spam@example.com"), "", "header injection must be rejected");
assert.equal(validRecipient("a@b.com, c@d.com"), "", "only one recipient is allowed");
assert.equal(validRecipient("<a@b.com>"), "");

// 预检：只放行站点来源
let preflight = await handleRequest(new Request("https://x/send-pin", { method: "OPTIONS", headers: { Origin: ORIGIN } }), configuredEnv());
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
preflight = await handleRequest(
  new Request("https://x/send-pin", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
  configuredEnv()
);
assert.equal(preflight.status, 403);

// 来源不对、没配置、暗号不对，都不发信
let smtp = fakeSmtp();
let result = await call(post({ phrase: "口令", email: "her@qq.com" }, { origin: "https://evil.example" }), configuredEnv(), smtp);
assert.equal(result.status, 403);
assert.equal(result.body.error, "origin_denied");
result = await call(post({ phrase: "口令", email: "her@qq.com" }), configuredEnv({ GMAIL_APP_PASSWORD: "" }), smtp);
assert.equal(result.status, 503);
result = await call(post({ phrase: "太阳", email: "her@qq.com" }), configuredEnv(), smtp);
assert.equal(result.status, 403);
assert.equal(result.body.error, "wrong_phrase");
result = await call(post({ phrase: "口令", email: "her@qq.com\r\nBcc: spam@example.com" }), configuredEnv(), smtp);
assert.equal(result.status, 400);
assert.equal(smtp.sessions(), 0, "no SMTP session may open before every check passes");

// 成功：认证、收件人和正文都正确，暗号允许空格与全角差异
smtp = fakeSmtp();
const env = configuredEnv();
result = await call(post({ phrase: " 口 令 ", email: "her@qq.com" }), env, smtp);
assert.equal(result.status, 200, JSON.stringify(result.body));
assert.equal(result.response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
const auth = smtp.transcript.find((line) => line.startsWith("AUTH PLAIN "));
assert.equal(Buffer.from(auth.slice(11), "base64").toString(), "\u0000owner@example.com\u0000abcdefghijklmnop", "app password spaces are stripped");
assert.ok(smtp.transcript.includes("RCPT TO:<her@qq.com>"));
const dataStart = smtp.transcript.indexOf("DATA");
const bodyLines = smtp.transcript.slice(dataStart + 1, smtp.transcript.indexOf(".", dataStart));
const blank = bodyLines.indexOf("");
const decoded = Buffer.from(bodyLines.slice(blank + 1).join(""), "base64").toString("utf8");
assert.ok(decoded.includes("135790"), "the email must contain the PIN");
assert.ok(bodyLines.some((line) => line === "To: <her@qq.com>"));

// 同一 IP 每天最多 3 封
await call(post({ phrase: "口令", email: "her@qq.com" }), env, fakeSmtp());
await call(post({ phrase: "口令", email: "her@qq.com" }), env, fakeSmtp());
result = await call(post({ phrase: "口令", email: "her@qq.com" }), env, fakeSmtp());
assert.equal(result.status, 429, "the fourth email from one IP must be refused");

// 猜暗号也限量：同一 IP 每天最多 15 次尝试
const guessEnv = configuredEnv();
for (let attempt = 0; attempt < 15; attempt += 1) {
  await call(post({ phrase: `猜${attempt}`, email: "her@qq.com" }, { ip: "198.51.100.9" }), guessEnv);
}
result = await call(post({ phrase: "口令", email: "her@qq.com" }, { ip: "198.51.100.9" }), guessEnv);
assert.equal(result.status, 429, "phrase guessing must be rate limited");

// Gmail 拒绝认证时返回 502，且响应里不带收件人
result = await call(post({ phrase: "口令", email: "her@qq.com" }, { ip: "192.0.2.1" }), configuredEnv(), fakeSmtp({ authCode: 535 }));
assert.equal(result.status, 502);
assert.equal(result.body.error, "send_failed");
assert.ok(!JSON.stringify(result.body).includes("her@qq.com"));

// 邮件头只含固定内容
const message = composeMessage({ from: "owner@example.com", to: "her@qq.com", pin: "135790", messageId: "id@functionhx.github.io" });
assert.ok(message.startsWith("From: =?UTF-8?B?"));
assert.ok(message.includes("Content-Transfer-Encoding: base64"));

console.log("Letter mailer checks passed: origin allowlist, phrase check, header-injection guard, rate limits, SMTP flow.");
