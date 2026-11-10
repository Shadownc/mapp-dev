/** Mutable state of the breakout simulation. */
export interface Game {
  phase: "ready" | "running" | "paused" | "won" | "lost";
  level: number;
  score: number;
  lives: number;
  paddle: { x: number; y: number; width: number; height: number };
  ball: { x: number; y: number; vx: number; vy: number; radius: number };
  bricks: Brick[];
}

/** A brick's collision bounds and score value. */
export interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  alive: boolean;
  points: number;
}

/** A collision or round transition produced by one physics step. */
export type StepEvent =
  | { type: "paddle" | "level"; x: number; y: number }
  | { type: "brick"; x: number; y: number; row: number }
  | { type: "miss" };

export const WIDTH = 960;
export const HEIGHT = 560;

export function createBricks(level: number): Brick[] {
  const bricks = [];
  const columns = 10;
  const rows = 4 + level;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      bricks.push({
        x: 30 + column * 91,
        y: 64 + row * 31,
        width: 81,
        height: 21,
        row,
        alive: true,
        points: (rows - row) * 10,
      });
    }
  }
  return bricks;
}

export function createGame(): Game {
  return {
    phase: "ready",
    level: 1,
    score: 0,
    lives: 3,
    paddle: { x: 480, y: 516, width: 132, height: 12 },
    ball: { x: 480, y: 504, vx: 190, vy: -340, radius: 7 },
    bricks: createBricks(1),
  };
}

export function movePaddle(game: Game, x: number): void {
  game.paddle.x = Math.max(
    game.paddle.width / 2 + 8,
    Math.min(WIDTH - game.paddle.width / 2 - 8, x)
  );
  if (game.phase === "ready") {
    game.ball.x = game.paddle.x;
  }
}

export function launchBall(game: Game): void {
  if (game.phase === "ready") {
    game.phase = "running";
  } else if (game.phase === "paused") {
    game.phase = "running";
  }
}

function resetBall(game: Game): void {
  game.ball.x = game.paddle.x;
  game.ball.y = game.paddle.y - game.ball.radius - 3;
  game.ball.vx = 190 + game.level * 15;
  game.ball.vy = -340 - game.level * 25;
}

export function step(game: Game, seconds: number): StepEvent | null {
  if (game.phase !== "running") {
    return null;
  }
  const ball = game.ball;
  const previousX = ball.x;
  const previousY = ball.y;
  ball.x += ball.vx * seconds;
  ball.y += ball.vy * seconds;
  if (ball.x < ball.radius + 8) {
    ball.x = ball.radius + 8;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x > WIDTH - ball.radius - 8) {
    ball.x = WIDTH - ball.radius - 8;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y < ball.radius + 8) {
    ball.y = ball.radius + 8;
    ball.vy = Math.abs(ball.vy);
  }
  const paddle = game.paddle;
  if (
    ball.vy > 0 &&
    previousY + ball.radius <= paddle.y &&
    ball.y + ball.radius >= paddle.y &&
    ball.x >= paddle.x - paddle.width / 2 - ball.radius &&
    ball.x <= paddle.x + paddle.width / 2 + ball.radius
  ) {
    const ratio = Math.max(
      -1,
      Math.min(1, (ball.x - paddle.x) / (paddle.width / 2))
    );
    const angle = (ratio * Math.PI) / 3;
    const speed = Math.min(650, Math.hypot(ball.vx, ball.vy) + 6);
    ball.vx = Math.sin(angle) * speed;
    if (Math.abs(ball.vx) < 55) {
      ball.vx = (ball.vx < 0 ? -1 : 1) * 55;
    }
    ball.vy = -Math.sqrt(speed * speed - ball.vx * ball.vx);
    ball.y = paddle.y - ball.radius - 1;
    return { type: "paddle", x: ball.x, y: paddle.y };
  }
  for (const brick of game.bricks) {
    if (!brick.alive) {
      continue;
    }
    const nearX = Math.max(brick.x, Math.min(brick.x + brick.width, ball.x));
    const nearY = Math.max(brick.y, Math.min(brick.y + brick.height, ball.y));
    if ((ball.x - nearX) ** 2 + (ball.y - nearY) ** 2 > ball.radius ** 2) {
      continue;
    }
    brick.alive = false;
    game.score += brick.points;
    if (
      previousY + ball.radius <= brick.y ||
      previousY - ball.radius >= brick.y + brick.height
    ) {
      ball.vy *= -1;
      ball.y = previousY;
    } else {
      ball.vx *= -1;
      ball.x = previousX;
    }
    if (!game.bricks.some((item) => item.alive)) {
      if (game.level === 3) {
        game.phase = "won";
      } else {
        game.level++;
        game.bricks = createBricks(game.level);
        game.phase = "ready";
        resetBall(game);
      }
      return { type: "level", x: ball.x, y: ball.y };
    }
    return {
      type: "brick",
      x: brick.x + brick.width / 2,
      y: brick.y,
      row: brick.row,
    };
  }
  if (ball.y - ball.radius > HEIGHT) {
    game.lives--;
    game.phase = game.lives > 0 ? "ready" : "lost";
    resetBall(game);
    return { type: "miss" };
  }
  return null;
}
