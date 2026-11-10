import "./style.css";
import { getSDK } from "@discourse-mini-app/sdk";
import { CELLS, COLORS, SIZE, activateSpecial, areAdjacent, createGame, move, restoreGame, snapshotGame, startLevel } from "./engine.ts";
import { LEVELS, getLevel, objectiveProgress } from "./levels.ts";
import type { Specials } from "./engine.ts";
import { createEffects } from "./effects.ts";
import { createHost } from "./host.ts";
import { createLeaderboard } from "./leaderboard.ts";
import { replayRun } from "./ranked.ts";
import type { RankedSave } from "./ranked.ts";
import appConfig from "../app.config.json";
import messages from "./strings.json";

type Elements = {
  connection: HTMLElement; score: HTMLElement; best: HTMLElement; player: HTMLElement;
  refresh: HTMLButtonElement; board: HTMLElement; overlay: HTMLElement;
  "overlay-title": HTMLElement; "overlay-copy": HTMLElement;
  continue: HTMLButtonElement; again: HTMLButtonElement; moves: HTMLElement;
  combo: HTMLElement; pause: HTMLButtonElement; reset: HTMLButtonElement; notice: HTMLElement;
  effects: HTMLElement; progress: HTMLElement; "target-label": HTMLElement;
  levels: HTMLElement; "level-title": HTMLElement; targets: HTMLElement;
  "game-mode": HTMLElement;
};
const elements = new Map<keyof Elements, HTMLElement>();
const element = <Id extends keyof Elements>(id: Id): Elements[Id] => {
  let node = elements.get(id);
  if (!node) { node = document.getElementById(id)!; elements.set(id, node); }
  return node as Elements[Id];
};
// Unchanged values must not invalidate styles, layout or accessibility state.
function text(node: HTMLElement, value: string) { if (node.textContent !== value) node.textContent = value; }
function attribute(node: HTMLElement, name: string, value: string) { if (node.getAttribute(name) !== value) node.setAttribute(name, value); }
function classState(node: HTMLElement, name: string, value: boolean) { if (node.classList.contains(name) !== value) node.classList.toggle(name, value); }
function disabled(node: HTMLButtonElement, value: boolean) { if (node.disabled !== value) node.disabled = value; }
function hidden(node: HTMLElement, value: boolean) { if (node.hidden !== value) node.hidden = value; }
let game = createGame();
let ready = false;
let paused = false;
let best = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pointerStart: { id: number; index: number; x: number; y: number } | null = null;
let animating = false;
let animationRun = 0;
let displayBoard: number[] | null = null;
let displaySpecials: Specials | null = null;
let displayScore: number | null = null;
let displayCollected: number[] | null = null;
let suppressClickUntil = 0;
let ranked: RankedSave | null = null;
let pendingResult: RankedSave | null = null;
let rankedRandom: (() => number) | undefined;
let rankingBusy = false;
let rankedVerified = false;
const sdk = import.meta.env.DEV ? null : getSDK();

const host = createHost(sdk, messages, {
  onIdentity(user) { element("player").textContent = user ? t("player", { ...user, name: user.name || user.username }) : t("guestName"); },
  onBest(value) { best = value; element("best").textContent = String(best); },
  onMode(mode) { element("connection").textContent = t(mode); },
  onNotice(text) { element("notice").textContent = text; },
  onTheme(theme) {
    const style = document.documentElement.style;
    for (const [property, value] of Object.entries({ primary: theme.text, secondary: theme.background, accent: theme.accent, line: theme.border })) {
      style.setProperty(`--${property}`, value);
    }
    style.colorScheme = theme.mode;
    document.documentElement.dataset.reducedMotion = String(theme.reducedMotion);
    if (theme.reducedMotion) { stopEffects(); persist(); }
    localize(); render();
  },
});
const t = host.t;
const gems: HTMLElement[] = [];
const tiles = Array.from({ length: CELLS }, (_, index) => {
  const tile = document.createElement("button");
  tile.className = "candy__tile";
  tile.type = "button";
  tile.dataset.index = String(index);
  tile.setAttribute("role", "gridcell");
  const gem = document.createElement("span");
  gem.className = "candy__gem";
  gem.setAttribute("aria-hidden", "true");
  gems.push(gem);
  tile.append(gem);
  element("board").append(tile);
  return tile;
});
const effects = createEffects(element("board"), tiles, element("effects"));
let localeRevision = 0;
const tileViews: Array<{ color: number; special: string; selected: boolean; disabled: boolean; locale: number } | undefined> = [];
const levelButtons = LEVELS.map(({ id }) => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.level = String(id);
  button.addEventListener("click", () => { if (id !== game.level) changeLevel(id); });
  element("levels").append(button);
  return button;
});
const targetCards = Array.from({ length: COLORS }, (_, color) => {
  const card = document.createElement("div");
  card.className = "candy__target";
  card.dataset.color = String(color);
  const icon = document.createElement("span");
  icon.className = "candy__target-icon";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  const name = document.createElement("span");
  const count = document.createElement("strong");
  text.append(name, count);
  card.append(icon, text);
  element("targets").append(card);
  return { card, name, count };
});
const leaderboard = appConfig.leaderboard.enabled ? createLeaderboard(sdk, t, {
  pending: () => pendingResult,
  busy(value) {
    if (value) pauseWhenHidden();
    rankingBusy = value;
    render();
  },
  start(run) {
    stopEffects();
    const replay = replayRun(run, []);
    replay.game.completed = Math.max(game.completed, replay.game.completed);
    game = replay.game;
    ranked = { run, actions: [] }; rankedRandom = replay.random; rankedVerified = false;
    paused = false;
    persist(); render(); void enterBoard();
  },
  submitted(id) {
    if (pendingResult?.run.id === id) pendingResult = null;
    if (ranked?.run.id === id) { ranked = null; rankedRandom = undefined; rankedVerified = true; }
    persist(); render();
  },
  discard() {
    if (pendingResult && ranked?.run.id === pendingResult.run.id) {
      ranked = null; rankedRandom = undefined; rankedVerified = false;
    }
    pendingResult = null;
    persist(); render();
  },
}) : null;

function localize() {
  localeRevision++;
  document.querySelectorAll<HTMLElement>("[data-text]").forEach((node) => { node.textContent = t(node.dataset.text!); });
  element("board").setAttribute("aria-label", t("title"));
  document.documentElement.lang = t("title") === messages.en.title ? "en" : "zh-CN";
  element("progress").setAttribute("aria-label", t("collectionProgress"));
  element("levels").setAttribute("aria-label", t("levelSelect"));
  element("targets").setAttribute("aria-label", t("collectionProgress"));
  effects.invalidateGeometry();
  leaderboard?.render();
}

function render() {
  const board = displayBoard ?? game.board;
  const specials = displaySpecials ?? game.specials;
  const score = displayScore ?? game.score;
  const collected = displayCollected ?? game.collected;
  const level = getLevel(game.level);
  const progress = objectiveProgress(game.level, collected);
  hidden(element("game-mode"), !appConfig.leaderboard.enabled);
  text(element("game-mode"), t(ranked ? "modeRanked" : rankedVerified ? "modeVerified" : "modePractice"));
  text(element("level-title"), t("levelTitle", { level: level.id, total: LEVELS.length }));
  for (const [index, button] of levelButtons.entries()) {
    const id = index + 1;
    const locked = id > game.completed + 1;
    disabled(button, !ready || locked || animating || rankingBusy);
    classState(button, "is-current", id === game.level);
    classState(button, "is-complete", id <= game.completed);
    attribute(button, "aria-current", id === game.level ? "step" : "false");
    text(button, `${id}${id <= game.completed ? " ✓" : locked ? " ·" : ""}`);
    const label = t(locked ? "levelLocked" : id <= game.completed ? "levelCleared" : "levelOpen", { level: id });
    attribute(button, "aria-label", label);
    attribute(button, "title", label);
  }
  for (const [color, { card, name, count }] of targetCards.entries()) {
    const target = level.targets.find((target) => target.color === color);
    hidden(card, !target);
    if (!target) continue;
    const done = collected[color] >= target.count;
    const current = Math.min(collected[color], target.count);
    classState(card, "is-complete", done);
    text(name, t(`color${color}`));
    text(count, `${current} / ${target.count}${done ? " ✓" : ""}`);
    attribute(card, "aria-label", `${t(`color${color}`)}: ${current} / ${target.count}${done ? ` · ${t("targetDone")}` : ""}`);
  }
  classState(element("board"), "is-busy", animating);
  attribute(element("board"), "aria-busy", String(animating));
  const tilesDisabled = !ready || animating || paused || game.over || game.won || rankingBusy;
  for (const [index, tile] of tiles.entries()) {
    const color = board[index];
    const special = specials[index];
    const specialName = special ?? "none";
    const selected = game.selected === index;
    const previous = tileViews[index];
    // Compare JS snapshots so an unchanged tile doesn't even need a DOM lookup.
    if (previous?.color !== color) tile.dataset.color = String(color);
    if (previous?.special !== specialName) {
      tile.dataset.special = specialName;
      gems[index].dataset.special = specialName;
    }
    if (previous?.selected !== selected) {
      classState(tile, "is-selected", selected);
      tile.setAttribute("aria-pressed", String(selected));
    }
    if (previous?.disabled !== tilesDisabled) tile.disabled = tilesDisabled;
    if (previous?.color !== color || previous.special !== specialName || previous.locale !== localeRevision) {
      const specialLabel = special ? ` · ${t(`special_${special}`)} · ${t("specialTap")}` : "";
      attribute(tile, "aria-label", `${Math.floor(index / SIZE) + 1}, ${index % SIZE + 1}: ${t(`color${color}`)}${specialLabel}`);
      attribute(tile, "title", special ? `${t(`special_${special}`)} · ${t("specialTap")}` : "");
    }
    tileViews[index] = { color, special: specialName, selected, disabled: tilesDisabled, locale: localeRevision };
  }
  text(element("score"), String(score));
  const fraction = String(progress.current / progress.total);
  if (element("progress").style.getPropertyValue("--progress") !== fraction) element("progress").style.setProperty("--progress", fraction);
  attribute(element("progress"), "aria-valuenow", String(progress.current));
  attribute(element("progress"), "aria-valuemax", String(progress.total));
  text(element("target-label"), t("collected", progress));
  text(element("best"), String(best));
  text(element("moves"), t("moves", { moves: Math.max(0, level.moves - game.moves) }));
  if (!animating) text(element("combo"), game.combo > 1 ? t("combo", game) : "");
  const won = game.won && !animating;
  const finished = won && game.level === LEVELS.length;
  hidden(element("overlay"), animating || (!paused && !won && !game.over));
  classState(element("overlay"), "is-win", won && !paused);
  text(element("overlay-title"), t(paused ? "pausedTitle" : game.over ? "over" : finished ? "campaignWin" : "win", { level: game.level }));
  text(element("overlay-copy"), t(paused ? "pausedText" : game.over ? "overCopy" : finished ? "campaignWinCopy" : "winCopy", { level: game.level + 1 }));
  hidden(element("continue"), game.over && !paused);
  text(element("continue"), t(paused ? "resume" : finished ? "replayJourney" : "nextLevel"));
  text(element("pause"), t(paused ? "resume" : "pause"));
  disabled(element("pause"), !ready || rankingBusy || (!animating && (game.over || won)));
  disabled(element("reset"), !ready || rankingBusy);
  disabled(element("again"), !ready || rankingBusy);
  disabled(element("continue"), !ready || rankingBusy);
}

function stopEffects() {
  animationRun++;
  effects.cancel();
  animating = false;
  displayBoard = null;
  displaySpecials = null;
  displayScore = null;
  displayCollected = null;
  pointerStart = null;
}

async function enterBoard() {
  stopEffects();
  if (effects.reduced() || paused || game.over || game.won) { render(); return; }
  const run = animationRun;
  animating = true;
  render();
  try { await effects.enter(); }
  finally { if (run === animationRun) { animating = false; render(); } }
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!ready) return;
  const save = { ...snapshotGame(game), ranked, pendingResult, rankedVerified };
  void host.save("match-three-state", JSON.parse(JSON.stringify(save)));
  void host.saveScore(game.score);
}
async function play(first: number, second?: number) {
  if (!ready || animating || paused || game.over || game.won || rankingBusy) return;
  if (second === undefined ? !game.specials[first] : !areAdjacent(first, second)) return;
  stopEffects();
  const run = animationRun;
  const before = [...game.board];
  const specialsBefore = [...game.specials];
  const scoreBefore = game.score;
  const collectedBefore = [...game.collected];
  const alreadyWon = game.won;
  const result = second === undefined ? activateSpecial(game, first, rankedRandom) : move(game, first, second, rankedRandom);
  if (result.changed && ranked) {
    ranked.actions.push(second === undefined ? [first] : [first, second]);
    if (game.won) pendingResult = { run: { ...ranked.run }, actions: ranked.actions.map((action) => [...action]) };
    // Persist the replay before animations so cancelling them never loses a completed run.
    persist();
    leaderboard?.notifyPending();
  }
  game.selected = -1;
  element("notice").textContent = "";
  element("combo").textContent = "";
  animating = true;
  displayBoard = before;
  displaySpecials = specialsBefore;
  displayScore = scoreBefore;
  displayCollected = collectedBefore;
  render();
  try {
    if (second !== undefined) await effects.swap(first, second, result.changed);
    if (run !== animationRun) return;
    let score = scoreBefore;
    const collected = [...collectedBefore];
    // Cap playback for pathological chains; the full result is still scored and saved.
    for (const step of result.cascades.slice(0, 10)) {
      if (effects.reduced()) break;
      displayBoard = step.before;
      displaySpecials = step.specialsBefore;
      render();
      if (step.activated.length) {
        await effects.activate(step.activated);
        if (run !== animationRun) return;
      }
      await effects.clear(step, t("combo", { combo: step.combo }));
      if (run !== animationRun) return;
      score += step.points;
      displayScore = score;
      for (let color = 0; color < COLORS; color++) collected[color] += step.collected[color];
      displayCollected = [...collected];
      displayBoard = step.after;
      displaySpecials = step.specialsAfter;
      element("combo").textContent = step.combo > 1 ? t("combo", { combo: step.combo }) : "";
      render();
      effects.pulse(element("score"));
      for (const { color } of getLevel(game.level).targets) {
        if (step.collected[color]) effects.pulse(targetCards[color].count);
      }
      await effects.fall(step.falls);
      if (run !== animationRun) return;
      if (step.created.length) {
        element("notice").textContent = t("specialEarned", { types: step.created.map(({ type }) => t(`special_${type}`)).join(" / ") });
        await effects.reward(step.created);
        if (run !== animationRun) return;
      }
    }
    if (result.reshuffled && !effects.reduced()) {
      displayBoard = game.board;
      displaySpecials = game.specials;
      render();
      await effects.enter();
    }
  } catch (error) {
    console.warn("[match-three] Animation interrupted", error);
  } finally {
    if (run === animationRun) {
      animating = false;
      displayBoard = null;
      displaySpecials = null;
      displayScore = null;
      displayCollected = null;
      render();
    }
  }
  if (run !== animationRun) return;
  if (result.changed) {
    const created = result.cascades.flatMap((step) => step.created);
    const activated = result.cascades.flatMap((step) => step.activated);
    if (result.reshuffled) element("notice").textContent = t("reshuffled");
    else if (created.length) element("notice").textContent = t("specialEarned", { types: [...new Set(created.map(({ type }) => t(`special_${type}`)))].join(" / ") });
    else if (activated.length) element("notice").textContent = t("specialUsed", { count: activated.length });
    else element("notice").textContent = result.combo > 1 ? t("combo", result) : "";
    if (game.score > best) void host.saveScore(game.score);
    if (!saveTimer) saveTimer = setTimeout(persist, 3000);
    if (game.won || game.over) persist();
    if (game.won && !alreadyWon) effects.celebrate();
  } else {
    element("notice").textContent = t("invalidMove");
  }
  render();
}
function select(index: number) {
  if (!ready || animating || paused || game.over || game.won || rankingBusy) return;
  if (game.specials[index]) { void play(index); return; }
  if (game.selected === index) game.selected = -1;
  else if (areAdjacent(game.selected, index)) { play(game.selected, index); return; }
  else game.selected = index;
  render();
}
function changeLevel(level: number) {
  if (!ready || rankingBusy) return;
  const next = startLevel(game, level);
  if (!next) return;
  stopEffects();
  ranked = null; rankedRandom = undefined; rankedVerified = false;
  game = next; paused = false;
  element("notice").textContent = "";
  persist(); render(); element("board").focus({ preventScroll: true });
  void enterBoard();
}
function reset() { changeLevel(game.level); }
function togglePause() {
  if (animating) { stopEffects(); persist(); }
  render();
  if (!ready || game.over || game.won || rankingBusy) return;
  paused = !paused; game.selected = -1;
  persist(); render();
  if (!paused) element("board").focus({ preventScroll: true });
}
async function initialize() {
  await host.connect();
  const previous = await host.load("match-three-state");
  const restored = restoreGame(previous);
  if (restored) {
    game = restored;
    // With ranking disabled, an old ranked board continues as an ordinary local game.
    const saved = (appConfig.leaderboard.enabled ? previous : {}) as unknown as { ranked?: RankedSave; pendingResult?: RankedSave; rankedVerified?: boolean };
    rankedVerified = saved.rankedVerified === true;
    // Never trust a persisted board for a ranked game; regenerate it from the issued seed.
    try {
      if (saved.ranked) {
        const replay = replayRun(saved.ranked.run, saved.ranked.actions);
        replay.game.completed = Math.max(game.completed, replay.game.completed);
        game = replay.game; ranked = saved.ranked; rankedRandom = replay.random;
      }
    } catch { ranked = null; rankedRandom = undefined; }
    try {
      if (saved.pendingResult && replayRun(saved.pendingResult.run, saved.pendingResult.actions).game.won) pendingResult = saved.pendingResult;
    } catch { pendingResult = null; }
    if (ranked && game.won && !pendingResult) pendingResult = { run: { ...ranked.run }, actions: ranked.actions.map((action) => [...action]) };
    paused = !game.over && !game.won;
    const legacy = (previous as { format?: unknown }).format !== 3;
    element("notice").textContent = t(legacy ? "legacyRestored" : "restored");
  }
  ready = true; render();
  leaderboard?.connect();
  leaderboard?.notifyPending();
  if (restored) persist();
  void enterBoard();
  await host.rendered();
}

element("refresh").addEventListener("click", async () => {
  element("refresh").disabled = true;
  try { await host.connect(); } finally { element("refresh").disabled = false; }
});
element("reset").addEventListener("click", reset);
element("again").addEventListener("click", reset);
element("pause").addEventListener("click", togglePause);
element("continue").addEventListener("click", () => {
  if (!ready || rankingBusy) return;
  if (!paused && game.won) {
    changeLevel(game.level < LEVELS.length ? game.level + 1 : 1);
    return;
  }
  stopEffects();
  paused = false;
  persist(); render(); element("board").focus({ preventScroll: true });
});
element("board").addEventListener("click", (event) => {
  if (event.detail > 0 && performance.now() < suppressClickUntil) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".candy__tile");
  if (button) select(Number(button.dataset.index));
});
element("board").addEventListener("pointerdown", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".candy__tile");
  if (!button || button.disabled) return;
  button.setPointerCapture(event.pointerId);
  pointerStart = { id: event.pointerId, index: Number(button.dataset.index), x: event.clientX, y: event.clientY };
});
element("board").addEventListener("pointerup", (event) => {
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const { x, y, index } = pointerStart;
  pointerStart = null;
  const dx = event.clientX - x, dy = event.clientY - y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
  suppressClickUntil = performance.now() + 500;
  const neighbor = Math.abs(dx) > Math.abs(dy) ? index + (dx > 0 ? 1 : -1) : index + (dy > 0 ? SIZE : -SIZE);
  if (areAdjacent(index, neighbor)) play(index, neighbor);
});
element("board").addEventListener("pointercancel", () => { pointerStart = null; });
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyP" || event.code === "Space" && event.target === element("board")) {
    event.preventDefault(); if (!event.repeat) togglePause(); return;
  }
  if (event.target !== element("board") && !(event.target as HTMLElement).classList?.contains("candy__tile")) return;
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE }[event.code];
  if (offset !== undefined && game.selected >= 0) {
    event.preventDefault(); const target = game.selected + offset;
    if (areAdjacent(game.selected, target)) play(game.selected, target);
  }
});
function pauseWhenHidden() {
  if (animating) { stopEffects(); persist(); render(); }
  if (ready && !paused && !game.over && !game.won) togglePause();
}
window.addEventListener("blur", pauseWhenHidden);
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseWhenHidden(); });
window.addEventListener("resize", () => effects.invalidateGeometry());
window.addEventListener("pagehide", () => { stopEffects(); effects.dispose(); leaderboard?.dispose(); persist(); host.dispose(); });
window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
  if (effects.reduced()) { stopEffects(); persist(); render(); }
});
localize(); render(); void initialize();
