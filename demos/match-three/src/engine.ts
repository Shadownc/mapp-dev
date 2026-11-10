import { CAMPAIGN_VERSION, LEVELS, getLevel, objectivesComplete } from "./levels.ts";

export const SIZE = 8;
export const CELLS = SIZE * SIZE;
export const COLORS = 6;

export type Random = () => number;
export const SPECIAL_TYPES = ["area", "row", "column"] as const;
export type Special = typeof SPECIAL_TYPES[number];
export type Specials = Array<Special | null>;

export interface SpecialEvent {
  index: number;
  type: Special;
}

export interface SpecialCreated extends SpecialEvent {
  /** Cell that turned into a power-up, before gravity moved it to index. */
  fromIndex: number;
}

export interface Game {
  level: number;
  /** Number of consecutively completed levels; replaying never reduces this. */
  completed: number;
  collected: number[];
  board: number[];
  specials: Specials;
  score: number;
  moves: number;
  combo: number;
  won: boolean;
  over: boolean;
  selected: number;
  lastMatches: number[];
}

export interface SavedGame {
  format: 4;
  campaign: number;
  level: number;
  completed: number;
  collected: number[];
  board: number[];
  specials: Specials;
  score: number;
  moves: number;
}

const randomColor = (random: Random) => Math.min(COLORS - 1, Math.floor(random() * COLORS));

export function indexOf(row: number, column: number): number {
  return row * SIZE + column;
}

export function areAdjacent(first: number, second: number): boolean {
  if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || first >= CELLS || second < 0 || second >= CELLS) return false;
  const rowA = Math.floor(first / SIZE);
  const rowB = Math.floor(second / SIZE);
  const columnA = first % SIZE;
  const columnB = second % SIZE;
  return Math.abs(rowA - rowB) + Math.abs(columnA - columnB) === 1;
}

/** Merge intersecting runs, but keep unrelated triples as separate reward groups. */
export function findMatchGroups(board: number[]): number[][] {
  if (board.length !== CELLS) throw new Error("Invalid board length");
  const groups: Set<number>[] = [];
  const addRun = (run: number[]) => {
    const group = new Set(run);
    for (let index = groups.length - 1; index >= 0; index--) {
      if (![...groups[index]].some((cell) => group.has(cell))) continue;
      for (const cell of groups[index]) group.add(cell);
      groups.splice(index, 1);
    }
    groups.push(group);
  };
  for (let row = 0; row < SIZE; row++) {
    let start = 0;
    while (start < SIZE) {
      const value = board[indexOf(row, start)];
      let end = start + 1;
      while (end < SIZE && board[indexOf(row, end)] === value) end++;
      if (value >= 0 && end - start >= 3) {
        addRun(Array.from({ length: end - start }, (_, offset) => indexOf(row, start + offset)));
      }
      start = end;
    }
  }
  for (let column = 0; column < SIZE; column++) {
    let start = 0;
    while (start < SIZE) {
      const value = board[indexOf(start, column)];
      let end = start + 1;
      while (end < SIZE && board[indexOf(end, column)] === value) end++;
      if (value >= 0 && end - start >= 3) {
        addRun(Array.from({ length: end - start }, (_, offset) => indexOf(start + offset, column)));
      }
      start = end;
    }
  }
  return groups.map((group) => [...group].sort((a, b) => a - b));
}

/** Return every cell participating in a horizontal or vertical run of 3+. */
export function findMatches(board: number[]): number[] {
  return findMatchGroups(board).flat().sort((a, b) => a - b);
}

function createCandidate(random: Random): number[] {
  const board = Array<number>(CELLS).fill(0);
  for (let row = 0; row < SIZE; row++) {
    for (let column = 0; column < SIZE; column++) {
      const choices = Array.from({ length: COLORS }, (_, value) => value).filter((value) => {
        if (column >= 2 && board[indexOf(row, column - 1)] === value && board[indexOf(row, column - 2)] === value) return false;
        if (row >= 2 && board[indexOf(row - 1, column)] === value && board[indexOf(row - 2, column)] === value) return false;
        return true;
      });
      board[indexOf(row, column)] = choices[Math.floor(random() * choices.length)] ?? 0;
    }
  }
  return board;
}

export function hasMoves(board: number[], specials?: Specials): boolean {
  if (board.length !== CELLS) return false;
  if (specials?.some((special) => special !== null)) return true;
  for (let index = 0; index < CELLS; index++) {
    for (const other of [index + 1, index + SIZE]) {
      if (!areAdjacent(index, other)) continue;
      [board[index], board[other]] = [board[other], board[index]];
      const match = findMatches(board).length > 0;
      [board[index], board[other]] = [board[other], board[index]];
      if (match) return true;
    }
  }
  return false;
}

export function createBoard(random: Random = Math.random): number[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const board = createCandidate(random);
    if (hasMoves(board)) return board;
  }
  // A deterministic fallback keeps startup reliable even with a pathological RNG.
  const fallback = Array.from({ length: CELLS }, (_, index) => (Math.floor(index / SIZE) + index) % COLORS);
  // Guaranteed playable fallback: swap cells 1 and 9. Never leave the supplied RNG.
  fallback[0] = 1; fallback[1] = 2; fallback[2] = 1; fallback[3] = 1; fallback[9] = 1;
  return fallback;
}

export function createGame(random: Random = Math.random, level = 1, completed = 0): Game {
  getLevel(level);
  if (!Number.isInteger(completed) || completed < 0 || completed > LEVELS.length || level > completed + 1) throw new Error("Level is locked");
  return {
    level,
    completed,
    collected: Array<number>(COLORS).fill(0),
    board: createBoard(random),
    specials: Array<Special | null>(CELLS).fill(null),
    score: 0,
    moves: 0,
    combo: 0,
    won: false,
    over: false,
    selected: -1,
    lastMatches: [],
  };
}

export function startLevel(game: Game, level: number, random: Random = Math.random): Game | null {
  if (!Number.isInteger(level) || level < 1 || level > LEVELS.length || level > game.completed + 1) return null;
  return createGame(random, level, game.completed);
}

export function nextLevel(game: Game, random: Random = Math.random): Game | null {
  return game.won && game.level < LEVELS.length ? startLevel(game, game.level + 1, random) : null;
}

export interface CandyFall {
  index: number;
  /** A negative row represents a new candy entering above the board. */
  fromRow: number;
}

export interface CascadeStep {
  before: number[];
  specialsBefore: Specials;
  /** Cells actually removed; reward cells transform instead of disappearing. */
  matches: number[];
  after: number[];
  specialsAfter: Specials;
  created: SpecialCreated[];
  activated: SpecialEvent[];
  falls: CandyFall[];
  points: number;
  /** Actual removals per color, including blasts; newly transformed rewards are not removed. */
  collected: number[];
  combo: number;
}

function dropAndRefill(board: number[], specials: Specials, random: Random): CandyFall[] {
  const falls: CandyFall[] = [];
  for (let column = 0; column < SIZE; column++) {
    const values: Array<{ color: number; row: number; special: Special | null }> = [];
    for (let row = SIZE - 1; row >= 0; row--) {
      const value = board[indexOf(row, column)];
      if (value >= 0) values.push({ color: value, row, special: specials[indexOf(row, column)] });
    }
    let incomingRow = -1;
    while (values.length < SIZE) values.push({ color: randomColor(random), row: incomingRow--, special: null });
    for (let row = SIZE - 1, position = 0; row >= 0; row--, position++) {
      const index = indexOf(row, column);
      board[index] = values[position].color;
      specials[index] = values[position].special;
      if (row !== values[position].row) falls.push({ index, fromRow: values[position].row });
    }
  }
  return falls;
}

function shuffleInPlace(board: number[], specials: Specials, random: Random) {
  for (let attempt = 0; attempt < 120; attempt++) {
    for (let index = board.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [board[index], board[other]] = [board[other], board[index]];
      [specials[index], specials[other]] = [specials[other], specials[index]];
    }
    if (!findMatches(board).length && hasMoves(board, specials)) return;
  }
  const fallback = createBoard(random);
  board.splice(0, board.length, ...fallback);
}

export interface MoveResult {
  changed: boolean;
  points: number;
  combo: number;
  matched: number;
  reshuffled: boolean;
  /** Immutable frames let the UI replay each cascade without delaying game state or saves. */
  cascades: CascadeStep[];
}

const unchanged = (): MoveResult => ({ changed: false, points: 0, combo: 0, matched: 0, reshuffled: false, cascades: [] });

export function specialTargets(index: number, type: Special): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return [];
  const row = Math.floor(index / SIZE), column = index % SIZE;
  if (type === "row") return Array.from({ length: SIZE }, (_, col) => indexOf(row, col));
  if (type === "column") return Array.from({ length: SIZE }, (_, r) => indexOf(r, column));
  const targets: number[] = [];
  for (let r = Math.max(0, row - 1); r <= Math.min(SIZE - 1, row + 1); r++) {
    for (let col = Math.max(0, column - 1); col <= Math.min(SIZE - 1, column + 1); col++) targets.push(indexOf(r, col));
  }
  return targets;
}

function resolveMove(game: Game, triggers: number[], preferred: number[], random: Random): MoveResult {
  let groups = findMatchGroups(game.board);
  game.moves++;
  game.combo = 0;
  let points = 0;
  let matched = 0;
  const cascades: CascadeStep[] = [];
  // Guard against pathological random generators endlessly refilling matches.
  while ((groups.length || triggers.length) && game.combo < 50) {
    game.combo++;
    const before = [...game.board];
    const specialsBefore = [...game.specials];
    // Only natural match groups earn rewards. Explosions do not mint more power-ups.
    const rewards: SpecialEvent[] = [];
    for (const group of groups) {
      if (group.length < 4) continue;
      const candidates = group.filter((index) => !game.specials[index]);
      if (!candidates.length) continue;
      const index = preferred.find((cell) => candidates.includes(cell)) ?? candidates[Math.floor(candidates.length / 2)];
      rewards.push({ index, type: SPECIAL_TYPES[Math.min(SPECIAL_TYPES.length - 1, Math.floor(random() * SPECIAL_TYPES.length))] });
    }
    const affected = new Set([...groups.flat(), ...triggers]);
    const activated: SpecialEvent[] = [];
    // Set iteration visits newly added cells; every existing special fires at most once.
    for (const index of affected) {
      const type = game.specials[index];
      if (!type) continue;
      activated.push({ index, type });
      for (const target of specialTargets(index, type)) affected.add(target);
    }
    matched += affected.size;
    const stepPoints = affected.size * 10 * game.combo;
    points += stepPoints;
    const rewardCells = new Set(rewards.map(({ index }) => index));
    const matches = [...affected].filter((index) => !rewardCells.has(index)).sort((a, b) => a - b);
    const collected = Array<number>(COLORS).fill(0);
    for (const index of matches) collected[before[index]]++;
    for (let color = 0; color < COLORS; color++) game.collected[color] += collected[color];
    for (const index of matches) { game.board[index] = -1; game.specials[index] = null; }
    // New rewards survive this wave, then participate in later matches and explosions.
    for (const { index, type } of rewards) game.specials[index] = type;
    const falls = dropAndRefill(game.board, game.specials, random);
    const created = rewards.map(({ index, type }) => ({
      type,
      fromIndex: index,
      index: falls.find((fall) => fall.index % SIZE === index % SIZE && fall.fromRow === Math.floor(index / SIZE))?.index ?? index,
    }));
    cascades.push({ before, specialsBefore, matches, after: [...game.board], specialsAfter: [...game.specials], created, activated, falls, points: stepPoints, collected, combo: game.combo });
    game.lastMatches = matches;
    groups = findMatchGroups(game.board);
    triggers = [];
    preferred = [];
  }
  if (groups.length) {
    game.board = createBoard(random);
    game.lastMatches = [];
  }
  game.score += points;
  game.won = objectivesComplete(game.level, game.collected);
  game.over = !game.won && game.moves >= getLevel(game.level).moves;
  if (game.won) game.completed = Math.max(game.completed, game.level);
  let reshuffled = false;
  if (!game.won && !game.over && !hasMoves(game.board, game.specials)) {
    shuffleInPlace(game.board, game.specials, random);
    reshuffled = true;
  }
  game.selected = -1;
  return { changed: true, points, combo: game.combo, matched, reshuffled, cascades };
}

export function move(game: Game, first: number, second: number, random: Random = Math.random): MoveResult {
  if (game.over || game.won || !areAdjacent(first, second)) return unchanged();
  [game.board[first], game.board[second]] = [game.board[second], game.board[first]];
  [game.specials[first], game.specials[second]] = [game.specials[second], game.specials[first]];
  const triggers = [first, second].filter((index) => game.specials[index] !== null);
  if (!triggers.length && !findMatches(game.board).length) {
    [game.board[first], game.board[second]] = [game.board[second], game.board[first]];
    [game.specials[first], game.specials[second]] = [game.specials[second], game.specials[first]];
    game.selected = -1;
    return unchanged();
  }
  return resolveMove(game, triggers, [second, first], random);
}

export function activateSpecial(game: Game, index: number, random: Random = Math.random): MoveResult {
  if (game.over || game.won || !Number.isInteger(index) || index < 0 || index >= CELLS || !game.specials[index]) return unchanged();
  return resolveMove(game, [index], [], random);
}

export function snapshotGame(game: Game): SavedGame {
  return { format: 4, campaign: CAMPAIGN_VERSION, level: game.level, completed: game.completed, collected: [...game.collected], board: [...game.board], specials: [...game.specials], score: game.score, moves: game.moves };
}

export function restoreGame(value: unknown): Game | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<Omit<SavedGame, "format">> & { format?: unknown };
  if (![1, 2, 3, 4].includes(Number(saved.format)) || typeof saved.format !== "number" || !Array.isArray(saved.board) || saved.board.length !== CELLS) return null;
  if (saved.format === 4 && (!Number.isInteger(saved.campaign) || saved.campaign! < 1 || saved.campaign! > CAMPAIGN_VERSION)) return null;
  if (!saved.board.every((value) => Number.isInteger(value) && value >= 0 && value < COLORS)) return null;
  if (!Number.isSafeInteger(saved.score) || (saved.score ?? -1) < 0 || (saved.score ?? Infinity) > 10_000_000) return null;
  if (!Number.isSafeInteger(saved.moves) || (saved.moves ?? -1) < 0 || (saved.moves ?? Infinity) > 10_000_000) return null;
  if (saved.format !== 1 && (!Array.isArray(saved.specials) || saved.specials.length !== CELLS
    || !saved.specials.every((special) => special === null || SPECIAL_TYPES.includes(special)))) return null;
  const specials: Specials = saved.format !== 1 ? [...saved.specials!] : Array<Special | null>(CELLS).fill(null);
  const board = [...saved.board];
  if (findMatches(board).length) return null;
  // Score-only saves contain no color history: reuse their board/items for a fresh level 1.
  // The separate best-score key remains intact. Do not invent completed objectives.
  const legacy = saved.format === 1 || saved.format === 2;
  const rebalanced = !legacy && (saved.format === 3 || saved.campaign !== CAMPAIGN_VERSION);
  const level = legacy ? 1 : saved.level!;
  const completed = legacy ? 0 : saved.completed!;
  if (!Number.isInteger(level) || level < 1 || level > LEVELS.length
    || !Number.isInteger(completed) || completed < 0 || completed > LEVELS.length || level > completed + 1) return null;
  if (!legacy && (!Array.isArray(saved.collected) || saved.collected.length !== COLORS
    || !saved.collected.every((count) => Number.isSafeInteger(count) && count >= 0 && count <= 100_000))) return null;
  // New objectives must not erase unlocks or turn a valid old session into an immediate loss.
  // Keep the board/items, but restart this level's counters with the new move allowance.
  const collected = legacy || rebalanced ? Array<number>(COLORS).fill(0) : [...saved.collected!];
  const moves = legacy || rebalanced ? 0 : saved.moves!;
  if (moves > getLevel(level).moves) return null;
  const won = objectivesComplete(level, collected);
  const over = !won && moves >= getLevel(level).moves;
  if (won && completed < level) return null;
  if (!won && !over && !hasMoves(board, specials)) {
    if (!legacy && !rebalanced) return null;
    shuffleInPlace(board, specials, Math.random);
  }
  return {
    level,
    completed,
    collected,
    board,
    specials,
    score: legacy || rebalanced ? 0 : saved.score!,
    moves,
    combo: 0,
    won,
    over,
    selected: -1,
    lastMatches: [],
  };
}
