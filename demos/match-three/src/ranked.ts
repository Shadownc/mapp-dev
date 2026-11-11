import { activateSpecial, createGame, knockOut, move } from "./engine.ts";
import { getLevel } from "./levels.ts";

// Increment this whenever the engine, level targets or scoring rules change.
export const RULES_VERSION = "campaign-3";
export type Action = [number] | [number, number] | [-1, number];
export interface RankedRun {
  id: string;
  seed: number;
  level: number;
  completed: number;
  expires: number;
  rules: string;
}
export interface RankedSave { run: RankedRun; actions: Action[] }

/** Gameplay randomness is separate from all cosmetic effects. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function replayRun(run: RankedRun, value: unknown) {
  if (run.rules !== RULES_VERSION || !Number.isInteger(run.seed) || run.seed < 0 || run.seed > 0xffffffff) throw new Error("INVALID_RUN");
  const level = getLevel(run.level);
  if (!Array.isArray(value) || value.length > level.moves) throw new Error("INVALID_ACTIONS");
  const random = seededRandom(run.seed);
  const game = createGame(random, run.level, run.completed);
  const actions: Action[] = [];
  let malletsUsed = 0;
  for (const action of value) {
    if (!Array.isArray(action) || ![1, 2].includes(action.length)) throw new Error("INVALID_ACTIONS");
    if (action[0] === -1) {
      if (action.length !== 2 || !Number.isInteger(action[1]) || action[1] < 0 || action[1] >= 64) throw new Error("INVALID_ACTIONS");
      if (++malletsUsed > 2) throw new Error("INVALID_ACTIONS");
    } else if (!action.every((index) => Number.isInteger(index) && index >= 0 && index < 64)) throw new Error("INVALID_ACTIONS");
    const result = action[0] === -1 ? knockOut(game, action[1], random)
      : action.length === 1 ? activateSpecial(game, action[0], random) : move(game, action[0], action[1], random);
    if (!result.changed) throw new Error("INVALID_ACTIONS");
    actions.push([...action] as Action);
  }
  return { game, random, actions };
}

export interface LeaderboardEntry { rank: number; userId: string; completed: number; score: number }
export interface LeaderboardData {
  channel: "sandbox" | "production";
  rules: string;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}
