import { describe, expect, test } from "bun:test";
import type { PointerSnapshot } from "../src/pointer.ts";
import { createPointerSample } from "../src/pointer.ts";

function sample(play: () => Promise<{ handle: string } | null>) {
  const snapshots: PointerSnapshot[] = [];
  const stopped: string[] = [];
  const released: number[] = [];
  const failures: unknown[] = [];
  const controller = createPointerSample({
    capture: () => {},
    release: (id) => {
      released.push(id);
    },
    play,
    stop: async (handle) => {
      stopped.push(handle);
    },
    onChange: (snapshot) => {
      snapshots.push(snapshot);
    },
    onError: (error) => {
      failures.push(error);
    },
  });
  return { controller, snapshots, stopped, released, failures };
}

describe("pointer capture sample", () => {
  test("updates input synchronously and stops a handle returned after release", async () => {
    let finish!: (value: { handle: string }) => void;
    const playback = new Promise<{ handle: string }>((resolve) => {
      finish = resolve;
    });
    const state = sample(() => playback);
    state.controller.begin(7);
    expect(state.snapshots.at(-1)).toEqual({
      active: true,
      status: "pointerInside",
    });
    state.controller.move(7, true);
    expect(state.snapshots.at(-1)?.status).toBe("pointerOutside");
    state.controller.finish("pointerReleased", 7);
    expect(state.snapshots.at(-1)).toEqual({
      active: false,
      status: "pointerReleased",
    });
    finish({ handle: "late-sound" });
    await playback;
    expect(state.stopped).toEqual(["late-sound"]);
    expect(state.released).toEqual([7]);
  });

  test("an unrelated pointer cannot release an active press and an old handle cannot replace a new one", async () => {
    const complete: Array<(value: { handle: string }) => void> = [];
    const pending: Array<Promise<{ handle: string }>> = [];
    const state = sample(() => {
      const promise = new Promise<{ handle: string }>((resolve) => {
        complete.push(resolve);
      });
      pending.push(promise);
      return promise;
    });
    state.controller.begin(1);
    state.controller.begin(2);
    state.controller.finish("pointerReleased", 2);
    expect(state.snapshots.at(-1)?.active).toBe(true);
    state.controller.finish("pointerCancelled", 1);
    state.controller.begin(3);
    complete[0]({ handle: "old" });
    await pending[0];
    complete[1]({ handle: "current" });
    await pending[1];
    expect(state.stopped).toEqual(["old"]);
    state.controller.finish("pointerReleased", 3);
    expect(state.stopped).toEqual(["old", "current"]);
  });

  test("cancellation, lost capture, blur and hiding reset input and stop active audio", async () => {
    for (const status of [
      "pointerCancelled",
      "pointerCaptureLost",
      "pointerBlurred",
      "pointerHidden",
    ] as const) {
      const playback = Promise.resolve({ handle: status });
      const state = sample(() => playback);
      state.controller.begin(4);
      await playback;
      state.controller.finish(status);
      state.controller.finish("pointerCaptureLost", 4);
      expect(state.snapshots.at(-1)).toEqual({ active: false, status });
      expect(state.stopped).toEqual([status]);
      expect(state.released).toEqual([4]);
    }
  });

  test("audio failure leaves input active until release", async () => {
    const failure = { code: "USER_CANCELLED" };
    const state = sample(() => Promise.reject(failure));
    state.controller.begin(5);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.failures).toEqual([failure]);
    expect(state.snapshots.at(-1)?.active).toBe(true);
    state.controller.finish("pointerReleased", 5);
    expect(state.snapshots.at(-1)?.active).toBe(false);
  });
});
