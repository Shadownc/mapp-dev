import { describe, expect, test } from "bun:test";
import {
  createGame,
  HEIGHT,
  launchBall,
  movePaddle,
  step,
  WIDTH,
} from "../src/physics.ts";

describe("breakout physics", () => {
  test("keeps the paddle and attached ball inside the court", () => {
    const game = createGame();
    movePaddle(game, WIDTH * 2);
    expect(game.paddle.x + game.paddle.width / 2).toBeLessThan(WIDTH);
    expect(game.ball.x).toBe(game.paddle.x);
  });

  test("rebounds from walls and a paddle hit", () => {
    const game = createGame();
    launchBall(game);
    Object.assign(game.ball, { x: 10, y: 400, vx: -300, vy: 0 });
    step(game, 0.01);
    expect(game.ball.vx).toBeGreaterThan(0);
    Object.assign(game.ball, {
      x: game.paddle.x,
      y: game.paddle.y - 10,
      vx: 0,
      vy: 400,
    });
    expect(step(game, 0.01)!.type).toBe("paddle");
    expect(game.ball.vy).toBeLessThan(0);
  });

  test("removes a brick and awards its points", () => {
    const game = createGame();
    launchBall(game);
    const brick = game.bricks[0];
    Object.assign(game.ball, {
      x: brick.x + 30,
      y: brick.y - 9,
      vx: 0,
      vy: 300,
    });
    expect(step(game, 0.01)!.type).toBe("brick");
    expect(brick.alive).toBe(false);
    expect(game.score).toBe(brick.points);
  });

  test("loses lives and eventually ends the game", () => {
    const game = createGame();
    for (let remaining = 2; remaining >= 0; remaining--) {
      launchBall(game);
      game.ball.y = HEIGHT + 20;
      step(game, 0.01);
      expect(game.lives).toBe(remaining);
    }
    expect(game.phase).toBe("lost");
  });

  test("clearing the last brick advances the level and eventually wins", () => {
    const game = createGame();
    for (let level = 1; level <= 3; level++) {
      launchBall(game);
      game.bricks.forEach((brick, index) => {
        brick.alive = index === 0;
      });
      const brick = game.bricks[0];
      Object.assign(game.ball, {
        x: brick.x + 30,
        y: brick.y - 9,
        vx: 0,
        vy: 300,
      });
      expect(step(game, 0.01)!.type).toBe("level");
    }
    expect(game.phase).toBe("won");
  });

  test("pausing freezes physics until launch resumes the game", () => {
    const game = createGame();
    launchBall(game);
    game.phase = "paused";
    const before = structuredClone(game);
    step(game, 0.05);
    expect(game).toEqual(before);
    launchBall(game);
    step(game, 0.01);
    expect(game.ball.y).toBeLessThan(before.ball.y);
  });
});
