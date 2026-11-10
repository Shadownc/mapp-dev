import { describe, expect, test } from "bun:test";
import {
  canMove,
  createGame,
  mergeLine,
  move,
  restoreGame,
  slide,
  snapshotGame,
} from "../src/engine.ts";

describe("2048 rules", () => {
  test("merges each tile only once per move", () => {
    expect(mergeLine([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], points: 8 });
    expect(mergeLine([2, 2, 4, 0])).toEqual({ line: [4, 4, 0, 0], points: 4 });
    expect(mergeLine([0, 4, 0, 4])).toEqual({ line: [8, 0, 0, 0], points: 8 });
  });
  test("merges toward the requested edge", () => {
    const board = [2, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(slide(board, "right").board.slice(0, 4)).toEqual([0, 0, 0, 4]);
    expect(slide(board, "up").board[0]).toBe(4);
    expect(slide(board, "down").board[12]).toBe(4);
    expect(board[0]).toBe(2);
  });
  test("does not spawn a tile or award points for an unchanged move", () => {
    const game = createGame(() => 0);
    game.board = [2, 4, 0, 0, ...Array<number>(12).fill(0)];
    const before = [...game.board];
    expect(move(game, "left", () => 0)).toBe(false);
    expect(game.board).toEqual(before);
    expect(game.moves).toBe(0);
  });
  test("adds one tile after a valid move and tracks score", () => {
    const game = createGame(() => 0);
    expect(move(game, "left", () => 0)).toBe(true);
    expect(game.score).toBe(4);
    expect(game.board.filter(Boolean).length).toBe(2);
  });
  test("detects winning and full boards without moves", () => {
    const game = createGame(() => 0);
    game.board = [1024, 1024, ...Array<number>(14).fill(0)];
    move(game, "left", () => 0);
    expect(game.won).toBe(true);
    expect(game.score).toBe(2048);
    expect(canMove([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])).toBe(
      false
    );
    expect(canMove([2, 2, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])).toBe(
      true
    );
  });

  test("restores a validated copy and derives terminal state from the tiles", () => {
    const game = createGame(() => 0);
    game.board = [2048, 2, ...Array<number>(14).fill(0)];
    const snapshot = snapshotGame(game);
    const restored = restoreGame({ ...snapshot, won: false, over: true });
    expect(restored!.won).toBe(true);
    expect(restored!.over).toBe(false);
    restored!.board[0] = 4;
    expect(snapshot.board[0]).toBe(2048);
  });

  test("ignores malformed saved progress", () => {
    const snapshot = snapshotGame(createGame(() => 0));
    for (const invalid of [
      null,
      {},
      { ...snapshot, board: [2, 2] },
      { ...snapshot, score: -1 },
      { ...snapshot, board: [3, 2, ...Array<number>(14).fill(0)] },
      { ...snapshot, moves: Infinity },
    ]) {
      expect(restoreGame(invalid)).toBeNull();
    }
  });
});
