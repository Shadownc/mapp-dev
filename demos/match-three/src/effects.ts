import { SIZE } from "./engine.ts";
import type { CandyFall, CascadeStep, SpecialEvent } from "./engine.ts";

const COLORS = ["#f16f83", "#f5b83d", "#62c7a7", "#65a8e8", "#a878d1", "#f18c48"];

/** Cosmetic effects only: cancelling these never changes the resolved game state. */
export function createEffects(board: HTMLElement, tiles: HTMLButtonElement[], layer: HTMLElement) {
  const active = new Set<Animation>();
  const gems = tiles.map((tile) => tile.querySelector<HTMLElement>(".candy__gem")!);
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => document.documentElement.dataset.reducedMotion === "true"
    || motionPreference.matches;
  type Geometry = { width: number; height: number; x: number; y: number; pitchX: number; pitchY: number };
  let geometry: Geometry | null = null;
  // Board-local coordinates survive scrolling. Only a resize invalidates the grid metrics.
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => { geometry = null; }) : null;
  resizeObserver?.observe(board);
  function measure(): Geometry {
    if (geometry) return geometry;
    // Read the layout together, before adding particles or starting animations.
    const origin = board.getBoundingClientRect();
    const first = tiles[0].getBoundingClientRect();
    const right = tiles[1].getBoundingClientRect();
    const below = tiles[SIZE].getBoundingClientRect();
    geometry = { width: origin.width, height: origin.height, x: first.left - origin.left + first.width / 2, y: first.top - origin.top + first.height / 2, pitchX: right.left - first.left, pitchY: below.top - first.top };
    return geometry;
  }

  async function animate(node: HTMLElement, frames: Keyframe[], duration: number, delay = 0) {
    if (reduced() || typeof node.animate !== "function") return;
    const animation = node.animate(frames, { duration, delay, fill: "both", easing: "cubic-bezier(.2,.7,.3,1)" });
    active.add(animation);
    try { await animation.finished; } catch { /* Reset, pause and page hide cancel pending effects. */ }
    finally { animation.cancel(); active.delete(animation); }
  }

  function transient(className: string, x: number, y: number, parent: HTMLElement | DocumentFragment = layer) {
    const node = document.createElement("span");
    node.className = className;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    parent.append(node);
    return node;
  }

  function center(index: number, grid: Geometry) {
    return { x: grid.x + index % SIZE * grid.pitchX, y: grid.y + Math.floor(index / SIZE) * grid.pitchY };
  }

  function burst(step: CascadeStep, grid: Geometry) {
    const fragment = document.createDocumentFragment();
    const particles: Array<{ node: HTMLElement; dx: number; dy: number }> = [];
    // A fixed budget, spread across the full match instead of its first few cells.
    const count = Math.min(step.matches.length, 10);
    for (let cell = 0; cell < count; cell++) {
      const index = step.matches[Math.floor(cell * step.matches.length / count)];
      const { x, y } = center(index, grid);
      for (let particle = 0; particle < 3; particle++) {
        const angle = particle * Math.PI * 2 / 3 + index;
        const distance = 24 + (index * 7 + particle * 11) % 23;
        const node = transient("candy__spark", x, y, fragment);
        node.style.background = COLORS[step.before[index]];
        particles.push({ node, dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance + 12 });
      }
    }
    layer.append(fragment);
    for (const { node, dx, dy } of particles) {
      void animate(node, [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`, opacity: 0 },
      ], 380).finally(() => node.remove());
    }
  }

  function label(text: string, x: number, y: number, combo = false) {
    const node = transient(`candy__points${combo ? " candy__points--combo" : ""}`, x, y);
    node.textContent = text;
    void animate(node, [
      { transform: "translate(-50%, -20%) scale(.55)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.12)", opacity: 1, offset: .22 },
      { transform: "translate(-50%, -65%) scale(1)", opacity: 1, offset: .65 },
      { transform: "translate(-50%, -115%) scale(.96)", opacity: 0 },
    ], combo ? 1000 : 780).finally(() => node.remove());
  }

  return {
    reduced,
    invalidateGeometry() { geometry = null; },
    cancel() {
      for (const animation of active) animation.cancel();
      active.clear();
      layer.replaceChildren();
    },
    dispose() {
      resizeObserver?.disconnect();
      for (const animation of active) animation.cancel();
      active.clear();
      layer.replaceChildren();
    },
    enter() {
      return Promise.all(gems.map((gem, index) => animate(gem, [
        { transform: "translateY(-28px) scale(.3) rotate(-18deg)", opacity: 0 },
        { transform: "translateY(3px) scale(1.09) rotate(4deg)", opacity: 1, offset: .75 },
        { transform: "none", opacity: 1 },
      ], 300, Math.floor(index / SIZE) * 24 + index % SIZE * 12)));
    },
    swap(first: number, second: number, valid: boolean) {
      if (reduced()) return Promise.resolve([]);
      const grid = measure();
      const a = center(first, grid), b = center(second, grid);
      return Promise.all([first, second].map((index, position) => {
        const sign = position === 0 ? 1 : -1;
        const target = `translate(${(b.x - a.x) * sign}px, ${(b.y - a.y) * sign}px) scale(1.08)`;
        return animate(gems[index], valid ? [
          { transform: "none" }, { transform: target },
        ] : [
          { transform: "none" },
          { transform: target, offset: .45 },
          { transform: target, offset: .6 },
          { transform: "none" },
        ], valid ? 190 : 380);
      }));
    },
    activate(specials: SpecialEvent[]) {
      if (reduced()) return Promise.resolve([]);
      const grid = measure();
      const { width, height, pitchY: pitch } = grid;
      const fragment = document.createDocumentFragment();
      const seen = new Set<string>();
      const visible = specials.filter(({ index, type }) => {
        const key = `${type}:${type === "row" ? Math.floor(index / SIZE) : type === "column" ? index % SIZE : index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 12);
      const blasts = visible.map(({ index, type }) => {
        const { x, y } = center(index, grid);
        const node = transient(`candy__blast candy__blast--${type}`, type === "row" ? width / 2 : x, type === "column" ? height / 2 : y, fragment);
        node.style.width = `${type === "row" ? width : type === "area" ? pitch * 3 : pitch * .75}px`;
        node.style.height = `${type === "column" ? height : type === "area" ? pitch * 3 : pitch * .75}px`;
        const startScale = type === "row" ? "scaleX(.02)" : type === "column" ? "scaleY(.02)" : "scale(.08)";
        return { node, startScale };
      });
      layer.append(fragment);
      return Promise.all(blasts.map(({ node, startScale }) => {
        return animate(node, [
          { transform: `translate(-50%, -50%) ${startScale}`, opacity: .3 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: .55 },
          { transform: "translate(-50%, -50%) scale(1.04)", opacity: 0 },
        ], 380).finally(() => node.remove());
      }));
    },
    reward(specials: SpecialEvent[]) {
      return Promise.all(specials.map(({ index }) => animate(gems[index], [
        { transform: "scale(.65) rotate(-15deg)" },
        { transform: "scale(1.25) rotate(8deg)", offset: .55 },
        { transform: "none" },
      ], 330)));
    },
    clear(step: CascadeStep, comboText: string) {
      if (!reduced()) {
        const grid = measure();
        const centers = step.matches.map((index) => center(index, grid));
        const x = centers.reduce((sum, point) => sum + point.x, 0) / centers.length;
        const y = centers.reduce((sum, point) => sum + point.y, 0) / centers.length;
        burst(step, grid);
        label(`+${step.points}`, Math.max(45, Math.min(grid.width - 45, x)), Math.max(45, y));
        if (step.combo > 1) label(comboText, grid.width / 2, grid.height * .43, true);
      }
      return Promise.all(step.matches.map((index) => animate(gems[index], [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(1.28) rotate(12deg)", opacity: 1, offset: .35 },
        { transform: "scale(0) rotate(-22deg)", opacity: 0 },
      ], 240)));
    },
    fall(falls: CandyFall[]) {
      if (reduced()) return Promise.resolve([]);
      const pitch = measure().pitchY;
      return Promise.all(falls.map(({ index, fromRow }) => {
        const distance = Math.floor(index / SIZE) - fromRow;
        return animate(gems[index], [
          { transform: `translateY(${-distance * pitch}px) scale(.94, 1.06)`, opacity: fromRow < 0 ? 0 : 1 },
          { opacity: 1, offset: .22 },
          { transform: "translateY(3px) scale(1.08, .92)", opacity: 1, offset: .82 },
          { transform: "none", opacity: 1 },
        ], 260 + Math.min(distance * 26, 160));
      }));
    },
    pulse(node: HTMLElement) {
      void animate(node, [
        { transform: "scale(1)" },
        { transform: "scale(1.2)", offset: .35 },
        { transform: "scale(1)" },
      ], 300);
    },
    celebrate() {
      if (reduced()) return;
      const { width, height } = measure();
      const fragment = document.createDocumentFragment();
      const confetti = Array.from({ length: 28 }, (_, index) => {
        const x = ((index * 13) % 28 + .5) / 28 * width;
        const node = transient("candy__confetti", x, -14, fragment);
        node.style.background = COLORS[index % COLORS.length];
        return node;
      });
      layer.append(fragment);
      for (const [index, node] of confetti.entries()) {
        void animate(node, [
          { transform: "translateY(0) rotate(0deg)", opacity: 1 },
          { opacity: 1, offset: .8 },
          { transform: `translate(${index * 17 % 100 - 50}px, ${height + 35}px) rotate(${180 + index * 37 % 540}deg)`, opacity: 0 },
        ], 1200 + index * 23 % 600, index * 17).finally(() => node.remove());
      }
    },
  };
}
