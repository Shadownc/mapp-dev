import type { JsonValue, MiniAppSDK } from "@discourse-mini-app/sdk";

/** Outcome categories kept in the session ledger. */
export type ResultState =
  | "pending"
  | "success"
  | "denied"
  | "unsupported"
  | "restricted"
  | "cancelled"
  | "timeout"
  | "unloaded"
  | "failed"
  | "preview"
  | "stoppedWaiting"
  | "expectedRejection"
  | "unexpectedSuccess"
  | "notConfigured";

/** Only status metadata is retained; private API return values stay outside the ledger. */
export interface ResultEntry {
  readonly id: number;
  readonly operation: string;
  readonly state: ResultState;
  readonly code: string;
  readonly expected: string;
  readonly duration: number;
  readonly time: number;
}

/** The connection and outstanding-operation snapshot used by the UI. */
export interface RunnerState {
  mode: "connecting" | "preview" | "connected" | "disconnected" | "unloaded";
  pending: number;
  pendingOperations?: string[];
  entries: ResultEntry[];
}

/** Metadata accepted by the ledger, with extra private fields deliberately ignored. */
export type ResultDetails = {
  code?: unknown;
  duration?: number;
  expected?: unknown;
  [key: string]: unknown;
};

/** A completed action result; stopped or failed actions do not publish a value. */
export type RunResult<T> =
  | { accepted: true; value: T; code?: never }
  | { accepted: false; code?: string };

/** Cleanup for resources acquired after the user has stopped waiting. */
export interface RunOptions<T> {
  expectedCode?: string;
  onDiscard?: (value: T) => unknown | Promise<unknown>;
}

export const RESULT_LIMIT = 40;
export const OPERATION_IDS = Object.freeze([
  "permissions",
  "user",
  "userLookup",
  "launch",
  "theme",
  "assets",
  "storageRead",
  "storageWrite",
  "storageRemove",
  "storageClear",
  "cookieRead",
  "cookieWrite",
  "cookieRemove",
  "clipboardRead",
  "clipboardWrite",
  "fullscreenEnter",
  "fullscreenExit",
  "audioPlay",
  "audioStop",
  "videoPlay",
  "videoStop",
  "http",
  "socketConnect",
  "socketSend",
  "socketClose",
  "rejectHeader",
  "rejectBody",
  "socketMessage",
  "socketError",
  "socketEnded",
  "layoutForm",
  "wasm",
  "pointerCapture",
  "pointerAudio",
  "pointerLock",
  "webAudioPlay",
  "webAudioStop",
]);
const allowedIds = new Set(OPERATION_IDS);
const allowedStates = new Set([
  "pending",
  "success",
  "denied",
  "unsupported",
  "restricted",
  "cancelled",
  "timeout",
  "unloaded",
  "failed",
  "preview",
  "stoppedWaiting",
  "expectedRejection",
  "unexpectedSuccess",
  "notConfigured",
]);

export function safeCode(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "CompileError") {
    return "WASM_COMPILE_ERROR";
  }
  if (name === "LinkError") {
    return "WASM_LINK_ERROR";
  }
  if (name === "RuntimeError") {
    return "WASM_RUNTIME_ERROR";
  }
  return typeof (error as { code?: unknown } | null)?.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,47}$/.test((error as { code: string }).code)
    ? (error as { code: string }).code
    : "REQUEST_FAILED";
}

export function resultState(error: unknown): ResultState {
  const code = safeCode(error);
  if (code === "API_UNSUPPORTED") {
    return "unsupported";
  }
  if (code === "PLATFORM_RESTRICTED") {
    return "restricted";
  }
  if (["PERMISSION_DENIED", "ACCESS_DENIED", "ACCESS_REVOKED"].includes(code)) {
    return "denied";
  }
  if (["USER_CANCELLED", "CANCELLED"].includes(code)) {
    return "cancelled";
  }
  if (["TIMEOUT", "CONNECT_TIMEOUT"].includes(code)) {
    return "timeout";
  }
  if (code === "APP_UNLOADED") {
    return "unloaded";
  }
  return "failed";
}

export function createLedger({
  limit = RESULT_LIMIT,
  now = Date.now,
}: { limit?: number; now?: () => number } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RESULT_LIMIT) {
    throw new Error("INVALID_LIMIT");
  }
  const entries: ResultEntry[] = [];
  let sequence = 0;
  return {
    add(
      operation: string,
      state: string,
      { code = "", duration = 0, expected = "" }: ResultDetails = {}
    ) {
      if (!allowedIds.has(operation) || !allowedStates.has(state)) {
        throw new Error("INVALID_RESULT");
      }
      const entry = Object.freeze({
        id: ++sequence,
        operation,
        state,
        code: code ? safeCode({ code }) : "",
        expected: expected ? safeCode({ code: expected }) : "",
        duration: Number.isFinite(duration)
          ? Math.min(999999, Math.max(0, Math.round(duration)))
          : 0,
        time: now(),
      }) as ResultEntry;
      entries.unshift(entry);
      if (entries.length > limit) {
        entries.pop();
      }
      return entry;
    },
    list: () => [...entries],
    clear() {
      entries.length = 0;
    },
  };
}

export function parseJsonInput(text: unknown, maxBytes = 4096): JsonValue {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > maxBytes
  ) {
    throw Object.assign(new Error("Input is too large"), {
      code: "MESSAGE_LIMIT",
    });
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw Object.assign(new Error("Invalid JSON"), {
      code: "INVALID_ARGUMENTS",
    });
  }
}

export function testKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,40}$/.test(value)) {
    throw Object.assign(new Error("Invalid test key"), {
      code: "INVALID_ARGUMENTS",
    });
  }
  return `capability-lab_${value}`;
}

export function createRunner(
  sdk: Pick<MiniAppSDK, "ready"> | null | undefined,
  {
    ledger = createLedger(),
    onChange = () => {},
    now = Date.now,
  }: {
    ledger?: ReturnType<typeof createLedger>;
    onChange?: (state: RunnerState) => void;
    now?: () => number;
  } = {}
) {
  let mode: RunnerState["mode"] = sdk ? "connecting" : "preview";
  let generation = 0;
  let next = 0;
  const pending = new Map<
    number,
    { operation: string; stamp: number; started: number }
  >();
  const notify = () =>
    onChange({
      mode,
      pending: pending.size,
      pendingOperations: [...pending.values()].map((item) => item.operation),
      entries: ledger.list(),
    });
  function record(operation: string, state: string, details?: ResultDetails) {
    const entry = ledger.add(operation, state, details);
    notify();
    return entry;
  }
  return {
    get mode() {
      return mode;
    },
    get busy() {
      return pending.size > 0;
    },
    async connect() {
      if (!sdk) {
        notify();
        return;
      }
      const stamp = generation;
      try {
        await sdk.ready;
        if (
          stamp !== generation ||
          (mode as RunnerState["mode"]) === "unloaded"
        ) {
          return;
        }
        mode = "connected";
      } catch {
        if (mode !== "unloaded") {
          mode = "disconnected";
        }
      }
      notify();
    },
    async run<T>(
      operation: string,
      action: () => T | Promise<T>,
      { expectedCode, onDiscard }: RunOptions<T> = {}
    ): Promise<RunResult<T>> {
      if (!allowedIds.has(operation)) {
        throw new Error("INVALID_RESULT");
      }
      if (mode !== "connected") {
        record(operation, mode === "unloaded" ? "unloaded" : "preview", {
          code: mode === "unloaded" ? "APP_UNLOADED" : "NOT_CONNECTED",
        });
        return { accepted: false };
      }
      if (
        pending.size >= 8 ||
        [...pending.values()].some((item) => item.operation === operation)
      ) {
        record(operation, "failed", { code: "BUSY" });
        return { accepted: false };
      }
      const id = ++next;
      const stamp = generation;
      const started = now();
      pending.set(id, { operation, stamp, started });
      record(operation, "pending");
      try {
        const value = await action();
        if (
          stamp !== generation ||
          (mode as RunnerState["mode"]) === "unloaded"
        ) {
          try {
            await onDiscard?.(value);
          } catch {}
          return { accepted: false };
        }
        record(operation, expectedCode ? "unexpectedSuccess" : "success", {
          duration: now() - started,
        });
        return { accepted: true, value };
      } catch (error) {
        if (
          stamp !== generation ||
          (mode as RunnerState["mode"]) === "unloaded"
        ) {
          return { accepted: false };
        }
        const code = safeCode(error);
        const state =
          expectedCode && code === expectedCode
            ? "expectedRejection"
            : resultState(error);
        if (state === "unloaded") {
          mode = "unloaded";
        }
        record(operation, state, {
          code,
          expected: expectedCode,
          duration: now() - started,
        });
        return { accepted: false, code };
      } finally {
        pending.delete(id);
        notify();
      }
    },
    stopWaiting() {
      generation++;
      for (const item of pending.values()) {
        record(item.operation, "stoppedWaiting", {
          duration: now() - item.started,
        });
      }
    },
    dispose() {
      generation++;
      mode = "unloaded";
      for (const item of pending.values()) {
        record(item.operation, "unloaded", { code: "APP_UNLOADED" });
      }
      notify();
    },
    record,
    clear() {
      ledger.clear();
      notify();
    },
  };
}
