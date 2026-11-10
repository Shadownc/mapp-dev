import { activateSpecial, areAdjacent, createGame, findMatchGroups, move, specialTargets } from "../src/engine.ts";
import type { Game, Specials } from "../src/engine.ts";
import { LEVELS, getLevel } from "../src/levels.ts";
import { seededRandom } from "../src/ranked.ts";

// The player only sees the current board, never the seed or future refills.
export function chooseAction(game: Game, policy: "target" | "random", random: () => number): [number] | [number, number] {
  const candidates: Array<{ action: [number] | [number, number]; weight: number }> = [];
  function weight(board: number[], specials: Specials, groups: number[][], triggers: number[]) {
    const affected = new Set([...groups.flat(), ...triggers]);
    for (const index of affected) if (specials[index]) for (const other of specialTargets(index, specials[index]!)) affected.add(other);
    const counts = Array<number>(6).fill(0);
    for (const index of affected) counts[board[index]]++;
    const targets = getLevel(game.level).targets.reduce((sum, { color, count }) => sum + Math.min(Math.max(0, count - game.collected[color]), counts[color]), 0);
    return targets * 5 + affected.size + groups.filter((group) => group.length >= 4).length * 7;
  }
  for (let i = 0; i < 64; i++) {
    if (game.specials[i]) candidates.push({ action: [i], weight: weight(game.board, game.specials, [], [i]) });
    for (const j of [i + 1, i + 8]) {
      if (!areAdjacent(i, j)) continue;
      const board = [...game.board], specials = [...game.specials];
      [board[i], board[j]] = [board[j], board[i]]; [specials[i], specials[j]] = [specials[j], specials[i]];
      const groups = findMatchGroups(board), triggers = [i, j].filter((index) => specials[index]);
      if (groups.length || triggers.length) candidates.push({ action: [i, j], weight: weight(board, specials, groups, triggers) });
    }
  }
  if (!candidates.length) throw new Error("No legal action");
  return policy === "random" ? candidates[Math.floor(random() * candidates.length)].action
    : candidates.sort((a, b) => b.weight - a.weight)[0].action;
}

if (import.meta.main) {
  const samples = Number(process.argv[2] ?? 200);
  if (!Number.isInteger(samples) || samples < 1 || samples > 10000) throw new Error("Use 1–10000 samples per level");
  for (const policy of ["random", "target"] as const) {
    const results = LEVELS.map((level) => {
      let wins = 0, winningMoves = 0;
      for (let seed = 1; seed <= samples; seed++) {
        const random = seededRandom(seed), decisions = seededRandom(seed + 1_000_000);
        const game = createGame(random, level.id, level.id - 1);
        while (!game.won && !game.over) {
          const action = chooseAction(game, policy, decisions);
          if (action.length === 1) activateSpecial(game, action[0], random); else move(game, action[0], action[1], random);
        }
        if (game.won) { wins++; winningMoves += game.moves; }
      }
      return { level: level.id, wins, samples, winPercent: Math.round(wins / samples * 100), averageWinningMoves: wins ? +(winningMoves / wins).toFixed(1) : null };
    });
    console.log(JSON.stringify({ policy, results }));
  }
}
