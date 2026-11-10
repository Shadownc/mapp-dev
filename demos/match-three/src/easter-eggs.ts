import { LEVELS, getLevel } from "./levels.ts";

export interface EggConfig { enabled: boolean; secretTheme: boolean; lastMove: boolean; campaignEnding: boolean }
export interface EggSave {
  format: 1;
  themeUnlocked: boolean;
  themeActive: boolean;
  campaignUnlocked: boolean;
  endingPending: boolean;
}
export function restoreEggs(value: unknown): EggSave {
  const saved = value as Partial<EggSave> | null;
  const valid = saved?.format === 1;
  const themeUnlocked = valid && saved.themeUnlocked === true;
  const campaignUnlocked = valid && saved.campaignUnlocked === true;
  return { format: 1, themeUnlocked, themeActive: themeUnlocked && saved?.themeActive === true,
    campaignUnlocked, endingPending: campaignUnlocked && saved?.endingPending === true };
}

/** Seven deliberate activations, with no gap longer than 1.5 seconds. No gameplay RNG. */
export function createSecretTap() {
  let count = 0, last = -Infinity;
  return (now: number) => {
    count = now - last <= 1500 && now >= last ? count + 1 : 1;
    last = now;
    if (count < 7) return false;
    count = 0;
    return true;
  };
}
export function isLastMoveWin(game: { won: boolean; level: number; moves: number }) {
  return game.won && game.moves === getLevel(game.level).moves;
}
export function unlockCampaign(state: EggSave, config: EggConfig, completed: number): boolean {
  if (!config.enabled || !config.campaignEnding || completed !== LEVELS.length || state.campaignUnlocked) return false;
  state.campaignUnlocked = true;
  state.endingPending = true;
  return true;
}

export function createEasterEggs(config: EggConfig, t: (key: string) => string, save: (state: EggSave) => void) {
  let state = restoreEggs(null), ready = false, messageKey = "";
  const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const title = node<HTMLButtonElement>("title-secret");
  const theme = node<HTMLButtonElement>("egg-theme");
  const ending = node<HTMLDetailsElement>("egg-ending");
  const lastMove = node("egg-last-move"), finale = node("egg-finale");
  const tap = createSecretTap();
  const commit = () => save({ ...state });
  function render() {
    const palette = config.enabled && config.secretTheme && state.themeUnlocked;
    const badge = config.enabled && config.campaignEnding && state.campaignUnlocked;
    title.disabled = !ready || !config.enabled || !config.secretTheme;
    node("egg-collection").hidden = !palette && !badge;
    node("egg-message").textContent = messageKey ? t(messageKey) : "";
    theme.hidden = !palette;
    theme.textContent = t(state.themeActive ? "eggThemeClassic" : "eggThemeSecret");
    theme.setAttribute("aria-pressed", String(palette && state.themeActive));
    document.documentElement.dataset.candyTheme = palette && state.themeActive ? "soda" : "classic";
    ending.hidden = !badge;
  }
  title.addEventListener("click", () => {
    if (!ready || !config.enabled || !config.secretTheme || !tap(performance.now())) return;
    const unlocked = state.themeUnlocked;
    state.themeUnlocked = true; state.themeActive = true;
    messageKey = unlocked ? "eggWelcomeBack" : "eggDiscovered";
    render(); commit();
  });
  theme.addEventListener("click", () => {
    if (!ready || !config.enabled || !config.secretTheme || !state.themeUnlocked) return;
    state.themeActive = !state.themeActive; render(); commit();
  });
  return {
    render,
    restore(value: unknown, completed: number) {
      state = restoreEggs(value); ready = true;
      // Existing seven-level finishers receive the badge without replaying the campaign.
      if (unlockCampaign(state, config, completed)) { ending.open = true; state.endingPending = false; commit(); }
      render();
    },
    won(completed: number) { if (unlockCampaign(state, config, completed)) { render(); commit(); } },
    victory(game: { won: boolean; level: number; moves: number }, visible: boolean) {
      const hideLast = !visible || !config.enabled || !config.lastMove || !isLastMoveWin(game);
      const hideFinale = !visible || !config.enabled || !config.campaignEnding || !state.endingPending || game.level !== LEVELS.length;
      // This runs on each animation frame render; unchanged attributes must not invalidate styles.
      if (lastMove.hidden !== hideLast) lastMove.hidden = hideLast;
      if (finale.hidden !== hideFinale) finale.hidden = hideFinale;
    },
    leaveVictory() {
      if (!config.enabled || !config.campaignEnding || !state.endingPending) return;
      state.endingPending = false; commit();
    },
  };
}
