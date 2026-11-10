import { describe, expect, test } from "bun:test";
import type { PointerLockSnapshot } from "../src/pointer-lock.ts";
import { createPointerLockSample } from "../src/pointer-lock.ts";

function environment(request: () => void | Promise<void> = () => {}) {
  let owned = false;
  let requests = 0;
  let exits = 0;
  const snapshots: PointerLockSnapshot[] = [];
  const failures: unknown[] = [];
  const sample = createPointerLockSample({
    request() {
      requests++;
      return request();
    },
    exit() {
      exits++;
    },
    isLocked: () => owned,
    onChange: (snapshot) => {
      snapshots.push(snapshot);
    },
    onError: (failure) => {
      failures.push(failure);
    },
  });
  return {
    sample,
    snapshots,
    failures,
    lock: (value: boolean) => {
      owned = value;
      sample.changed();
    },
    requests: () => requests,
    exits: () => exits,
  };
}

describe("native pointer lock sample", () => {
  test("requests synchronously but waits for a lock event even when the returned promise resolves", async () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const state = environment(() => promise);
    state.sample.request();
    state.sample.request();
    expect(state.requests()).toBe(1);
    expect(state.snapshots.at(-1)?.phase).toBe("requesting");
    resolve();
    await promise;
    expect(state.snapshots.at(-1)?.phase).toBe("requesting");
    state.lock(true);
    expect(state.snapshots.at(-1)?.phase).toBe("locked");
    state.sample.release();
    expect(state.snapshots.at(-1)?.phase).toBe("exiting");
    expect(state.exits()).toBe(1);
    state.lock(false);
    expect(state.snapshots.at(-1)?.phase).toBe("idle");
  });

  test("supports void requests and accepts native movement only while the canvas owns the lock", () => {
    const state = environment();
    state.sample.request();
    state.sample.move(10, 20);
    expect(state.snapshots.at(-1)?.totalX).toBe(0);
    state.lock(true);
    state.sample.move(3, -2);
    state.sample.move(-1, 5);
    state.sample.move(NaN, Infinity);
    expect(state.snapshots.at(-1)).toMatchObject({
      movementX: -1,
      movementY: 5,
      totalX: 2,
      totalY: 3,
    });
    state.lock(false);
    state.sample.move(50, 50);
    expect(state.snapshots.at(-1)).toMatchObject({
      phase: "idle",
      totalX: 0,
      totalY: 0,
    });
    expect(state.exits()).toBe(0);
  });

  test("cleans up late acquisition after cancellation or disposal without requesting again", async () => {
    for (const cleanup of ["release", "dispose"] as const) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const state = environment(() => promise);
      state.sample.request();
      state.sample[cleanup]();
      state.lock(true);
      expect(state.exits()).toBe(1);
      state.lock(false);
      resolve();
      await promise;
      expect(state.snapshots.at(-1)?.phase).toBe("idle");
      expect(state.requests()).toBe(1);
      expect(state.exits()).toBe(1);
    }
  });

  test("reports an error once and never converts it to a successful lock", async () => {
    const failure = { code: "PERMISSION_DENIED" };
    const state = environment(() => Promise.reject(failure));
    state.sample.request();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.snapshots.at(-1)?.phase).toBe("requesting");
    state.sample.failed({ code: "POINTER_LOCK_FAILED" });
    expect(state.failures).toEqual([failure]);
    expect(state.snapshots.at(-1)?.phase).toBe("failed");
    expect(
      state.snapshots.some((snapshot) => snapshot.phase === "locked")
    ).toBe(false);
    expect(state.requests()).toBe(1);
  });

  test("keeps a cancelled void request pending until its native error, then permits retry", () => {
    const state = environment();
    state.sample.request();
    state.sample.release();
    expect(state.snapshots.at(-1)?.phase).toBe("exiting");
    state.sample.request();
    expect(state.requests()).toBe(1);
    state.sample.failed({ code: "POINTER_LOCK_FAILED" });
    expect(state.snapshots.at(-1)?.phase).toBe("idle");
    expect(state.failures).toEqual([]);
    state.sample.request();
    state.lock(true);
    expect(state.requests()).toBe(2);
    expect(state.snapshots.at(-1)?.phase).toBe("locked");
    expect(state.exits()).toBe(0);
  });

  test("serializes cancelled Promise requests for either error-event and rejection order", async () => {
    for (const eventFirst of [false, true]) {
      let reject!: (failure: unknown) => void;
      const promise = new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
      let attempt = 0;
      const state = environment(() => (attempt++ === 0 ? promise : undefined));
      state.sample.request();
      state.sample.release();
      if (!eventFirst) {
        reject({ code: "OLD_PROMISE_ERROR" });
        await Promise.resolve();
        state.sample.request();
        expect(state.requests()).toBe(1);
      }
      state.sample.failed({ code: "OLD_NATIVE_ERROR" });
      state.sample.request();
      if (eventFirst) {
        reject({ code: "OLD_PROMISE_ERROR" });
        await Promise.resolve();
      }
      state.lock(true);
      expect(state.requests()).toBe(2);
      expect(state.snapshots.at(-1)?.phase).toBe("locked");
      expect(state.exits()).toBe(0);
      expect(state.failures).toEqual([]);
    }
  });

  test("waits for late acquisition and actual unlock before retrying a cancelled successful request", async () => {
    for (const eventFirst of [false, true]) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      let attempt = 0;
      const state = environment(() => (attempt++ === 0 ? promise : undefined));
      state.sample.request();
      state.sample.release();
      if (!eventFirst) {
        resolve();
        await promise;
      }
      state.sample.request();
      expect(state.requests()).toBe(1);
      state.lock(true);
      expect(state.snapshots.at(-1)?.phase).toBe("exiting");
      state.sample.request();
      expect(state.requests()).toBe(1);
      state.lock(false);
      state.sample.request();
      if (eventFirst) {
        resolve();
        await promise;
      }
      state.lock(true);
      expect(state.requests()).toBe(2);
      expect(state.exits()).toBe(1);
      expect(state.snapshots.at(-1)?.phase).toBe("locked");
    }
  });

  test("allows retry after native failure or a synchronous throw without waiting for another event", () => {
    for (const synchronous of [false, true]) {
      let attempt = 0;
      const state = environment(() => {
        if (attempt++ === 0 && synchronous) {
          throw { code: "API_UNSUPPORTED" };
        }
      });
      state.sample.request();
      if (!synchronous) {
        state.sample.failed({ code: "POINTER_LOCK_FAILED" });
      }
      expect(state.snapshots.at(-1)?.phase).toBe("failed");
      state.sample.request();
      state.lock(true);
      expect(state.requests()).toBe(2);
      expect(state.snapshots.at(-1)?.phase).toBe("locked");
      expect(state.failures).toHaveLength(1);
    }
  });
});
