import { describe, expect, test } from "bun:test";
import { CELLS, SIZE, areAdjacent, createBoard, createGame, findMatches, hasMoves, knockOut, move, restoreGame, snapshotGame } from "../src/engine.ts";

describe("match-three rules", () => {
  test("mallet removes a selected candy, triggers specials, and spends exactly one move", () => {
    const game = createGame(() => 0.2);
    const index = 27;
    const before = game.score;
    const result = knockOut(game, index, () => 0.6);
    expect(result.changed).toBe(true);
    expect(game.moves).toBe(1);
    expect(game.score).toBeGreaterThan(before);
    expect(game.board[index]).toBeGreaterThanOrEqual(0);
    expect(knockOut(game, -1).changed).toBe(false);
  });
  test("creates a full board without an initial match and with a possible move", () => {
    const board = createBoard(() => 0.17);
    expect(board).toHaveLength(CELLS);
    expect(findMatches(board)).toEqual([]);
    expect(hasMoves(board)).toBe(true);
  });
  test("rejects a non-matching swap without spending a move", () => {
    const game = createGame(() => 0.2);
    const first = game.board.findIndex((_, index) => {
      if (index % 8 === 7) return false;
      const board = [...game.board];
      [board[index], board[index + 1]] = [board[index + 1], board[index]];
      return !findMatches(board).length;
    });
    expect(first).toBeGreaterThanOrEqual(0);
    const before = [...game.board];
    const result = move(game, first, first + 1, () => 0.4);
    expect(result.changed).toBe(false);
    expect(game.board).toEqual(before);
    expect(game.moves).toBe(0);
    expect(result.cascades).toEqual([]);
  });
  test("clears matches, awards points, and refills columns", () => {
    const game = createGame(() => 0.2);
    game.board = Array.from({ length: CELLS }, (_, index) => (Math.floor(index / 8) + index % 8) % 6);
    game.board[0] = 1; game.board[1] = 2; game.board[2] = 1; game.board[3] = 1;
    game.board[9] = 1;
    const result = move(game, 1, 9, () => 0.8);
    expect(result.changed).toBe(true);
    expect(result.matched).toBeGreaterThanOrEqual(3);
    expect(result.points).toBeGreaterThan(0);
    expect(game.moves).toBe(1);
    expect(game.board.every((value) => value >= 0 && value < 6)).toBe(true);
  });
  test("validates and restores saved progress", () => {
    const game = createGame(() => 0.3);
    const snapshot = snapshotGame(game);
    expect(restoreGame(snapshot)?.board).toEqual(game.board);
    expect(restoreGame({ ...snapshot, board: [9, ...snapshot.board.slice(1)] })).toBeNull();
    expect(restoreGame({ ...snapshot, board: [snapshot.board[0], snapshot.board[0], snapshot.board[0], ...snapshot.board.slice(3)] })).toBeNull();
  });
  test("animation frames preserve each cascade, its score and the actual fall origins", () => {
    let seed = 42;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const game = createGame(random);
    const initial = [...game.board];
    let pair: [number, number] | undefined;
    for (let index = 0; index < CELLS && !pair; index++) {
      for (const other of [index + 1, index + SIZE]) {
        if (!areAdjacent(index, other)) continue;
        const swapped = [...initial];
        [swapped[index], swapped[other]] = [swapped[other], swapped[index]];
        if (findMatches(swapped).length) { pair = [index, other]; break; }
      }
    }
    expect(pair).toBeDefined();
    const [first, second] = pair!;
    const result = move(game, first, second, random);
    const expected = [...initial];
    [expected[first], expected[second]] = [expected[second], expected[first]];
    expect(result.cascades[0].before).toEqual(expected);
    expect(result.cascades.length).toBe(result.combo);
    expect(result.cascades.reduce((sum, step) => sum + step.points, 0)).toBe(game.score);
    for (const [position, step] of result.cascades.entries()) {
      expect(findMatches(step.before)).toEqual([...step.matches, ...step.created.map(({ fromIndex }) => fromIndex)].sort((a, b) => a - b));
      expect(step.points).toBe((step.matches.length + step.created.length) * 10 * (position + 1));
      if (position > 0) expect(step.before).toEqual(result.cascades[position - 1].after);
      for (let column = 0; column < SIZE; column++) {
        const survivors = Array.from({ length: SIZE }, (_, row) => row * SIZE + column)
          .filter((index) => !step.matches.includes(index));
        for (let row = 0; row < SIZE; row++) {
          const index = row * SIZE + column;
          const fall = step.falls.find((entry) => entry.index === index);
          const survivorPosition = row - (SIZE - survivors.length);
          if (survivorPosition < 0) {
            expect(fall!.fromRow).toBeLessThan(0);
          } else {
            const origin = survivors[survivorPosition];
            expect(step.after[index]).toBe(step.before[origin]);
            if (origin !== index) expect(fall!.fromRow).toBe(Math.floor(origin / SIZE));
            else expect(fall).toBeUndefined();
          }
        }
      }
    }
    const frame = [...result.cascades[0].before];
    game.board.fill(0);
    expect(result.cascades[0].before).toEqual(frame);
    expect(findMatches(result.cascades.at(-1)!.after)).toEqual([]);
  });
});
