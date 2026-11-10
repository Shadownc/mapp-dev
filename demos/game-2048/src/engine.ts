/** Mutable board and counters for a 2048 session. */
export interface Game {
  board: number[];
  score: number;
  moves: number;
  spawned: number;
  won: boolean;
  over: boolean;
}

/** Persistent progress; terminal flags are derived again when restoring. */
export interface SavedGame {
  format: 1;
  board: number[];
  score: number;
  moves: number;
}

export function mergeLine(line: number[]): { line: number[]; points: number } {
  const values = line.filter((value) => value !== 0);
  const result = [];
  let points = 0;
  for (let index = 0; index < values.length; index++) {
    if (values[index] === values[index + 1]) {
      const merged = values[index] * 2;
      result.push(merged);
      points += merged;
      index++;
    } else {
      result.push(values[index]);
    }
  }
  while (result.length < 4) {
    result.push(0);
  }
  return { line: result, points };
}

export function canMove(board: number[]): boolean {
  return board.some(
    (value, index) =>
      value === 0 ||
      (index % 4 < 3 && value === board[index + 1]) ||
      (index < 12 && value === board[index + 4])
  );
}

export function slide(board: number[], direction: string) {
  if (!["left", "right", "up", "down"].includes(direction)) {
    throw new Error("Invalid direction");
  }
  const next = [...board];
  let points = 0;
  for (let outer = 0; outer < 4; outer++) {
    const indices = Array.from({ length: 4 }, (_, inner) => {
      if (direction === "left") {
        return outer * 4 + inner;
      }
      if (direction === "right") {
        return outer * 4 + 3 - inner;
      }
      if (direction === "up") {
        return inner * 4 + outer;
      }
      return (3 - inner) * 4 + outer;
    });
    const merged = mergeLine(indices.map((index) => board[index]));
    points += merged.points;
    indices.forEach((index, position) => {
      next[index] = merged.line[position];
    });
  }
  return {
    board: next,
    points,
    changed: next.some((value, index) => value !== board[index]),
  };
}

export function spawn(board: number[], random = Math.random): number {
  const empty = board.flatMap((value, index) => (value === 0 ? [index] : []));
  if (!empty.length) {
    return -1;
  }
  const index = empty[Math.floor(random() * empty.length)];
  board[index] = random() < 0.9 ? 2 : 4;
  return index;
}

export function createGame(random = Math.random): Game {
  const board = Array<number>(16).fill(0);
  spawn(board, random);
  const spawned = spawn(board, random);
  return { board, score: 0, moves: 0, spawned, won: false, over: false };
}

export function move(
  game: Game,
  direction: string,
  random = Math.random
): boolean {
  if (game.over) {
    return false;
  }
  const result = slide(game.board, direction);
  if (!result.changed) {
    game.over = !canMove(game.board);
    return false;
  }
  game.board = result.board;
  game.score += result.points;
  game.moves++;
  game.spawned = spawn(game.board, random);
  game.won = game.won || game.board.some((value) => value >= 2048);
  game.over = !canMove(game.board);
  return true;
}

export function snapshotGame(game: Game): SavedGame {
  return {
    format: 1,
    board: [...game.board],
    score: game.score,
    moves: game.moves,
  };
}

export function restoreGame(value: unknown): Game | null {
  if (
    !value ||
    (value as SavedGame).format !== 1 ||
    !Array.isArray((value as SavedGame).board) ||
    (value as SavedGame).board.length !== 16 ||
    !(value as SavedGame).board.every(
      (tile) =>
        Number.isInteger(tile) &&
        tile >= 0 &&
        tile <= 2 ** 30 &&
        // eslint-disable-next-line no-bitwise -- Tile values must be powers of two.
        (tile === 0 || (tile >= 2 && (tile & (tile - 1)) === 0))
    ) ||
    !Number.isSafeInteger((value as SavedGame).score) ||
    (value as SavedGame).score < 0 ||
    (value as SavedGame).score > 1_000_000_000 ||
    !Number.isSafeInteger((value as SavedGame).moves) ||
    (value as SavedGame).moves < 0 ||
    (value as SavedGame).moves > 1_000_000_000
  ) {
    return null;
  }
  const board = [...(value as SavedGame).board];
  if (board.filter(Boolean).length < 2) {
    return null;
  }
  return {
    board,
    score: (value as SavedGame).score,
    moves: (value as SavedGame).moves,
    spawned: -1,
    won: board.some((tile) => tile >= 2048),
    over: !canMove(board),
  };
}
