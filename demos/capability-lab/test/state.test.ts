import { describe, expect, test } from "bun:test";
import { mediaAssets } from "../scripts/media.ts";
import type { RunnerState } from "../src/state.ts";
import {
  createLedger,
  createRunner,
  parseJsonInput,
  resultState,
  safeCode,
  testKey,
} from "../src/state.ts";
import messages from "../src/strings.json";

describe("private session results", () => {
  test("keeps a bounded newest-first log without accepting response or error-message content", () => {
    const ledger = createLedger({ limit: 2, now: () => 100 });
    ledger.add("user", "success", {
      value: { username: "private-user" },
      duration: -5,
    });
    ledger.add("clipboardRead", "failed", {
      code: "secret payload with spaces",
      message: "private text",
    });
    ledger.add("theme", "success", { duration: 1.6 });
    const entries = ledger.list();
    expect(entries.map((entry) => entry.operation)).toEqual([
      "theme",
      "clipboardRead",
    ]);
    expect(entries[0].duration).toBe(2);
    expect(entries[1].code).toBe("REQUEST_FAILED");
    expect(JSON.stringify(entries)).not.toMatch(/private|secret|payload/);
    expect(Object.isFrozen(entries[0])).toBe(true);
    entries.pop();
    expect(ledger.list()).toHaveLength(2);
    ledger.clear();
    expect(ledger.list()).toEqual([]);
  });

  test("accepts only known operation names and preserves denial, cancellation and timeout states", () => {
    const ledger = createLedger();
    expect(() => ledger.add("private-user", "success")).toThrow(
      "INVALID_RESULT"
    );
    expect(resultState({ code: "PERMISSION_DENIED" })).toBe("denied");
    expect(resultState({ code: "USER_CANCELLED" })).toBe("cancelled");
    expect(resultState({ code: "TIMEOUT" })).toBe("timeout");
    expect(resultState({ code: "APP_UNLOADED" })).toBe("unloaded");
    expect(resultState({ code: "API_UNSUPPORTED" })).toBe("unsupported");
    expect(resultState({ code: "PLATFORM_RESTRICTED" })).toBe("restricted");
    expect(
      safeCode(new WebAssembly.CompileError("CSP or module failure"))
    ).toBe("WASM_COMPILE_ERROR");
    expect(resultState(new WebAssembly.CompileError())).toBe("failed");
    expect(safeCode(new WebAssembly.LinkError())).toBe("WASM_LINK_ERROR");
    expect(safeCode(new WebAssembly.RuntimeError())).toBe("WASM_RUNTIME_ERROR");
    expect(safeCode(new Error("sensitive implementation detail"))).toBe(
      "REQUEST_FAILED"
    );
  });
});

describe("real SDK runner", () => {
  test("does not execute an API action or invent a result in local preview", async () => {
    const ledger = createLedger();
    const runner = createRunner(null, { ledger });
    let invoked = false;
    await runner.connect();
    const result = await runner.run("user", () => {
      invoked = true;
      return { id: 1 };
    });
    expect(runner.mode).toBe("preview");
    expect(invoked).toBe(false);
    expect(result).toEqual({ accepted: false });
    expect(ledger.list()[0]).toMatchObject({
      state: "preview",
      code: "NOT_CONNECTED",
    });
  });

  test("records an expected SDK rejection separately from a permission rejection and unexpected success", async () => {
    const ledger = createLedger();
    const runner = createRunner({ ready: Promise.resolve() }, { ledger });
    await runner.connect();
    await runner.run(
      "rejectBody",
      () => {
        throw { code: "MESSAGE_LIMIT" };
      },
      { expectedCode: "MESSAGE_LIMIT" }
    );
    expect(ledger.list()[0].state).toBe("expectedRejection");
    await runner.run(
      "rejectBody",
      () => {
        throw { code: "PERMISSION_DENIED" };
      },
      { expectedCode: "MESSAGE_LIMIT" }
    );
    expect(ledger.list()[0].state).toBe("denied");
    await runner.run("rejectBody", () => null, {
      expectedCode: "MESSAGE_LIMIT",
    });
    expect(ledger.list()[0].state).toBe("unexpectedSuccess");
  });

  test("ignores late results after stop-waiting and cleans up an acquired connection", async () => {
    const ledger = createLedger();
    const runner = createRunner({ ready: Promise.resolve() }, { ledger });
    await runner.connect();
    let finish: (value: { close: () => Promise<void> }) => void;
    let cleaned = false;
    const pending = runner.run(
      "socketConnect",
      () =>
        new Promise<{ close: () => Promise<void> }>((resolve) => {
          finish = resolve;
        }),
      {
        onDiscard: async (value) => {
          await value.close();
        },
      }
    );
    runner.stopWaiting();
    finish!({
      close: async () => {
        cleaned = true;
      },
    });
    expect(await pending).toEqual({ accepted: false });
    expect(cleaned).toBe(true);
    expect(ledger.list()[0].state).toBe("stoppedWaiting");
    expect(ledger.list().some((entry) => entry.state === "success")).toBe(
      false
    );
    expect(runner.busy).toBe(false);
  });

  test("does not let a late ready promise revive an unloaded instance", async () => {
    let finish: (value: void) => void;
    const runner = createRunner({
      ready: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });
    const connect = runner.connect();
    runner.dispose();
    finish!();
    await connect;
    expect(runner.mode).toBe("unloaded");
    let called = false;
    await runner.run("user", () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  test("reports only outstanding operations when historical pending entries remain in the log", async () => {
    let state: RunnerState;
    const runner = createRunner(
      { ready: Promise.resolve() },
      {
        onChange: (value) => {
          state = value;
        },
      }
    );
    await runner.connect();
    await runner.run("user", () => null);
    let finish: (value: object) => void;
    const pending = runner.run(
      "theme",
      () =>
        new Promise<object>((resolve) => {
          finish = resolve;
        })
    );
    expect(state!.pendingOperations).toEqual(["theme"]);
    expect(
      state!.entries.some(
        (entry) => entry.operation === "user" && entry.state === "pending"
      )
    ).toBe(true);
    finish!({});
    await pending;
    expect(state!.pendingOperations).toEqual([]);
  });

  test("bounds duplicate calls and never retains a returned private value in its log", async () => {
    const ledger = createLedger();
    const runner = createRunner({ ready: Promise.resolve() }, { ledger });
    await runner.connect();
    let finish: (value: { id: number; username: string }) => void;
    const first = runner.run(
      "user",
      () =>
        new Promise<{ id: number; username: string }>((resolve) => {
          finish = resolve;
        })
    );
    expect(
      await runner.run("user", () => {
        throw new Error("Must not run");
      })
    ).toEqual({ accepted: false });
    expect(ledger.list()[0].code).toBe("BUSY");
    finish!({ id: 123, username: "private-name" });
    expect(await first).toMatchObject({ accepted: true, value: { id: 123 } });
    expect(JSON.stringify(ledger.list())).not.toContain("private-name");
  });
});

describe("controlled fixture inputs", () => {
  test("namespaces keys and limits UTF-8 JSON input before parsing", () => {
    expect(testKey("sample-1")).toBe("capability-lab_sample-1");
    for (const key of ["", "bad key", "a".repeat(41), "../value"]) {
      expect(() => testKey(key)).toThrow();
    }
    expect(parseJsonInput('{"count":2}')).toEqual({ count: 2 });
    expect(() => parseJsonInput("not json")).toThrow();
    expect(() => parseJsonInput(`"${"汉".repeat(1400)}"`)).toThrow(
      "Input is too large"
    );
  });

  test("packages only small local media and WASM fixtures with valid container headers", () => {
    const files = mediaAssets();
    const wav = files["media/chime.wav"];
    const mp4 = files["media/pattern.mp4"];
    expect(Object.keys(files).sort()).toEqual([
      "media/chime.wav",
      "media/pattern.mp4",
      "wasm/answer.wasm",
    ]);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(mp4.toString("ascii", 4, 8)).toBe("ftyp");
    expect(wav.length + mp4.length).toBeLessThan(20000);
  });

  test("generates a deterministic declared WASM module with a real answer export", async () => {
    const bytes = mediaAssets()["wasm/answer.wasm"];
    const manifest = await Bun.file(
      new URL("../manifest.json", import.meta.url)
    ).json();
    expect(manifest.assets).toContain("wasm/answer.wasm");
    expect(bytes).toEqual(mediaAssets()["wasm/answer.wasm"]);
    expect(bytes.byteLength).toBe(39);
    const { module, instance } = await WebAssembly.instantiate(bytes);
    expect(module).toBeInstanceOf(WebAssembly.Module);
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
    const answer = instance.exports.answer;
    expect(typeof answer).toBe("function");
    if (typeof answer !== "function") {
      throw new Error("Missing answer export");
    }
    expect(answer()).toBe(42);
  });

  test("all languages cover the same controls and outcomes", () => {
    for (const locale of ["zh_CN", "zh_TW"] as const) {
      expect(Object.keys(messages[locale]).sort()).toEqual(
        Object.keys(messages.en).sort()
      );
    }
  });
});
