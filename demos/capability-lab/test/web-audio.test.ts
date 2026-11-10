import { describe, expect, test } from "bun:test";
import type { ToneSnapshot } from "../src/web-audio.ts";
import { createToneSample } from "../src/web-audio.ts";

function environment() {
  let finishResume!: () => void;
  let failResume!: (error: unknown) => void;
  const resumed = new Promise<void>((resolve, reject) => {
    finishResume = resolve;
    failResume = reject;
  });
  const calls: string[] = [];
  const stopTimes: Array<number | undefined> = [];
  const gain = {
    gain: { value: 1 },
    connect: () => {
      calls.push("gain.connect");
    },
    disconnect: () => {
      calls.push("gain.disconnect");
    },
  };
  const oscillator = {
    frequency: { value: 0 },
    connect: () => {
      calls.push("oscillator.connect");
    },
    start: () => {
      calls.push("start");
    },
    stop: (at?: number) => {
      stopTimes.push(at);
    },
    disconnect: () => {
      calls.push("oscillator.disconnect");
    },
  };
  const context = Object.assign(new EventTarget(), {
    state: "suspended" as AudioContextState,
    currentTime: 10,
    destination: {},
    createGain: () => gain,
    createOscillator: () => oscillator,
    resume() {
      calls.push("resume");
      return resumed;
    },
    async close() {
      calls.push("close");
      context.state = "closed";
      context.dispatchEvent(new Event("statechange"));
    },
  });
  const snapshots: ToneSnapshot[] = [];
  const failures: unknown[] = [];
  let expire!: () => void;
  let creations = 0;
  const sample = createToneSample({
    createContext: () => {
      creations++;
      // The fixture supplies only the native methods used by this sample.
      return context as unknown as AudioContext;
    },
    onChange: (snapshot) => {
      snapshots.push(snapshot);
    },
    onError: (error) => {
      failures.push(error);
    },
    schedule: (callback) => {
      expire = callback;
      return () => {
        calls.push("cancelTimer");
      };
    },
  });
  return {
    sample,
    context,
    calls,
    stopTimes,
    gain,
    snapshots,
    failures,
    finishResume,
    failResume,
    expire: () => expire(),
    creations: () => creations,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("native Web Audio sample", () => {
  test("resumes synchronously, uses a quiet application gain and keeps one context", async () => {
    const testbed = environment();
    testbed.sample.play();
    testbed.sample.play();
    expect(testbed.creations()).toBe(1);
    expect(testbed.calls).toContain("resume");
    expect(testbed.gain.gain.value).toBe(0.025);
    expect(testbed.stopTimes).toEqual([15]);
    expect(testbed.snapshots.at(-1)).toEqual({
      active: true,
      state: "suspended",
    });

    testbed.context.state = "running";
    testbed.finishResume();
    await settle();
    expect(testbed.snapshots.at(-1)).toEqual({
      active: true,
      state: "running",
    });
    testbed.expire();
    await settle();
    expect(testbed.snapshots.at(-1)).toEqual({
      active: false,
      state: "closed",
    });
    expect(testbed.calls).toContain("gain.disconnect");
    expect(testbed.calls).toContain("oscillator.disconnect");
    expect(testbed.calls.filter((call) => call === "close")).toHaveLength(1);
  });

  test("stops suspended audio on cancellation or deadline and ignores a late resume", async () => {
    for (const cleanup of ["stop", "expire"] as const) {
      const testbed = environment();
      expect(testbed.sample.play()).toBeUndefined();
      if (cleanup === "stop") {
        testbed.sample.stop();
      } else {
        testbed.expire();
      }
      await settle();
      const snapshotCount = testbed.snapshots.length;
      testbed.finishResume();
      await settle();
      expect(testbed.snapshots).toHaveLength(snapshotCount);
      expect(testbed.snapshots.at(-1)).toEqual({
        active: false,
        state: "closed",
      });
      expect(testbed.stopTimes).toEqual([15, undefined]);
    }
  });

  test("reports a real resume failure and closes the context without claiming it ran", async () => {
    const testbed = environment();
    const failure = new DOMException("Audio unavailable", "NotAllowedError");
    testbed.sample.play();
    testbed.failResume(failure);
    await settle();
    expect(testbed.failures).toEqual([failure]);
    expect(
      testbed.snapshots.some((snapshot) => snapshot.state === "running")
    ).toBe(false);
    expect(testbed.snapshots.at(-1)).toEqual({
      active: false,
      state: "closed",
    });
  });
});
