export interface Level {
  readonly id: number;
  readonly moves: number;
  readonly targets: readonly { readonly color: number; readonly count: number }[];
}

/** All campaign balancing lives here. Color IDs match the engine's six candy colors. */
export const LEVELS: readonly Level[] = [
  { id: 1, moves: 22, targets: [{ color: 0, count: 12 }] },
  { id: 2, moves: 25, targets: [{ color: 1, count: 15 }, { color: 2, count: 15 }] },
  { id: 3, moves: 26, targets: [{ color: 3, count: 18 }, { color: 4, count: 18 }] },
  { id: 4, moves: 26, targets: [{ color: 0, count: 20 }, { color: 5, count: 20 }] },
  { id: 5, moves: 28, targets: [{ color: 2, count: 22 }, { color: 3, count: 22 }, { color: 4, count: 22 }] },
  { id: 6, moves: 28, targets: [{ color: 0, count: 25 }, { color: 1, count: 25 }, { color: 5, count: 25 }] },
  { id: 7, moves: 30, targets: Array.from({ length: 6 }, (_, color) => ({ color, count: 20 })) },
];

export function getLevel(id: number): Level {
  if (!Number.isInteger(id) || id < 1 || id > LEVELS.length) throw new Error("Invalid level");
  return LEVELS[id - 1];
}

export function objectivesComplete(level: number, collected: readonly number[]): boolean {
  return getLevel(level).targets.every(({ color, count }) => collected[color] >= count);
}

export function objectiveProgress(level: number, collected: readonly number[]) {
  const targets = getLevel(level).targets;
  return {
    current: targets.reduce((sum, { color, count }) => sum + Math.min(collected[color], count), 0),
    total: targets.reduce((sum, { count }) => sum + count, 0),
  };
}
