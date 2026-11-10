import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonWebKey } from "node:crypto";
import { createLeaderboardServer } from "./app.ts";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const issuer = required("COMMUNITY_URL").replace(/\/$/, "");
const audience = required("API_ORIGIN");
for (const value of [issuer, audience]) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) throw new Error("Use fixed HTTPS origins on port 443");
}
if (new URL(audience).origin !== audience) throw new Error("API_ORIGIN must be an origin without a path/trailing slash");
const channel = process.env.APP_CHANNEL ?? "sandbox";
if (channel !== "sandbox" && channel !== "production") throw new Error("Invalid APP_CHANNEL");
let publicKey: JsonWebKey | undefined;
let keyFetched = 0;
let pending: Promise<void> | undefined;
async function refreshKey() {
  const response = await fetch(`${issuer}/mini-app-api/jwks`, { redirect: "error", signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("JWKS unavailable");
  const body = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const key = body.keys?.length === 1 ? body.keys[0] : undefined;
  if (!key || key.kty !== "EC" || key.crv !== "P-256" || key.alg !== "ES256" || key.use !== "sig" || !key.kid || !key.x || !key.y || Object.hasOwn(key, "d")) throw new Error("Invalid trusted JWKS");
  publicKey = key;
  keyFetched = Date.now();
}
async function getPublicKey() {
  if (!publicKey || Date.now() - keyFetched > 15 * 60_000) throw new Error("Trusted key unavailable");
  return publicKey;
}
await refreshKey();
const refresh = setInterval(() => {
  if (!pending) pending = refreshKey().catch(() => console.warn("JWKS refresh failed")).finally(() => { pending = undefined; });
}, 60_000);
const dbPath = process.env.DATABASE_PATH ?? `./data/leaderboard-${channel}.sqlite`;
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
const server = Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 8787), maxRequestBodySize: 4096, idleTimeout: 10,
  fetch: createLeaderboardServer({ issuer, audience, appId: required("APP_ID"), channel, database: db, getPublicKey }),
});
console.log(`Leaderboard ${channel} listening on ${server.hostname}:${server.port}`);
process.on("SIGTERM", () => { clearInterval(refresh); server.stop(true); db.close(); process.exit(0); });
