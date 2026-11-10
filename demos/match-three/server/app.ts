import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { JsonWebKey } from "node:crypto";
import { verifyPlatformRequest } from "@discourse-mini-app/sdk/server";
import type { PlatformIdentity } from "@discourse-mini-app/sdk/server";
import { LEVELS } from "../src/levels.ts";
import { RULES_VERSION, replayRun } from "../src/ranked.ts";
import type { LeaderboardData, LeaderboardEntry, RankedRun } from "../src/ranked.ts";

export interface ServerConfig {
  issuer: string;
  audience: string;
  appId: string;
  channel: "sandbox" | "production";
  database: Database;
  getPublicKey: () => Promise<JsonWebKey>;
  now?: () => number;
}

class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
interface RunRow { id: string; user_id: string; seed: number; level: number; completed: number; expires: number; digest: string | null; result: string | null }

export function createLeaderboardServer(config: ServerConfig) {
  if (!["sandbox", "production"].includes(config.channel)) throw new Error("Invalid channel");
  const db = config.database;
  const now = config.now ?? Date.now;
  const scope = JSON.stringify([config.issuer, config.appId, config.channel, RULES_VERSION]);
  const forumOrigin = new URL(config.issuer).origin;
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS bests (scope TEXT NOT NULL,user_id TEXT NOT NULL,level INTEGER NOT NULL,score INTEGER NOT NULL,
      PRIMARY KEY(scope,user_id,level));
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,scope TEXT NOT NULL,user_id TEXT NOT NULL,seed INTEGER NOT NULL,
      level INTEGER NOT NULL,completed INTEGER NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL,digest TEXT,result TEXT);
    CREATE INDEX IF NOT EXISTS runs_owner ON runs(scope,user_id,created);
    CREATE TABLE IF NOT EXISTS throttles (scope TEXT NOT NULL,user_id TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,
      PRIMARY KEY(scope,user_id));`);
  const rankSql = `WITH totals AS (SELECT user_id,COUNT(*) AS completed,SUM(score) AS score FROM bests WHERE scope=? GROUP BY user_id),
    ranked AS (SELECT ROW_NUMBER() OVER (ORDER BY completed DESC,score DESC,user_id ASC) AS rank,user_id AS userId,completed,score FROM totals)`;
  function leaderboard(userId: string): LeaderboardData {
    return {
      channel: config.channel, rules: RULES_VERSION,
      entries: db.query(`${rankSql} SELECT * FROM ranked ORDER BY rank LIMIT 50`).all(scope) as LeaderboardEntry[],
      me: db.query(`${rankSql} SELECT * FROM ranked WHERE userId=?`).get(scope, userId) as LeaderboardEntry | null,
    };
  }
  function completed(userId: string): number {
    return (db.query("SELECT COUNT(*) AS n FROM bests WHERE scope=? AND user_id=?").get(scope, userId) as { n: number }).n;
  }
  function throttle(userId: string) {
    const bucket = Math.floor(now() / 60_000);
    db.query(`INSERT INTO throttles VALUES (?,?,?,1) ON CONFLICT(scope,user_id) DO UPDATE SET bucket=excluded.bucket,
      count=CASE WHEN throttles.bucket=excluded.bucket THEN throttles.count+1 ELSE 1 END`).run(scope, userId, bucket);
    const row = db.query("SELECT count FROM throttles WHERE scope=? AND user_id=?").get(scope, userId) as { count: number };
    if (row.count > 45) throw new HttpError(429, "RATE_LIMIT");
    db.query("DELETE FROM throttles WHERE bucket<?").run(bucket - 2);
  }
  async function body(request: Request) {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "JSON_REQUIRED");
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "INVALID_BODY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4096) { await reader.cancel(); throw new HttpError(413, "BODY_TOO_LARGE"); }
        chunks.push(chunk.value);
      }
      const bytes = Buffer.concat(chunks);
      const result: unknown = JSON.parse(bytes.toString("utf8"));
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
      return result as Record<string, unknown>;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "INVALID_BODY");
    }
  }
  const start = db.transaction((userId: string, requested: unknown) => {
    const time = now();
    db.query("DELETE FROM runs WHERE expires<?").run(time - 86_400_000);
    const last = db.query("SELECT MAX(created) AS time FROM runs WHERE scope=? AND user_id=?").get(scope, userId) as { time: number | null };
    if (last.time !== null && time - last.time < 3000) throw new HttpError(429, "START_TOO_FAST");
    const cleared = completed(userId);
    const level = requested ?? Math.min(cleared + 1, LEVELS.length);
    if (!Number.isInteger(level) || Number(level) < 1 || Number(level) > LEVELS.length || Number(level) > cleared + 1) throw new HttpError(409, "LEVEL_LOCKED");
    // An abandoned session cannot later replace a newer attempt's result.
    db.query("DELETE FROM runs WHERE scope=? AND user_id=? AND digest IS NULL").run(scope, userId);
    const run: RankedRun = { id: randomUUID(), seed: randomBytes(4).readUInt32LE(), level: Number(level), completed: cleared, expires: time + 2 * 60 * 60_000, rules: RULES_VERSION };
    db.query("INSERT INTO runs (id,scope,user_id,seed,level,completed,expires,created) VALUES (?,?,?,?,?,?,?,?)")
      .run(run.id, scope, userId, run.seed, run.level, cleared, run.expires, time);
    return run;
  });
  const finish = db.transaction((userId: string, input: Record<string, unknown>) => {
    if (typeof input.runId !== "string" || input.runId.length > 64) throw new HttpError(400, "INVALID_RUN");
    const row = db.query("SELECT * FROM runs WHERE id=? AND scope=? AND user_id=?").get(input.runId, scope, userId) as RunRow | null;
    if (!row) throw new HttpError(404, "RUN_NOT_FOUND");
    const digest = createHash("sha256").update(JSON.stringify(input.actions) ?? "").digest("hex");
    // Retry after a lost response must be safe, including after the session's expiry.
    if (row.digest) {
      if (row.digest !== digest) throw new HttpError(409, "RUN_ALREADY_SUBMITTED");
      return JSON.parse(row.result!);
    }
    if (row.expires < now()) throw new HttpError(410, "RUN_EXPIRED");
    const run = { id: row.id, seed: row.seed, level: row.level, completed: row.completed, expires: row.expires, rules: RULES_VERSION };
    let replay;
    try { replay = replayRun(run, input.actions); } catch { throw new HttpError(400, "INVALID_ACTIONS"); }
    if (!replay.game.won) throw new HttpError(409, "LEVEL_NOT_COMPLETED");
    const score = replay.game.score;
    db.query(`INSERT INTO bests VALUES (?,?,?,?) ON CONFLICT(scope,user_id,level) DO UPDATE SET score=MAX(bests.score,excluded.score)`)
      .run(scope, userId, row.level, score);
    const result = { accepted: true, score, level: row.level, leaderboard: leaderboard(userId) };
    db.query("UPDATE runs SET digest=?,result=? WHERE id=?").run(digest, JSON.stringify(result), row.id);
    return result;
  });
  return async function handle(request: Request): Promise<Response> {
    const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" });
    const origin = request.headers.get("origin");
    if (origin === forumOrigin) headers.set("Access-Control-Allow-Origin", forumOrigin);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
    try {
      if (origin && origin !== forumOrigin) throw new HttpError(403, "ORIGIN_DENIED");
      const url = new URL(request.url);
      if (!["/v1/leaderboard", "/v1/runs", "/v1/results"].includes(url.pathname) || url.search) throw new HttpError(404, "NOT_FOUND");
      const method = url.pathname === "/v1/leaderboard" ? "GET" : "POST";
      if (request.method === "OPTIONS") {
        headers.set("Access-Control-Allow-Methods", `${method}, OPTIONS`);
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== method) throw new HttpError(405, "METHOD_NOT_ALLOWED");
      let identity: PlatformIdentity;
      try {
        identity = await verifyPlatformRequest({
          publicKey: await config.getPublicKey(), issuer: config.issuer, audience: config.audience, appId: config.appId,
          channel: config.channel, scope: "network.request", method, url: config.audience + url.pathname,
          authorization: request.headers.get("authorization") ?? "", now: Math.floor(now() / 1000),
        });
      } catch { throw new HttpError(401, "AUTH_REQUIRED"); }
      throttle(identity.sub);
      if (method === "GET") return json(leaderboard(identity.sub));
      const input = await body(request);
      return json(url.pathname === "/v1/runs" ? start(identity.sub, input.level) : finish(identity.sub, input));
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      // Never include request headers, tokens, payloads or database details in public errors.
      return json({ error: "SERVER_ERROR" }, 500);
    }
  };
}
