import assert from "node:assert/strict";

import { createSparkVaultServer } from "../spark-vault/server.mjs";

const siteOrigin = "https://functionhx.github.io";
const mirrorOrigin = "https://fanyuchen.com.cn";
const env = {
  ALLOWED_GITHUB_USER_ID: "172989722",
  GITHUB_CLIENT_ID: "Iv1.spark-vault-test",
  GITHUB_CLIENT_SECRET: "not-a-real-client-secret",
  MASTER_KEY_B64: Buffer.alloc(32, 29).toString("base64url"),
  PRIVATE_REPO: "Functionhx/functionhx-spark-private",
  PUBLIC_REPO: "Functionhx/functionhx.github.io",
  SESSION_KEY_B64: Buffer.alloc(32, 17).toString("base64url"),
  SITE_ORIGINS: `${siteOrigin},${mirrorOrigin}`,
  WORKER_ORIGIN: "https://vault.fanyuchen.com.cn",
};

const { server } = createSparkVaultServer({ env, maximumBodyBytes: 100, port: 8787 });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), siteOrigin);
  assert.deepEqual(await health.json(), { ok: true, service: "functionhx-spark-vault", version: 1 });

  const preflight = await fetch(`${origin}/api/notes`, {
    headers: { Origin: siteOrigin },
    method: "OPTIONS",
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), siteOrigin);

  const mirrorPreflight = await fetch(`${origin}/api/notes`, {
    headers: { Origin: mirrorOrigin },
    method: "OPTIONS",
  });
  assert.equal(mirrorPreflight.status, 204);
  assert.equal(mirrorPreflight.headers.get("access-control-allow-origin"), mirrorOrigin);

  const oversized = await fetch(`${origin}/api/notes/too-large`, {
    body: JSON.stringify({ content: "x".repeat(101) }),
    headers: { "Content-Type": "application/json", Origin: siteOrigin },
    method: "PUT",
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "request_too_large");
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

console.log("Spark Vault Node adapter checks passed.");
