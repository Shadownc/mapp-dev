import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createLeaderboardServer } from "../server/app.ts";
import { replayRun } from "../src/ranked.ts";
import type { Action, RankedRun } from "../src/ranked.ts";
import { activateSpecial, areAdjacent, findMatchGroups, findMatches, move, specialTargets, createBoard, hasMoves } from "../src/engine.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getLevel } from "../src/levels.ts";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const kid = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
const issuer = "https://forum.example.com", audience = "https://scores.example.com";
const appId = "01a1c353-5aa1-7bb8-9c4d-78f610ed9c70";
function harness() {
  const db = new Database(":memory:");
  let time = 1_800_000_000_000;
  const config = { issuer, audience, appId, database: db, getPublicKey: async () => publicKey.export({ format: "jwk" }), now: () => time };
  const sandbox = createLeaderboardServer({ ...config, channel: "sandbox" });
  const production = createLeaderboardServer({ ...config, channel: "production" });
  async function request(path: string, value?: unknown, user = "1", channel: "sandbox" | "production" = "sandbox", overrides: Record<string, unknown> = {}) {
    const method = value === undefined ? "GET" : "POST", seconds = Math.floor(time / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "mini-app-access+jwt", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: audience, app_id: appId, sub: user, channel, version: "1.1.0",
      scopes: ["network.request"], iat: seconds, nbf: seconds, exp: seconds + 900, jti: "test-token-id-12345678",
      htm: method, htu: audience + path, query_keys: [], ...overrides })).toString("base64url");
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const result = await (channel === "sandbox" ? sandbox : production)(new Request(audience + path, {
      method, headers: { Authorization: `Bearer ${header}.${payload}.${signature}`, Origin: issuer, "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    }));
    return { status: result.status, body: await result.json() as any, headers: result.headers };
  }
  return { db, sandbox, request, advance: (ms = 60_000) => { time += ms; } };
}

function solve(run: RankedRun) {
  const { game, random } = replayRun(run, []);
  const actions: Action[] = [];
  while (!game.won && !game.over) {
    const candidates: Array<{ action: Action; weight: number }> = [];
    function weight(board: number[], specials: typeof game.specials, initial: number[]) {
      const affected = new Set(initial);
      for (const index of affected) if (specials[index]) for (const other of specialTargets(index, specials[index]!)) affected.add(other);
      const counts = Array<number>(6).fill(0);
      for (const index of affected) counts[board[index]]++;
      const target = getLevel(run.level).targets.reduce((sum, { color, count }) => sum + Math.min(Math.max(0, count - game.collected[color]), counts[color]), 0);
      return target * 5 + affected.size + findMatchGroups(board).filter((group) => group.length >= 4).length * 7;
    }
    for (let i = 0; i < 64; i++) {
      if (game.specials[i]) candidates.push({ action: [i], weight: weight(game.board, game.specials, [i]) });
      for (const j of [i + 1, i + 8]) {
        if (!areAdjacent(i, j)) continue;
        const board = [...game.board], specials = [...game.specials];
        [board[i], board[j]] = [board[j], board[i]]; [specials[i], specials[j]] = [specials[j], specials[i]];
        const affected = [...findMatches(board), ...[i, j].filter((index) => specials[index])];
        if (affected.length) candidates.push({ action: [i, j], weight: weight(board, specials, affected) });
      }
    }
    const action = candidates.sort((a, b) => b.weight - a.weight)[0].action;
    if (action.length === 1) activateSpecial(game, action[0], random); else move(game, action[0], action[1], random);
    actions.push(action);
  }
  return { actions, game };
}

async function winningRun(h: ReturnType<typeof harness>, user = "1", level = 1) {
  // Fixed seeds are injected only into the test database.
  for (let seed = 1; seed < 50; seed++) {
    h.advance();
    const response = await h.request("/v1/runs", { level }, user);
    expect(response.status).toBe(200);
    const run = { ...response.body, seed } as RankedRun;
    const solution = solve(run);
    if (!solution.game.won) continue;
    h.db.query("UPDATE runs SET seed=? WHERE id=?").run(seed, run.id);
    return { run, ...solution };
  }
  throw new Error("No winning test fixture");
}

describe("community leaderboard", () => {
  test("missing and mismatched credentials fail with CORS; cookies cannot authenticate", async () => {
    const h = harness();
    const missing = await h.sandbox(new Request(audience + "/v1/leaderboard", { headers: { Origin: issuer, Cookie: "logged_in=yes" } }));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("access-control-allow-origin")).toBe(issuer);
    for (const overrides of [{ app_id: "other" }, { channel: "production" }, { htu: audience + "/v1/results" }, { sub: "0" }, { exp: 1 }]) {
      expect((await h.request("/v1/leaderboard", undefined, "1", "sandbox", overrides)).status).toBe(401);
    }
    h.db.close();
  });
  test("OPTIONS allows only the configured forum without requiring a token", async () => {
    const h = harness();
    const preflight = await h.sandbox(new Request(audience + "/v1/runs", { method: "OPTIONS", headers: { Origin: issuer } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
    const denied = await h.sandbox(new Request(audience + "/v1/runs", { method: "OPTIONS", headers: { Origin: "https://other.example" } }));
    expect(denied.status).toBe(403);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
    h.db.close();
  });
  test("server-computed score ignores supplied score/identity and retries are idempotent", async () => {
    const h = harness();
    const { run, actions, game } = await winningRun(h);
    const body = { runId: run.id, actions, score: 999999, user_id: "999", completed: 7 };
    const result = await h.request("/v1/results", body);
    expect(result.status).toBe(200);
    expect(result.body.score).toBe(game.score);
    expect(result.body.leaderboard.me).toEqual({ rank: 1, userId: "1", completed: 1, score: game.score });
    expect((await h.request("/v1/results", body)).body).toEqual(result.body);
    expect((await h.request("/v1/results", { runId: run.id, actions: [] })).status).toBe(409);
    expect((await h.request("/v1/results", body, "2")).status).toBe(404);
    h.db.close();
  });
  test("unfinished, malformed, expired and abandoned runs cannot enter the board", async () => {
    const h = harness();
    const { run } = await winningRun(h);
    expect((await h.request("/v1/results", { runId: run.id, actions: [] })).body.error).toBe("LEVEL_NOT_COMPLETED");
    for (const actions of [[[0, 63]], [[-1]], [[1, 2, 3]], Array(31).fill([0])]) {
      expect((await h.request("/v1/results", { runId: run.id, actions })).status).toBe(400);
    }
    h.advance(2 * 60 * 60_000 + 1);
    expect((await h.request("/v1/results", { runId: run.id, actions: [] })).status).toBe(410);
    const next = await h.request("/v1/runs", { level: 1 });
    h.advance(4000); await h.request("/v1/runs", { level: 1 });
    expect((await h.request("/v1/results", { runId: next.body.id, actions: [] })).status).toBe(404);
    expect((await h.request("/v1/leaderboard")).body.entries).toEqual([]);
    h.db.close();
  });
  test("verified wins unlock levels, bests do not accumulate replays, environments isolate", async () => {
    const h = harness();
    expect((await h.request("/v1/runs", { level: 2 })).body.error).toBe("LEVEL_LOCKED");
    const first = await winningRun(h);
    await h.request("/v1/results", { runId: first.run.id, actions: first.actions });
    const replay = await winningRun(h);
    await h.request("/v1/results", { runId: replay.run.id, actions: replay.actions });
    const second = await winningRun(h, "1", 2);
    await h.request("/v1/results", { runId: second.run.id, actions: second.actions });
    const me = (await h.request("/v1/leaderboard")).body.me;
    expect(me.completed).toBe(2);
    expect(me.score).toBe(Math.max(first.game.score, replay.game.score) + second.game.score);
    expect((await h.request("/v1/leaderboard", undefined, "1", "production")).body.entries).toEqual([]);
    h.db.close();
  });
  test("completion sorts first, then score; personal rank is available outside top 50", async () => {
    const h = harness();
    const { run } = await winningRun(h);
    const scope = (h.db.query("SELECT scope FROM runs WHERE id=?").get(run.id) as { scope: string }).scope;
    for (let user = 1; user <= 55; user++) h.db.query("INSERT INTO bests VALUES (?,?,1,?)").run(scope, String(user), user * 100);
    h.db.query("INSERT INTO bests VALUES (?,?,2,10)").run(scope, "1");
    const data = (await h.request("/v1/leaderboard", undefined, "2")).body;
    expect(data.entries).toHaveLength(50);
    expect(data.entries[0].userId).toBe("1");
    expect(data.entries[1].userId).toBe("55");
    expect(data.me.rank).toBe(55);
    h.db.close();
  });
  test("body limits and per-user throttling reject excessive requests", async () => {
    const h = harness();
    expect((await h.request("/v1/runs", { padding: "x".repeat(4200) })).status).toBe(413);
    for (let i = 0; i < 44; i++) await h.request("/v1/leaderboard");
    expect((await h.request("/v1/leaderboard")).status).toBe(429);
    h.advance();
    expect((await h.request("/v1/leaderboard")).status).toBe(200);
    h.db.close();
  });
  test("scores survive closing and reopening the SQLite database", () => {
    const directory = mkdtempSync(join(tmpdir(), "candy-rank-test-"));
    const file = join(directory, "ranking.sqlite");
    let db = new Database(file);
    const config = { issuer, audience, appId, channel: "sandbox" as const, getPublicKey: async () => publicKey.export({ format: "jwk" }) };
    try {
      createLeaderboardServer({ ...config, database: db });
      db.query("INSERT INTO bests VALUES ('test','42',1,350)").run();
      db.close();
      db = new Database(file);
      createLeaderboardServer({ ...config, database: db });
      expect(db.query("SELECT score FROM bests WHERE user_id='42'").get()).toEqual({ score: 350 });
    } finally {
      db.close();
      const target = resolve(directory), parent = resolve(tmpdir());
      if (target.startsWith(parent + "/") || target.startsWith(parent + "\\")) rmSync(target, { recursive: true });
    }
  });
});

describe("deterministic ranked replay", () => {
  test("pathological generators still produce a deterministic playable board", () => {
    for (const value of [0, .17, .5, .999]) {
      const first = createBoard(() => value), second = createBoard(() => value);
      expect(first).toEqual(second);
      expect(findMatches(first)).toEqual([]);
      expect(hasMoves(first)).toBe(true);
    }
  });
  test("replaying an interrupted game resumes the exact random stream", async () => {
    const h = harness();
    const { run, actions, game } = await winningRun(h);
    const split = Math.floor(actions.length / 2);
    const resumed = replayRun(run, actions.slice(0, split));
    for (const action of actions.slice(split)) {
      if (action.length === 1) activateSpecial(resumed.game, action[0], resumed.random);
      else move(resumed.game, action[0], action[1], resumed.random);
    }
    expect(resumed.game).toEqual(game);
    expect(replayRun(run, actions).game).toEqual(game);
    expect(() => replayRun({ ...run, rules: "different" }, actions)).toThrow();
    h.db.close();
  });
});
