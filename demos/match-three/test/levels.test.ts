import { describe, expect, test } from "bun:test";
import { CELLS, COLORS, SIZE, activateSpecial, createGame, findMatches, move, nextLevel, restoreGame, snapshotGame, startLevel } from "../src/engine.ts";
import { LEVELS, getLevel, objectiveProgress } from "../src/levels.ts";

function seeded(seed = 37) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function plainGame(level = 1, completed = level - 1) {
  const game = createGame(seeded(), level, completed);
  game.board = Array.from({ length: CELLS }, (_, index) => (Math.floor(index / SIZE) + index % SIZE) % COLORS);
  return game;
}

describe("seven-level campaign", () => {
  test("exactly seven levels have valid, unique color targets and move limits", () => {
    expect(LEVELS).toHaveLength(7);
    for (const [index, level] of LEVELS.entries()) {
      expect(level.id).toBe(index + 1);
      expect(level.moves).toBeGreaterThan(0);
      expect(level.targets.length).toBeGreaterThan(0);
      expect(new Set(level.targets.map(({ color }) => color)).size).toBe(level.targets.length);
      for (const { color, count } of level.targets) {
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThan(COLORS);
        expect(count).toBeGreaterThan(0);
      }
    }
    expect(() => createGame(seeded(), 8, 7)).toThrow();
    expect(() => createGame(seeded(), 2, 0)).toThrow();
  });

  test("non-target colors and high scores do not complete objectives", () => {
    const game = plainGame();
    for (const index of [24, 25, 26]) game.board[index] = 1;
    game.score = 5000;
    move(game, 62, 63, () => .45);
    expect(game.collected[1]).toBeGreaterThanOrEqual(3);
    expect(game.collected[0]).toBe(0);
    expect(game.won).toBe(false);
    expect(game.completed).toBe(0);
    expect(objectiveProgress(1, game.collected).current).toBe(0);
  });

  test("a natural target-color match counts actual removals, not the surviving reward", () => {
    const game = plainGame(2);
    game.board[18] = 1;
    for (let col = 0; col < 4; col++) game.board[24 + col] = col === 2 ? 2 : 1;
    game.board[28] = 3;
    const result = move(game, 18, 26, seeded());
    const step = result.cascades[0];
    expect(step.created).toHaveLength(1);
    expect(step.collected[1]).toBe(3);
    expect(step.collected.reduce((sum, count) => sum + count, 0)).toBe(step.matches.length);
    const totals = Array<number>(COLORS).fill(0);
    for (const frame of result.cascades) for (let color = 0; color < COLORS; color++) totals[color] += frame.collected[color];
    expect(game.collected).toEqual(totals);
  });

  test("overlapping explosions count every removed candy once by its original color", () => {
    const game = plainGame(7);
    game.specials[27] = "row";
    game.specials[29] = "column";
    game.specials[45] = "area";
    const result = activateSpecial(game, 27, seeded());
    const step = result.cascades[0];
    const expected = Array<number>(COLORS).fill(0);
    for (const index of step.matches) expected[step.before[index]]++;
    expect(step.collected).toEqual(expected);
    expect(step.collected.reduce((sum, count) => sum + count, 0)).toBe(new Set(step.matches).size);
    expect(game.moves).toBe(1);
  });

  test("completing the target on the last move wins and unlocks exactly the next level", () => {
    const game = plainGame();
    game.collected[0] = 11;
    game.moves = getLevel(1).moves - 1;
    game.specials[27] = "row";
    activateSpecial(game, 27, seeded());
    expect(game.won).toBe(true);
    expect(game.over).toBe(false);
    expect(game.moves).toBe(getLevel(1).moves);
    expect(game.completed).toBe(1);
    expect(startLevel(game, 3)).toBeNull();
    const next = nextLevel(game, seeded())!;
    expect(next.level).toBe(2);
    expect(next.completed).toBe(1);
    expect(next.moves).toBe(0);
    expect(next.score).toBe(0);
    expect(next.collected).toEqual(Array(COLORS).fill(0));
    expect(next.specials.every((special) => special === null)).toBe(true);
    expect(findMatches(next.board)).toEqual([]);
    const before = snapshotGame(game);
    expect(move(game, 0, 1).changed).toBe(false);
    expect(activateSpecial(game, 27).changed).toBe(false);
    expect(snapshotGame(game)).toEqual(before);
  });

  test("running out of moves with missing targets loses and retry keeps unlocks", () => {
    const game = plainGame(3);
    game.moves = getLevel(3).moves - 1;
    game.specials[27] = "row";
    activateSpecial(game, 27, seeded());
    expect(game.over).toBe(true);
    expect(game.won).toBe(false);
    expect(game.completed).toBe(2);
    expect(nextLevel(game)).toBeNull();
    const retry = startLevel(game, 3, seeded())!;
    expect(retry.moves).toBe(0);
    expect(retry.completed).toBe(2);
    expect(retry.over).toBe(false);
    expect(retry.collected).toEqual(Array(COLORS).fill(0));
  });

  test("all requested colors must finish, and over-collecting one color cannot fill another", () => {
    const game = plainGame(2);
    game.collected[1] = 100;
    game.specials[27] = "row";
    activateSpecial(game, 27, () => .9);
    expect(game.collected[2]).toBeLessThan(15);
    expect(game.won).toBe(false);
    const progress = objectiveProgress(2, [0, 100, 4, 100, 100, 100]);
    expect(progress).toEqual({ current: 19, total: 30 });
  });

  for (const level of LEVELS) {
    test(`level ${level.id} completes from its own targets and never creates level 8`, () => {
      const game = plainGame(level.id);
      for (const { color, count } of level.targets) game.collected[color] = count - 1;
      game.specials[27] = "row";
      activateSpecial(game, 27, seeded());
      expect(game.won).toBe(true);
      expect(game.completed).toBe(level.id);
      expect(restoreGame(snapshotGame(game))!.won).toBe(true);
      if (level.id === 7) {
        expect(nextLevel(game)).toBeNull();
        expect(startLevel(game, 8)).toBeNull();
        expect(startLevel(game, 1)!.completed).toBe(7);
      } else expect(nextLevel(game)!.level).toBe(level.id + 1);
    });
  }

  test("replaying a completed level never relocks later levels", () => {
    const game = plainGame(1, 5);
    game.collected[0] = 11;
    game.specials[27] = "row";
    activateSpecial(game, 27, seeded());
    expect(game.completed).toBe(5);
    expect(startLevel(game, 6)!.level).toBe(6);
    expect(startLevel(game, 7)).toBeNull();
  });
});

describe("campaign saves", () => {
  test("rebalanced saves keep unlocks and items even when old moves exceed the new limit", () => {
    const game = createGame(seeded(), 6, 5);
    game.specials[12] = "column";
    const saved = { ...snapshotGame(game), format: 3, moves: 28, score: 2500, collected: [23, 20, 0, 0, 0, 24] };
    const restored = restoreGame(saved)!;
    expect(restored.level).toBe(6);
    expect(restored.completed).toBe(5);
    expect(restored.board).toEqual(game.board);
    expect(restored.specials[12]).toBe("column");
    expect(restored.moves).toBe(0);
    expect(restored.score).toBe(0);
    expect(restored.collected).toEqual(Array(COLORS).fill(0));
    expect(restored.over).toBe(false);
    expect(restoreGame(snapshotGame(restored))).toEqual(restored);
    expect(restoreGame({ ...saved, level: 7, completed: 7 })!.completed).toBe(7);
    expect(restoreGame({ ...snapshotGame(game), campaign: 999 })).toBeNull();
  });
  test("current level, unlocks, counters and items round-trip without shared arrays", () => {
    const game = plainGame(5, 5);
    game.specials[27] = "row";
    game.moves = 7;
    game.collected = [8, 9, 10, 11, 12, 13];
    const saved = snapshotGame(game);
    const restored = restoreGame(saved)!;
    expect(restored.level).toBe(5);
    expect(restored.completed).toBe(5);
    expect(restored.collected).toEqual(game.collected);
    expect(restored.moves).toBe(7);
    expect(restored.specials[27]).toBe("row");
    game.collected[2] = 999;
    restored.collected[3] = 999;
    expect(saved.collected).toEqual([8, 9, 10, 11, 12, 13]);
  });

  test("invalid level progress, counters and move limits are rejected", () => {
    const saved = snapshotGame(createGame(seeded()));
    for (const patch of [
      { level: 0 }, { level: 8 }, { level: 1.5 }, { level: 2, completed: 0 },
      { completed: -1 }, { completed: 8 }, { collected: [] }, { collected: [0, 0, 0, 0, 0, -1] },
      { collected: [0, 0, 0, 0, 0, .5] }, { collected: [12, 0, 0, 0, 0, 0], completed: 0 },
      { moves: getLevel(1).moves + 1 }, { format: "3" },
    ]) expect(restoreGame({ ...saved, ...patch })).toBeNull();
  });

  for (const format of [1, 2]) {
    test(`legacy format ${format} starts fresh objectives while preserving board and available items`, () => {
      const old = createGame(seeded());
      old.specials[12] = "column";
      const saved = { format, board: old.board, specials: old.specials, score: 2500, moves: 45, continuing: true };
      const restored = restoreGame(saved)!;
      expect(restored.level).toBe(1);
      expect(restored.completed).toBe(0);
      expect(restored.collected).toEqual(Array(COLORS).fill(0));
      expect(restored.moves).toBe(0);
      expect(restored.score).toBe(0);
      expect(restored.won).toBe(false);
      expect(restored.board).toEqual(old.board);
      expect(restored.specials[12]).toBe(format === 2 ? "column" : null);
    });
  }
});
