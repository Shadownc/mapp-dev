import "./style.css";
import { getSDK } from "@discourse-mini-app/sdk";
import { createGame, move, restoreGame, snapshotGame } from "./engine.ts";
import { createHost } from "./host.ts";
import messages from "./strings.json";

type TemplateElements = {
  connection: HTMLElement;
  score: HTMLElement;
  best: HTMLElement;
  player: HTMLElement;
  refresh: HTMLButtonElement;
  board: HTMLElement;
  overlay: HTMLElement;
  "overlay-title": HTMLElement;
  "overlay-copy": HTMLElement;
  continue: HTMLButtonElement;
  again: HTMLButtonElement;
  moves: HTMLElement;
  pause: HTMLButtonElement;
  reset: HTMLButtonElement;
  directions: HTMLElement;
  notice: HTMLElement;
};

// IDs and data attributes come from the bundled template.
const element = <Id extends string>(id: Id) =>
  document.getElementById(id) as Id extends keyof TemplateElements
    ? TemplateElements[Id]
    : HTMLElement;
let game = createGame();
let continuing = false;
let ready = false;
let paused = false;
let best = 0;
let saved = -1;
let saveTimer: ReturnType<typeof setTimeout> | null | undefined;
let gesture: { x: number; y: number; id: number } | null | undefined;
const host = createHost(import.meta.env.DEV ? null : getSDK(), messages, {
  onIdentity(user) {
    element("player").textContent = user
      ? t("player", { ...user, name: user.name || user.username })
      : t("guestName");
  },
  onBest(value) {
    best = value;
    element("best").textContent = String(value);
  },
  onMode(mode) {
    element("connection").textContent = t(mode);
  },
  onNotice(text) {
    element("notice").textContent = text;
  },
  onTheme(theme) {
    const style = document.documentElement.style;
    for (const [property, value] of Object.entries({
      primary: theme.text,
      secondary: theme.background,
      accent: theme.accent,
      line: theme.border,
    })) {
      style.setProperty(`--${property}`, value);
    }
    style.colorScheme = theme.mode;
    document.documentElement.dataset.reducedMotion = String(
      theme.reducedMotion
    );
    localize();
    render();
  },
});
const t = host.t;
const cells = Array.from({ length: 16 }, () => {
  const cell = document.createElement("div");
  cell.className = "puzzle__tile";
  element("board").append(cell);
  return cell;
});

function localize() {
  document.querySelectorAll<HTMLElement>("[data-text]").forEach((node) => {
    node.textContent = t(node.dataset.text!);
  });
  element("board").setAttribute("aria-label", t("board"));
  element("directions").setAttribute("aria-label", t("directions"));
}
function render() {
  cells.forEach((cell, index) => {
    const value = game.board[index];
    cell.textContent = value ? String(value) : "";
    cell.dataset.value = String(value);
    cell.classList.toggle("is-new", index === game.spawned);
    cell.classList.toggle("is-large", value > 2048);
    cell.setAttribute(
      "aria-label",
      t("cell", {
        row: Math.floor(index / 4) + 1,
        column: (index % 4) + 1,
        value: value || t("empty"),
      })
    );
  });
  element("score").textContent = String(game.score);
  element("best").textContent = String(best);
  element("moves").textContent = t("moves", game);
  const won = game.won && !continuing;
  element("overlay").hidden = !paused && !won && !game.over;
  element("overlay-title").textContent = t(
    paused ? "pausedTitle" : game.over ? "over" : "win"
  );
  element("overlay-copy").textContent = t(
    paused ? "pausedText" : game.over ? "overCopy" : "winCopy",
    game
  );
  element("continue").hidden = game.over && !paused;
  element("continue").textContent = t(paused ? "resume" : "continue");
  element("reset").disabled = !ready;
  element("pause").disabled = !ready || game.over || won;
  element("pause").textContent = t(paused ? "resume" : "pause");
  document
    .querySelectorAll<HTMLButtonElement>("[data-direction]")
    .forEach((button) => {
      button.disabled = !ready || paused || won || game.over;
      button.setAttribute("aria-label", t(button.dataset.direction!));
    });
}
function persist() {
  clearTimeout(saveTimer as ReturnType<typeof setTimeout> | undefined);
  saveTimer = null;
  if (!ready) {
    return;
  }
  void host.save("game-state", { ...snapshotGame(game), continuing });
  if (game.score > saved) {
    saved = game.score;
    void host.saveScore(game.score);
  }
}
function play(direction: string) {
  if (!ready || paused || (game.won && !continuing)) {
    return;
  }
  if (move(game, direction) && !saveTimer) {
    saveTimer = setTimeout(persist, 5000);
  }
  render();
  if (game.over || (game.won && !continuing)) {
    persist();
  }
}
function reset() {
  if (!ready) {
    return;
  }
  persist();
  game = createGame();
  continuing = false;
  paused = false;
  saved = -1;
  element("notice").textContent = "";
  persist();
  render();
  element("board").focus({ preventScroll: true });
}
function pause() {
  if (!ready || game.over || (game.won && !continuing)) {
    return;
  }
  paused = !paused;
  persist();
  render();
  if (!paused) {
    element("board").focus({ preventScroll: true });
  }
}
async function initialize() {
  await host.connect();
  const previous = await host.load("game-state");
  const restored = restoreGame(previous);
  if (restored) {
    game = restored;
    continuing = (previous as { continuing?: unknown }).continuing === true;
    paused = !game.over && (!game.won || continuing);
    element("notice").textContent = t("restored");
  }
  ready = true;
  render();
  await host.rendered();
}

element("refresh").addEventListener("click", async () => {
  element("refresh").disabled = true;
  try {
    await host.connect();
  } finally {
    element("refresh").disabled = false;
  }
});
element("reset").addEventListener("click", reset);
element("again").addEventListener("click", reset);
element("pause").addEventListener("click", pause);
element("continue").addEventListener("click", () => {
  if (paused) {
    paused = false;
  } else {
    continuing = true;
  }
  render();
  element("board").focus({ preventScroll: true });
});
document
  .querySelectorAll<HTMLButtonElement>("[data-direction]")
  .forEach((button) => {
    button.addEventListener("click", () => play(button.dataset.direction!));
  });
window.addEventListener("keydown", (event) => {
  if (
    (event.target as HTMLElement).closest?.("button, input, textarea, select")
  ) {
    return;
  }
  const direction = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    KeyA: "left",
    KeyD: "right",
    KeyW: "up",
    KeyS: "down",
  }[event.code];
  if (direction) {
    event.preventDefault();
    if (!event.repeat) {
      play(direction);
    }
  } else if (event.code === "KeyP" || event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) {
      pause();
    }
  }
});
element("board").addEventListener("pointerdown", (event) => {
  gesture = { x: event.clientX, y: event.clientY, id: event.pointerId };
  element("board").setPointerCapture(event.pointerId);
  element("board").focus({ preventScroll: true });
});
element("board").addEventListener("pointerup", (event) => {
  if (!gesture || gesture.id !== event.pointerId) {
    return;
  }
  const x = event.clientX - gesture.x;
  const y = event.clientY - gesture.y;
  gesture = null;
  if (Math.max(Math.abs(x), Math.abs(y)) < 24) {
    return;
  }
  play(
    Math.abs(x) > Math.abs(y)
      ? x > 0
        ? "right"
        : "left"
      : y > 0
        ? "down"
        : "up"
  );
});
element("board").addEventListener("pointercancel", () => {
  gesture = null;
});
function pauseWhenHidden() {
  if (ready && !paused && !game.over && !(game.won && !continuing)) {
    pause();
  }
}
window.addEventListener("blur", pauseWhenHidden);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseWhenHidden();
  }
});
window.addEventListener("pagehide", () => {
  clearTimeout(saveTimer as ReturnType<typeof setTimeout> | undefined);
  host.dispose();
});
localize();
render();
void initialize();
