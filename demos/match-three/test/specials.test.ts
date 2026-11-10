import { describe, expect, test } from "bun:test";
import {
  CELLS, SIZE, SPECIAL_TYPES, activateSpecial, areAdjacent, createGame,
  findMatchGroups, findMatches, hasMoves, move, restoreGame, snapshotGame, specialTargets,
} from "../src/engine.ts";
import type { Special } from "../src/engine.ts";
import { getLevel } from "../src/levels.ts";

function seeded(seed = 37) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function plainGame() {
  const game = createGame(seeded());
  game.board = Array.from({ length: CELLS }, (_, index) => (Math.floor(index / SIZE) + index % SIZE) % 6);
  return game;
}

function rewardGame(length: number, vertical = false) {
  const game = plainGame();
  game.board[18] = 1;
  for (let col = 0; col < length; col++) game.board[24 + col] = col === 2 ? 2 : 1;
  if (length === 4) game.board[28] = 3;
  const transpose = (index: number) => index % SIZE * SIZE + Math.floor(index / SIZE);
  if (vertical) game.board = game.board.map((_, index, board) => board[transpose(index)]);
  expect(findMatches(game.board)).toEqual([]);
  return { game, first: vertical ? transpose(18) : 18, second: vertical ? transpose(26) : 26 };
}

function chooseSpecial(type: Special) {
  const rest = seeded();
  let first = true;
  return () => {
    if (first) { first = false; return (SPECIAL_TYPES.indexOf(type) + .5) / SPECIAL_TYPES.length; }
    return rest();
  };
}

describe("special candy rewards", () => {
  for (const length of [4, 5]) for (const type of SPECIAL_TYPES) for (const vertical of [false, true]) {
    test(`${length}-match ${vertical ? "vertical" : "horizontal"} can award ${type}`, () => {
      const { game, first, second } = rewardGame(length, vertical);
      const result = move(game, first, second, chooseSpecial(type));
      const step = result.cascades[0];
      expect(result.changed).toBe(true);
      expect(step.created).toHaveLength(1);
      const reward = step.created[0];
      expect(reward.type).toBe(type);
      expect(reward.fromIndex).toBe(second);
      expect(step.specialsAfter[reward.index]).toBe(type);
      expect(step.after[reward.index]).toBe(step.before[second]);
      expect(step.matches).not.toContain(second);
      expect(step.matches).toHaveLength(length - 1);
      expect(step.points).toBe(length * 10);
      expect(step.activated).toEqual([]);
      expect(game.moves).toBe(1);
      expect(findMatches(game.board)).toEqual([]);
    });
  }

  test("unrelated triples do not earn a reward, even when six cells clear at once", () => {
    const game = plainGame();
    for (const index of [0, 1, 2]) game.board[index] = 5;
    for (const index of [40, 41, 42]) game.board[index] = 3;
    expect(findMatchGroups(game.board).map((group) => group.length)).toEqual([3, 3]);
    const step = move(game, 62, 63, seeded()).cascades[0];
    expect(step.matches).toHaveLength(6);
    expect(step.created).toEqual([]);
  });

  test("intersecting runs award one special; separate long runs award one each", () => {
    const game = plainGame();
    for (const index of [26, 27, 28, 19, 35]) game.board[index] = 0;
    expect(findMatchGroups(game.board)).toEqual([[19, 26, 27, 28, 35]]);
    expect(move(game, 62, 63, seeded()).cascades[0].created).toHaveLength(1);
    const separate = plainGame();
    for (const index of [0, 1, 2, 3]) separate.board[index] = 5;
    for (const index of [40, 41, 42, 43]) separate.board[index] = 3;
    expect(move(separate, 62, 63, seeded()).cascades[0].created).toHaveLength(2);
  });

  test("normal play can earn rewards from later cascades and every completed state remains restorable", () => {
    const random = seeded(1);
    const game = createGame(random);
    let cascadeReward = false;
    for (let turn = 0; turn < 12 && !game.over && !game.won; turn++) {
      const special = game.specials.findIndex(Boolean);
      let pair: [number, number] | undefined;
      for (let index = 0; special < 0 && index < CELLS && !pair; index++) {
        for (const other of [index + 1, index + SIZE]) {
          if (!areAdjacent(index, other)) continue;
          const swapped = [...game.board];
          [swapped[index], swapped[other]] = [swapped[other], swapped[index]];
          if (findMatches(swapped).length) { pair = [index, other]; break; }
        }
      }
      const result = special >= 0 ? activateSpecial(game, special, random) : move(game, pair![0], pair![1], random);
      expect(result.changed).toBe(true);
      for (const step of result.cascades) {
        expect(new Set(step.matches).size).toBe(step.matches.length);
        expect(new Set(step.activated.map(({ index }) => index)).size).toBe(step.activated.length);
        for (const reward of step.created) expect(step.specialsAfter[reward.index]).toBe(reward.type);
        cascadeReward ||= step.combo > 1 && step.created.length > 0;
      }
      expect(restoreGame(snapshotGame(game))!.specials).toEqual(game.specials);
      expect(findMatches(game.board)).toEqual([]);
    }
    expect(cascadeReward).toBe(true);
  });
});

describe("special candy activation", () => {
  for (const type of SPECIAL_TYPES) {
    test(`${type} clears its exact footprint and costs one move`, () => {
      const game = plainGame();
      game.specials[27] = type;
      const result = activateSpecial(game, 27, seeded());
      const step = result.cascades[0];
      expect(step.matches).toEqual(specialTargets(27, type).sort((a, b) => a - b));
      expect(step.activated).toEqual([{ index: 27, type }]);
      expect(step.created).toEqual([]);
      expect(step.points).toBe((type === "area" ? 9 : 8) * 10);
      expect(game.moves).toBe(1);
      expect(game.score).toBe(result.cascades.reduce((sum, frame) => sum + frame.points, 0));
      expect(game.board).toHaveLength(CELLS);
      expect(findMatches(game.board)).toEqual([]);
    });
  }

  test("area blasts clip at edges instead of wrapping into the next row", () => {
    expect(specialTargets(0, "area")).toEqual([0, 1, 8, 9]);
    expect(specialTargets(63, "area")).toEqual([54, 55, 62, 63]);
    expect(specialTargets(7, "area")).toEqual([6, 7, 14, 15]);
    expect(specialTargets(-1, "area")).toEqual([]);
  });

  test("overlapping specials chain once each and score every affected cell once", () => {
    const game = plainGame();
    game.specials[27] = "row";
    game.specials[29] = "column";
    game.specials[45] = "area";
    const result = activateSpecial(game, 27, seeded());
    const step = result.cascades[0];
    const expected = [...new Set([...specialTargets(27, "row"), ...specialTargets(29, "column"), ...specialTargets(45, "area")])].sort((a, b) => a - b);
    expect(step.matches).toEqual(expected);
    expect(step.activated).toEqual([{ index: 27, type: "row" }, { index: 29, type: "column" }, { index: 45, type: "area" }]);
    expect(step.points).toBe(expected.length * 10);
    expect(game.moves).toBe(1);
  });

  test("a special inside a natural match detonates and a new reward survives that wave", () => {
    const { game, first, second } = rewardGame(4);
    game.specials[24] = "row";
    const step = move(game, first, second, chooseSpecial("area")).cascades[0];
    expect(step.activated).toEqual([{ index: 24, type: "row" }]);
    expect(step.matches).toEqual([24, 25, 27, 28, 29, 30, 31]);
    expect(step.points).toBe(80);
    expect(step.created[0].type).toBe("area");
    expect(step.specialsAfter[step.created[0].index]).toBe("area");
  });

  test("swapping a special detonates it at its new position without requiring a match", () => {
    const game = plainGame();
    game.specials[27] = "column";
    const step = move(game, 27, 28, seeded()).cascades[0];
    expect(step.activated).toEqual([{ index: 28, type: "column" }]);
    expect(step.matches).toEqual(specialTargets(28, "column"));
    expect(step.specialsBefore[27]).toBeNull();
    expect(game.moves).toBe(1);
  });

  test("surviving special candies fall with their original color", () => {
    const game = plainGame();
    game.specials[24] = "row";
    game.specials[2] = "area";
    const color = game.board[2];
    const step = activateSpecial(game, 24, seeded()).cascades[0];
    expect(step.specialsAfter[10]).toBe("area");
    expect(step.after[10]).toBe(color);
    expect(step.specialsAfter[2]).toBeNull();
    expect(step.falls).toContainEqual({ index: 10, fromRow: 0 });
  });

  test("invalid activation and finished games do not consume moves or specials", () => {
    const game = plainGame();
    game.specials[27] = "row";
    for (const index of [-1, 64, 1.5, NaN, 0]) expect(activateSpecial(game, index).changed).toBe(false);
    game.over = true;
    expect(activateSpecial(game, 27).changed).toBe(false);
    expect(move(game, 27, 28).changed).toBe(false);
    expect(game.moves).toBe(0);
    expect(game.specials[27]).toBe("row");
  });
});

describe("special candy saves", () => {
  test("new saves round-trip with completed objectives and old saves migrate to level 1", () => {
    const game = createGame(seeded());
    game.specials[12] = "area";
    game.specials[35] = "column";
    game.score = 200;
    game.moves = 10;
    game.collected[0] = getLevel(1).targets[0].count;
    game.completed = 1;
    const saved = snapshotGame(game);
    const restored = restoreGame(saved)!;
    expect(restored.specials).toEqual(game.specials);
    expect(restored.board).toEqual(game.board);
    expect(restored.won).toBe(true);
    expect(restored.moves).toBe(10);
    game.specials[12] = null;
    expect(saved.specials[12]).toBe("area");
    restored.specials[35] = null;
    expect(saved.specials[35]).toBe("column");
    expect(restoreGame({ format: 1, board: saved.board, score: 20, moves: 2 })!.specials.every((value) => value === null)).toBe(true);
  });

  test("corrupt special data is rejected", () => {
    const saved = snapshotGame(createGame(seeded()));
    for (const specials of [undefined, [], "row", [...saved.specials.slice(1), "invalid"], [...saved.specials.slice(1), 1]]) {
      expect(restoreGame({ ...saved, specials })).toBeNull();
    }
    expect(restoreGame({ ...saved, moves: getLevel(1).moves + 1 })).toBeNull();
  });

  test("a clickable special keeps an otherwise dead board playable and restorable", () => {
    const game = plainGame();
    expect(hasMoves(game.board)).toBe(false);
    game.specials[27] = "row";
    expect(hasMoves(game.board, game.specials)).toBe(true);
    expect(restoreGame(snapshotGame(game))!.specials[27]).toBe("row");
  });
});
