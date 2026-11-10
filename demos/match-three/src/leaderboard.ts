import type { MiniAppSDK } from "@discourse-mini-app/sdk";
import { LEVELS } from "./levels.ts";
import { RULES_VERSION, replayRun } from "./ranked.ts";
import type { LeaderboardData, RankedRun, RankedSave } from "./ranked.ts";

export function createLeaderboard(sdk: MiniAppSDK | null, t: (key: string, values?: object) => string, callbacks: {
  start: (run: RankedRun) => void;
  busy: (value: boolean) => void;
  submitted: (id: string) => void;
  pending: () => RankedSave | null;
  discard: () => void;
}) {
  const panel = document.getElementById("leaderboard") as HTMLDetailsElement;
  panel.hidden = false;
  const status = document.getElementById("rank-status")!;
  const list = document.getElementById("rank-list")!;
  const mine = document.getElementById("rank-mine")!;
  const refresh = document.getElementById("rank-refresh") as HTMLButtonElement;
  const start = document.getElementById("rank-start") as HTMLButtonElement;
  const retry = document.getElementById("rank-retry") as HTMLButtonElement;
  const discard = document.getElementById("rank-discard") as HTMLButtonElement;
  const select = document.getElementById("rank-level") as HTMLSelectElement;
  let data: LeaderboardData | null = null;
  let message = "rankUnavailable";
  let busy = false;
  let ready = false;
  let disposed = false;
  let nextRefresh = 0;
  const available = () => ready && !!sdk && sdk.permissions.has("network.request") && sdk.permissions.has("user.read");
  function render() {
    status.textContent = t(message);
    refresh.disabled = busy || !available();
    start.disabled = busy || !available() || !!callbacks.pending();
    retry.hidden = !callbacks.pending();
    retry.disabled = busy || !available();
    discard.hidden = !callbacks.pending();
    discard.disabled = busy;
    select.disabled = busy || !available() || !!callbacks.pending();
    const selected = Number(select.value) || Math.min((data?.me?.completed ?? 0) + 1, LEVELS.length);
    select.replaceChildren(...LEVELS.map(({ id }) => {
      const option = document.createElement("option");
      option.value = String(id); option.textContent = t("rankLevel", { level: id });
      option.disabled = id > (data?.me?.completed ?? 0) + 1;
      return option;
    }));
    select.value = String(Math.min(selected, (data?.me?.completed ?? 0) + 1));
    mine.textContent = data?.me ? t("rankMine", data.me) : t("rankNotListed");
    list.replaceChildren();
    if (!data?.entries.length) {
      const empty = document.createElement("p");
      empty.textContent = t(data ? "rankEmpty" : "rankNotLoaded");
      list.append(empty); return;
    }
    for (const entry of data.entries) {
      const row = document.createElement("div"); row.className = "candy__rank-row";
      row.classList.toggle("is-me", entry.userId === data.me?.userId);
      const rank = document.createElement("strong"); rank.textContent = String(entry.rank);
      const player = document.createElement("span");
      player.textContent = t(entry.userId === data.me?.userId ? "rankYou" : "rankUser", { id: entry.userId });
      const score = document.createElement("span"); score.textContent = t("rankResult", entry);
      row.append(rank, player, score); list.append(row);
    }
  }
  function setBusy(value: boolean) { busy = value; if (!disposed) { callbacks.busy(value); render(); } }
  async function request(endpoint: string, json?: { level: number } | { runId: string; actions: number[][] }) {
    if (!available()) throw new Error("rankUnavailable");
    const response = await sdk!.http.request(endpoint, json ? { json } : undefined);
    if (response.status < 200 || response.status >= 300) {
      const code = (response.body as { error?: string } | null)?.error;
      if (response.status === 401 || response.status === 403) throw new Error("rankAuthError");
      if (response.status === 429) throw new Error("rankRateLimit");
      if (code === "RUN_EXPIRED" || code === "RUN_NOT_FOUND") throw new Error("rankExpired");
      if (code === "LEVEL_LOCKED") throw new Error("rankLocked");
      throw new Error("rankRequestFailed");
    }
    return response.body;
  }
  function readBoard(value: unknown): LeaderboardData {
    const result = value as LeaderboardData;
    const validEntry = (entry: LeaderboardData["entries"][number]) => entry && typeof entry.userId === "string"
      && Number.isSafeInteger(entry.rank) && entry.rank >= 1 && Number.isSafeInteger(entry.score) && entry.score >= 0
      && Number.isInteger(entry.completed) && entry.completed >= 1 && entry.completed <= LEVELS.length;
    if (!result || result.rules !== RULES_VERSION || !["sandbox", "production"].includes(result.channel)
      || !Array.isArray(result.entries) || result.entries.length > 50 || !result.entries.every(validEntry)
      || (result.me !== null && !validEntry(result.me))) throw new Error("rankRequestFailed");
    return result;
  }
  function failed(error: unknown) {
    const key = error instanceof Error ? error.message : "";
    message = ["rankUnavailable", "rankAuthError", "rankRateLimit", "rankExpired", "rankLocked"].includes(key) ? key : "rankRequestFailed";
  }
  async function load() {
    if (busy || disposed || !available()) { render(); return; }
    if (Date.now() < nextRefresh) return;
    nextRefresh = Date.now() + 10_000;
    setBusy(true); message = "rankLoading"; render();
    try {
      const result = readBoard(await request("leaderboard"));
      if (disposed) return;
      data = result;
      message = result.channel === "sandbox" ? "rankSandbox" : "rankProduction";
      select.value = String(Math.min((data.me?.completed ?? 0) + 1, LEVELS.length));
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }
  async function submit() {
    const pending = callbacks.pending();
    if (busy || disposed || !pending || !available()) { render(); return; }
    setBusy(true); message = "rankSubmitting"; render();
    try {
      const result = await request("submitResult", { runId: pending.run.id, actions: pending.actions }) as { accepted?: boolean; leaderboard?: unknown };
      if (disposed) return;
      if (result.accepted !== true) throw new Error("rankRequestFailed");
      data = readBoard(result.leaderboard);
      callbacks.submitted(pending.run.id);
      select.value = String(Math.min((data.me?.completed ?? 0) + 1, LEVELS.length));
      message = data.channel === "sandbox" ? "rankSubmittedSandbox" : "rankSubmitted";
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }
  start.addEventListener("click", async () => {
    if (busy || disposed || callbacks.pending()) return;
    const level = Number(select.value);
    setBusy(true); message = "rankStarting"; render();
    try {
      const run = await request("startRun", { level }) as unknown as RankedRun;
      if (disposed) return;
      if (typeof run?.id !== "string" || run.id.length > 64 || !Number.isFinite(run.expires) || run.expires <= Date.now()) throw new Error("rankRequestFailed");
      replayRun(run, []);
      callbacks.start(run);
      message = "rankStarted";
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  });
  refresh.addEventListener("click", () => { void load(); });
  retry.addEventListener("click", () => { void submit(); });
  discard.addEventListener("click", () => { if (!busy) { callbacks.discard(); message = available() ? "rankReady" : "rankUnavailable"; render(); } });
  panel.addEventListener("toggle", () => { if (panel.open && !data) void load(); });
  return {
    render, submit,
    connect() { ready = true; message = available() ? "rankReady" : "rankUnavailable"; render(); },
    notifyPending() { render(); if (callbacks.pending()) { message = "rankPending"; render(); } },
    dispose() { disposed = true; },
  };
}
