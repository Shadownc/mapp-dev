import "./style.css";
import { getSDK } from "@discourse-mini-app/sdk";
import { createHost } from "./host.ts";
import type { Game } from "./physics.ts";
import {
  createGame,
  HEIGHT,
  launchBall,
  movePaddle,
  step,
  WIDTH,
} from "./physics.ts";
import messages from "./strings.json";

type TemplateElements = {
  connection: HTMLElement;
  "player-avatar": HTMLElement;
  "player-name": HTMLElement;
  "refresh-user": HTMLButtonElement;
  score: HTMLElement;
  best: HTMLElement;
  level: HTMLElement;
  lives: HTMLElement;
  court: HTMLCanvasElement;
  overlay: HTMLElement;
  "overlay-title": HTMLElement;
  "overlay-copy": HTMLElement;
  start: HTMLButtonElement;
  pause: HTMLButtonElement;
  restart: HTMLButtonElement;
  notice: HTMLElement;
};

// IDs and data attributes come from the bundled template.
const element = <Id extends string>(id: Id) =>
  document.getElementById(id) as Id extends keyof TemplateElements
    ? TemplateElements[Id]
    : HTMLElement;
const host = createHost(import.meta.env.DEV ? null : getSDK(), messages, {
  onIdentity(user) {
    element("player-name").textContent = user
      ? t("playerName", { name: user.name || user.username })
      : t("guestName");
    element("player-avatar").textContent = user?.initials || "?";
  },
  onBest(value) {
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
      tertiary: theme.accent,
      border: theme.border,
      muted: theme.text,
    })) {
      style.setProperty(`--${property}`, value);
    }
    document.documentElement.style.colorScheme = theme.mode;
    reducedMotion = theme.reducedMotion;
    localize();
    renderState = "";
    updateUI();
  },
});
const t = host.t;
function localize() {
  document.querySelectorAll<HTMLElement>("[data-text]").forEach((node) => {
    node.textContent = t(node.dataset.text!);
  });
  element("court").setAttribute("aria-label", t("canvasLabel"));
}
localize();
const canvas = element("court");
canvas.setAttribute("aria-label", t("canvasLabel"));
const context = canvas.getContext("2d")!;
const colors = getComputedStyle(document.documentElement);
const color = (name: string) => colors.getPropertyValue(`--${name}`).trim();
const palette = ["peach", "sand", "mint", "sky", "lilac", "peach", "mint"].map(
  color
);
let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let game = createGame();
let userReady = false;
let lastTime = 0;
let frameId: number;
let particles: Array<{
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}> = [];
let trail: Array<{ x: number; y: number }> = [];
let savedScore = -1;
let renderState = "";
const keys = new Set<string>();

function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string
) {
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function draw(seconds: number) {
  context.fillStyle = color("court");
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = color("court-dot");
  for (let x = 24; x < WIDTH; x += 28) {
    for (let y = 24; y < HEIGHT; y += 28) {
      context.fillRect(x, y, 2, 2);
    }
  }
  for (const brick of game.bricks) {
    if (!brick.alive) {
      continue;
    }
    roundedRect(
      brick.x,
      brick.y + 3,
      brick.width,
      brick.height,
      5,
      color("court-dot")
    );
    roundedRect(
      brick.x,
      brick.y,
      brick.width,
      brick.height,
      5,
      palette[brick.row]
    );
    context.globalAlpha = 0.23;
    roundedRect(
      brick.x + 5,
      brick.y + 3,
      brick.width - 10,
      3,
      2,
      color("court-ink")
    );
    context.globalAlpha = 1;
  }
  if (!reducedMotion && game.phase === "running") {
    trail.push({ x: game.ball.x, y: game.ball.y });
    if (trail.length > 8) {
      trail.shift();
    }
    trail.forEach((point, index) => {
      context.globalAlpha = (index / trail.length) * 0.2;
      context.beginPath();
      context.arc(
        point.x,
        point.y,
        (game.ball.radius * index) / trail.length,
        0,
        Math.PI * 2
      );
      context.fillStyle = color("court-ink");
      context.fill();
    });
    context.globalAlpha = 1;
  }
  for (const particle of particles) {
    if (game.phase === "running") {
      particle.life -= seconds;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.vy += 120 * seconds;
    }
    context.globalAlpha = Math.max(0, particle.life / 0.45);
    roundedRect(particle.x, particle.y, 5, 5, 1, particle.color);
  }
  context.globalAlpha = 1;
  particles = particles.filter((particle) => particle.life > 0);
  roundedRect(
    game.paddle.x - game.paddle.width / 2,
    game.paddle.y,
    game.paddle.width,
    game.paddle.height,
    6,
    color("peach")
  );
  roundedRect(
    game.paddle.x - 15,
    game.paddle.y + 4,
    30,
    3,
    2,
    color("court-ink")
  );
  context.fillStyle = color("court-ink");
  context.beginPath();
  context.arc(game.ball.x, game.ball.y, game.ball.radius, 0, Math.PI * 2);
  context.fill();
}

function saveBest() {
  if (game.score <= savedScore) {
    return;
  }
  const score = game.score;
  savedScore = score;
  void host.saveScore(score);
  void host.save("last-run", { score, level: game.level });
}

function updateUI() {
  const next = `${game.phase}:${game.score}:${game.lives}:${game.level}:${userReady}`;
  if (renderState === next) {
    return;
  }
  renderState = next;
  element("score").textContent = String(game.score);
  element("level").textContent = String(game.level);
  element("lives").textContent = "● ".repeat(game.lives).trim() || "—";
  element("lives").setAttribute("aria-label", `${t("lives")} ${game.lives}`);
  element("overlay").hidden = game.phase === "running";
  element("pause").disabled = !["running", "paused"].includes(game.phase);
  element("pause").textContent = t(
    game.phase === "paused" ? "resume" : "pause"
  );
  element("restart").disabled = !userReady;
  element("start").disabled = !userReady;
  let title = "readyTitle";
  let copy = "readyText";
  let button = "start";
  if (game.phase === "paused") {
    [title, copy, button] = ["pausedTitle", "pausedText", "resume"];
  } else if (game.phase === "lost" || game.phase === "won") {
    [title, copy, button] = [
      game.phase === "won" ? "wonTitle" : "lostTitle",
      "endText",
      "again",
    ];
  } else if (game.phase === "ready" && game.lives < 3) {
    [title, copy, button] = ["missTitle", "missText", "launch"];
  } else if (game.phase === "ready" && game.level > 1) {
    [title, copy, button] = ["nextTitle", "nextText", "launch"];
  }
  element("overlay-title").textContent = t(title, game);
  element("overlay-copy").textContent = t(copy, game);
  element("start").textContent = t(userReady ? button : "loading");
}

function start() {
  if (!userReady) {
    return;
  }
  if (["lost", "won"].includes(game.phase)) {
    game = createGame();
    savedScore = -1;
  }
  launchBall(game);
  trail = [];
  canvas.focus({ preventScroll: true });
  updateUI();
}

function pause() {
  if (game.phase === "running") {
    game.phase = "paused";
    keys.clear();
  } else if (game.phase === "paused") {
    start();
  }
  updateUI();
}

function restart() {
  if (!userReady) {
    return;
  }
  saveBest();
  game = createGame();
  savedScore = -1;
  particles = [];
  trail = [];
  keys.clear();
  updateUI();
}

async function refreshUser() {
  element("refresh-user").disabled = true;
  try {
    await host.connect();
    const previous = (await host.load("last-run")) as { score: number } | null;
    if (
      previous &&
      Number.isSafeInteger(previous.score) &&
      previous.score >= 0
    ) {
      element("notice").textContent = t("previous", { score: previous.score });
    }
  } finally {
    userReady = true;
    element("refresh-user").disabled = false;
    updateUI();
    await host.rendered();
  }
}

function frame(time: number) {
  const elapsed = Math.min(0.05, (time - (lastTime || time)) / 1000);
  lastTime = time;
  if (game.phase === "running" || game.phase === "ready") {
    const direction =
      Number(keys.has("ArrowRight") || keys.has("KeyD")) -
      Number(keys.has("ArrowLeft") || keys.has("KeyA"));
    movePaddle(game, game.paddle.x + direction * elapsed * 680);
  }
  let remaining = elapsed;
  while (remaining > 0 && game.phase === "running") {
    const delta = Math.min(remaining, 1 / 240);
    const event = step(game, delta);
    remaining -= delta;
    if (event?.type === "brick" && !reducedMotion) {
      for (let index = 0; index < 7; index++) {
        particles.push({
          x: event.x,
          y: event.y,
          vx: (Math.random() - 0.5) * 200,
          vy: (Math.random() - 0.5) * 140,
          life: 0.45,
          color: palette[event.row],
        });
      }
    }
    if (event?.type === "level" || (game.phase as Game["phase"]) === "lost") {
      saveBest();
    }
  }
  updateUI();
  draw(elapsed);
  frameId = requestAnimationFrame(frame);
}

element("start").addEventListener("click", start);
element("pause").addEventListener("click", pause);
element("restart").addEventListener("click", restart);
element("refresh-user").addEventListener("click", refreshUser);
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" && !event.buttons) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  movePaddle(game, ((event.clientX - rect.left) / rect.width) * WIDTH);
});
canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  const rect = canvas.getBoundingClientRect();
  movePaddle(game, ((event.clientX - rect.left) / rect.width) * WIDTH);
  if (game.phase === "ready") {
    start();
  }
});
window.addEventListener("keydown", (event) => {
  if (
    (event.target as HTMLElement).closest?.("button, input, textarea, select")
  ) {
    return;
  }
  if (
    ["ArrowLeft", "ArrowRight", "KeyA", "KeyD", "Space", "KeyP"].includes(
      event.code
    )
  ) {
    event.preventDefault();
    keys.add(event.code);
  }
  if (!event.repeat && (event.code === "Space" || event.code === "KeyP")) {
    game.phase === "running" ? pause() : start();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => {
  keys.clear();
  if (game.phase === "running") {
    pause();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.phase === "running") {
    pause();
  }
});
updateUI();
frameId = requestAnimationFrame(frame);
void refreshUser();
window.addEventListener("pagehide", () => {
  cancelAnimationFrame(frameId);
  host.dispose();
});
