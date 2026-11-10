import "./style.css";
import type {
  HttpMethod,
  HttpRequestOptions,
  MiniAppSDK,
  MiniAppSocket,
  MiniAppTheme,
  Permission,
} from "@discourse-mini-app/sdk";
import { getSDK } from "@discourse-mini-app/sdk";
import manifest from "../manifest.json";
import type { PointerSnapshot } from "./pointer.ts";
import { createPointerSample } from "./pointer.ts";
import type { PointerLockSnapshot } from "./pointer-lock.ts";
import { createPointerLockSample } from "./pointer-lock.ts";
import type { RunnerState, RunOptions } from "./state.ts";
import {
  createRunner,
  parseJsonInput,
  resultState,
  safeCode,
  testKey,
} from "./state.ts";
import messages from "./strings.json";
import type { ToneSnapshot } from "./web-audio.ts";
import { createToneSample } from "./web-audio.ts";

type TemplateElements = {
  lab: HTMLElement;
  language: HTMLSelectElement;
  "session-title": HTMLElement;
  connection: HTMLElement;
  "connection-detail": HTMLElement;
  layout: HTMLElement;
  "layout-title": HTMLElement;
  dimensions: HTMLOutputElement;
  width: HTMLSelectElement;
  appearance: HTMLSelectElement;
  direction: HTMLSelectElement;
  "large-type": HTMLInputElement;
  specimen: HTMLElement;
  "sample-form": HTMLFormElement;
  "sample-result": HTMLOutputElement;
  capabilities: HTMLElement;
  "capabilities-title": HTMLElement;
  permissions: HTMLElement;
  "lookup-user-id": HTMLInputElement;
  "identity-output": HTMLElement;
  "storage-key": HTMLInputElement;
  "storage-value": HTMLTextAreaElement;
  "allow-clear": HTMLInputElement;
  "storage-output": HTMLOutputElement;
  "cookie-value": HTMLInputElement;
  "cookie-age": HTMLInputElement;
  "cookie-output": HTMLOutputElement;
  "clipboard-value": HTMLInputElement;
  "native-output": HTMLOutputElement;
  "media-loop": HTMLInputElement;
  "media-output": HTMLOutputElement;
  "wasm-output": HTMLElement;
  "pointer-pad": HTMLButtonElement;
  "pointer-sound": HTMLInputElement;
  "pointer-output": HTMLOutputElement;
  "pointer-audio-output": HTMLOutputElement;
  "pointer-lock-request": HTMLButtonElement;
  "pointer-lock-exit": HTMLButtonElement;
  "pointer-lock-canvas": HTMLCanvasElement;
  "pointer-lock-output": HTMLOutputElement;
  "web-audio-play": HTMLButtonElement;
  "web-audio-stop": HTMLButtonElement;
  "web-audio-output": HTMLOutputElement;
  network: HTMLElement;
  "network-title": HTMLElement;
  "network-config": HTMLElement;
  "http-endpoint": HTMLInputElement;
  "http-method": HTMLSelectElement;
  "http-query": HTMLTextAreaElement;
  "http-body": HTMLTextAreaElement;
  "http-output": HTMLOutputElement;
  "socket-endpoint": HTMLInputElement;
  "socket-query": HTMLTextAreaElement;
  "socket-data": HTMLTextAreaElement;
  "socket-output": HTMLOutputElement;
  results: HTMLElement;
  "results-title": HTMLElement;
  pending: HTMLOutputElement;
  "stop-waiting": HTMLButtonElement;
  "clear-results": HTMLButtonElement;
  "clear-private": HTMLButtonElement;
  "result-list": HTMLElement;
  "empty-results": HTMLElement;
};

// IDs and data attributes come from the bundled template.
const element = <Id extends string>(id: Id) =>
  document.getElementById(id) as Id extends keyof TemplateElements
    ? TemplateElements[Id]
    : HTMLElement;
const lab = element("lab");
let locale: keyof typeof messages = "en";
let manualLocale = false;
let sdk: MiniAppSDK | undefined;
let missingPlatform = false;
if (!import.meta.env.DEV) {
  try {
    sdk = getSDK();
  } catch {
    missingPlatform = true;
  }
}
let socket: MiniAppSocket | null | undefined;
let socketOff: Array<() => void> = [];
let received = 0;
let audioHandle: string | null | undefined;
let videoHandle: string | null | undefined;
let unsubscribeTheme: (() => void) | undefined;
let stopped = false;
let latestState: RunnerState | undefined;
let pointerSnapshot: PointerSnapshot = { active: false, status: "pointerIdle" };
let toneSnapshot: ToneSnapshot | undefined;
let toneFailure: string | undefined;
let lockSnapshot: PointerLockSnapshot = {
  phase: "idle",
  movementX: 0,
  movementY: 0,
  totalX: 0,
  totalY: 0,
};
let lockFailure: string | undefined;
const sampleCookieName = testKey("sample");
const operationOutputs: Record<string, string> = Object.fromEntries([
  ...["user", "userLookup", "launch", "theme", "assets"].map((name) => [
    name,
    "identity-output",
  ]),
  ...["storageRead", "storageWrite", "storageRemove", "storageClear"].map(
    (name) => [name, "storage-output"]
  ),
  ...["cookieRead", "cookieWrite", "cookieRemove"].map((name) => [
    name,
    "cookie-output",
  ]),
  ...[
    "clipboardRead",
    "clipboardWrite",
    "fullscreenEnter",
    "fullscreenExit",
  ].map((name) => [name, "native-output"]),
  ...["audioPlay", "audioStop", "videoPlay", "videoStop"].map((name) => [
    name,
    "media-output",
  ]),
  ["http", "http-output"],
  ["wasm", "wasm-output"],
  ["pointerAudio", "pointer-audio-output"],
  ...["socketConnect", "socketSend", "socketClose"].map((name) => [
    name,
    "socket-output",
  ]),
]);
const t = (key: string, values: Record<string, unknown> = {}) =>
  ((messages[locale] as Record<string, string>)[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_: string, name: string) => String(values[name] ?? "")
  );
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? "null").length;
const output = (id: string, value: string) => {
  const target = element(id);
  target.textContent = value;
  target.dataset.dynamic = "true";
};
const error = (code: string) => Object.assign(new Error(code), { code });
const runner = createRunner(sdk, { onChange: renderState });

function dimensions() {
  const rect = lab.getBoundingClientRect();
  output(
    "dimensions",
    t("dimensions", {
      width: Math.round(rect.width),
      height: Math.round(window.innerHeight),
      orientation: t(
        rect.width > window.innerHeight ? "landscape" : "portrait"
      ),
    })
  );
}

function renderPermissions() {
  const items = manifest.permissions.map((permission) => {
    const item = document.createElement("li");
    const name = document.createElement("code");
    name.textContent = permission;
    const status = document.createElement("span");
    const connected = runner.mode === "connected";
    const granted = connected && sdk!.permissions.has(permission as Permission);
    status.textContent = t(
      connected ? (granted ? "granted" : "notGranted") : "notConnected"
    );
    status.className = granted
      ? "lab__permission-state is-granted"
      : "lab__permission-state";
    item.append(name, status);
    return item;
  });
  element("permissions").replaceChildren(...items);
}

function renderState(state: RunnerState) {
  latestState = state;
  const mode = missingPlatform ? "disconnected" : state.mode;
  output("connection", t(mode));
  output("connection-detail", t(`${mode}Detail`));
  lab.dataset.connection = mode;
  output("pending", t("pendingCount", { count: state.pending }));
  element("stop-waiting").disabled = state.pending === 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-action]"
  )) {
    button.disabled = state.mode !== "connected";
  }
  const rows = state.entries.map((entry) => {
    const item = document.createElement("li");
    item.className = "lab__result";
    item.dataset.state = entry.state;
    const title = document.createElement("strong");
    title.textContent = t(entry.operation);
    const status = document.createElement("span");
    status.textContent = t(entry.state);
    const detail = document.createElement("code");
    detail.textContent = entry.code;
    const duration = document.createElement("span");
    duration.className = "lab__result-duration";
    duration.textContent = t("duration", { ms: entry.duration });
    item.append(title, status, detail, duration);
    return item;
  });
  element("result-list").replaceChildren(...rows);
  element("empty-results").hidden = rows.length > 0;
  renderPermissions();
  if (state.mode !== "connected") {
    output("wasm-output", t("wasmPreview"));
  }
  renderTone();
  renderPointerLock();
}

function renderPointerLock() {
  const permitted =
    runner.mode === "connected" && sdk!.permissions.has("pointer.lock");
  element("pointer-lock-request").disabled =
    !permitted ||
    ["requesting", "locked", "exiting"].includes(lockSnapshot.phase);
  element("pointer-lock-exit").disabled = !["requesting", "locked"].includes(
    lockSnapshot.phase
  );
  if (runner.mode !== "connected") {
    output("pointer-lock-output", t("pointerLockPreview"));
  } else if (!permitted) {
    output("pointer-lock-output", t("pointerLockPermission"));
  } else {
    const failure = lockFailure
      ? `\n${t("operationError", {
          state: t(resultState({ code: lockFailure })),
          code: lockFailure,
        })}`
      : "";
    output(
      "pointer-lock-output",
      t("pointerLockState", {
        state: t(`pointerLock_${lockSnapshot.phase}`),
        x: lockSnapshot.movementX,
        y: lockSnapshot.movementY,
        totalX: lockSnapshot.totalX,
        totalY: lockSnapshot.totalY,
      }) + failure
    );
  }
  const canvas = element("pointer-lock-canvas");
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = getComputedStyle(lab).color;
    const x =
      (((canvas.width / 2 + lockSnapshot.totalX) % canvas.width) +
        canvas.width) %
      canvas.width;
    const y =
      (((canvas.height / 2 + lockSnapshot.totalY) % canvas.height) +
        canvas.height) %
      canvas.height;
    context.fillRect(x - 6, y - 1, 12, 2);
    context.fillRect(x - 1, y - 6, 2, 12);
  }
}

function renderTone() {
  const permitted =
    runner.mode === "connected" && sdk!.permissions.has("audio.webAudio");
  element("web-audio-play").disabled =
    !permitted || Boolean(toneSnapshot?.active);
  element("web-audio-stop").disabled = !toneSnapshot?.active;
  if (runner.mode !== "connected") {
    output("web-audio-output", t("webAudioPreview"));
  } else if (!permitted) {
    output("web-audio-output", t("webAudioPermission"));
  } else if (toneFailure) {
    output(
      "web-audio-output",
      t("operationError", {
        state: t(resultState({ code: toneFailure })),
        code: toneFailure,
      })
    );
  } else if (toneSnapshot) {
    output(
      "web-audio-output",
      t("webAudioState", { state: toneSnapshot.state })
    );
  } else {
    output("web-audio-output", t("notTested"));
  }
}

function localize() {
  document.documentElement.lang = locale;
  element("language").value = locale;
  document.querySelectorAll<HTMLElement>("[data-text]").forEach((node) => {
    if (!node.dataset.dynamic) {
      node.textContent = t(node.dataset.text!);
    }
  });
  document.querySelectorAll<HTMLElement>("[data-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.label!));
  });
  const http = Object.keys(manifest.endpoints || {}).length;
  const ws = Object.keys(manifest.websockets || {}).length;
  output(
    "network-config",
    t(http || ws ? "networkConfigured" : "networkNotConfigured", { http, ws })
  );
  if (latestState) {
    renderState(latestState);
  }
  dimensions();
  output("pointer-output", t(pointerSnapshot.status));
}

function applyTheme(theme: MiniAppTheme) {
  if (stopped) {
    return;
  }
  for (const [property, color] of Object.entries({
    surface: theme.background,
    ink: theme.text,
    accent: theme.accent,
    border: theme.border,
  })) {
    if (typeof color === "string" && CSS.supports("color", color)) {
      lab.style.setProperty(`--lab-${property}`, color);
      if (property === "surface") {
        document.body.style.backgroundColor = color;
      }
    }
  }
  lab.style.colorScheme = theme.mode;
  lab.dataset.colorMode = theme.mode;
  lab.dataset.reducedMotion = String(theme.reducedMotion);
  if (!manualLocale && theme.locale) {
    locale = Object.hasOwn(messages, theme.locale)
      ? (theme.locale as keyof typeof messages)
      : "en";
    localize();
  }
}

async function run<T>(
  operation: string,
  action: () => T | Promise<T>,
  after?: ((value: T) => unknown) | null,
  options?: RunOptions<T>
): Promise<void> {
  const target = operationOutputs[operation];
  if (target) {
    output(target, t("pending"));
  }
  const result = await runner.run(operation, action, options);
  if (result.accepted && !stopped) {
    if (after) {
      after(result.value);
    } else if (target) {
      output(target, t("completed"));
    }
  } else if (result.code && target && !stopped) {
    output(
      target,
      t("operationError", {
        state: t(resultState({ code: result.code })),
        code: result.code,
      })
    );
  }
}

function readKey() {
  return testKey(element("storage-key").value);
}
function numberInput(id: "cookie-age", min: number, max: number) {
  const value = Number(element(id).value);
  if (
    !element(id).value ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw error("INVALID_ARGUMENTS");
  }
  return value;
}
function dataOutput(id: string, value: unknown) {
  output(id, JSON.stringify(value ?? null, null, 2).slice(0, 4096));
}
function networkOutput(id: string, summary: string, value: unknown) {
  let content: string;
  try {
    content = JSON.stringify(value ?? null, null, 2);
  } catch {
    content = t("networkUnrenderable");
  }
  output(
    id,
    `${summary}\n${content.slice(0, 4096)}${content.length > 4096 ? `\n${t("networkTruncated")}` : ""}`
  );
}
function clearSocketListeners() {
  for (const off of socketOff.splice(0)) {
    off();
  }
}
function attachSocket(connection: MiniAppSocket) {
  clearSocketListeners();
  socket = connection;
  received = 0;
  output("socket-output", t("socketConnected"));
  socketOff = [
    connection.on("message", (data) => {
      if (stopped || socket !== connection) {
        return;
      }
      received++;
      networkOutput(
        "socket-output",
        t("socketReceived", { count: received, bytes: bytes(data) }),
        data
      );
      runner.record("socketMessage", "success");
    }),
    connection.on("error", (event) => {
      if (stopped || socket !== connection) {
        return;
      }
      const code = safeCode(event);
      output("socket-output", t("socketErrorText", { code }));
      runner.record("socketError", "failed", { code });
    }),
    connection.on("close", (event) => {
      if (stopped || socket !== connection) {
        return;
      }
      output("socket-output", t("socketClosed", { code: event.code }));
      runner.record("socketEnded", "success");
      socket = null;
      clearSocketListeners();
    }),
  ];
}

const actions: Record<string, () => Promise<void>> = {
  wasm: () =>
    run(
      "wasm",
      async () => {
        if (typeof sdk!.wasm?.instantiate !== "function") {
          throw error("API_UNSUPPORTED");
        }
        const { module, instance } =
          await sdk!.wasm.instantiate("wasm/answer.wasm");
        const answer = instance.exports.answer;
        if (typeof answer !== "function") {
          throw error("WASM_EXPORT_MISSING");
        }
        const value = answer();
        if (value !== 42) {
          throw error("WASM_RESULT_MISMATCH");
        }
        return {
          module:
            module instanceof WebAssembly.Module
              ? "WebAssembly.Module"
              : "unexpected",
          instance:
            instance instanceof WebAssembly.Instance
              ? "WebAssembly.Instance"
              : "unexpected",
          exports: WebAssembly.Module.exports(module),
          "answer()": value,
        };
      },
      (value) => dataOutput("wasm-output", value)
    ),
  permissions: () =>
    run("permissions", () => sdk!.permissions.list(), renderPermissions),
  user: () =>
    run(
      "user",
      () => sdk!.user.getCurrent(),
      (value) => {
        value === null
          ? output("identity-output", t("anonymous"))
          : dataOutput("identity-output", value);
      }
    ),
  userLookup: () =>
    run(
      "userLookup",
      () => {
        const userId = Number(element("lookup-user-id").value);
        if (!Number.isSafeInteger(userId) || userId === 0) {
          throw error("INVALID_ARGUMENTS");
        }
        return sdk!.user.getById(userId);
      },
      (value) => dataOutput("identity-output", value)
    ),
  launch: () =>
    run(
      "launch",
      () => sdk!.launch.getParameters(),
      (value) => dataOutput("identity-output", value)
    ),
  theme: () =>
    run(
      "theme",
      () => sdk!.theme.get(),
      (value) => {
        applyTheme(value);
        dataOutput("identity-output", value);
      }
    ),
  assets: () =>
    run(
      "assets",
      () => sdk!.assets.readJson("strings.json"),
      (value) =>
        output(
          "identity-output",
          t("assetSummary", { count: Object.keys(value as object).length })
        )
    ),
  storageWrite: () =>
    run(
      "storageWrite",
      () =>
        sdk!.localStorage.setItem(
          readKey(),
          JSON.stringify(parseJsonInput(element("storage-value").value))
        ),
      () => output("storage-output", t("written"))
    ),
  storageRead: () =>
    run(
      "storageRead",
      () => sdk!.localStorage.getItem(readKey()),
      (value) => dataOutput("storage-output", value)
    ),
  storageRemove: () =>
    run(
      "storageRemove",
      () => sdk!.localStorage.removeItem(readKey()),
      () => output("storage-output", t("written"))
    ),
  storageClear: () =>
    run(
      "storageClear",
      () => {
        if (!element("allow-clear").checked) {
          output("storage-output", t("confirmationRequired"));
          throw error("CONFIRMATION_REQUIRED");
        }
        return sdk!.localStorage.clear();
      },
      () => {
        element("allow-clear").checked = false;
        output("storage-output", t("written"));
      }
    ),
  cookieWrite: () =>
    run(
      "cookieWrite",
      () =>
        sdk!.cookies.set(sampleCookieName, element("cookie-value").value, {
          maxAge: numberInput("cookie-age", 0, 2592000),
        }),
      () => output("cookie-output", t("written"))
    ),
  cookieRead: () =>
    run(
      "cookieRead",
      () => sdk!.cookies.get(sampleCookieName),
      (value) => dataOutput("cookie-output", value)
    ),
  cookieRemove: () =>
    run(
      "cookieRemove",
      () => sdk!.cookies.remove(sampleCookieName),
      () => output("cookie-output", t("written"))
    ),
  clipboardRead: () =>
    run(
      "clipboardRead",
      async () => (await sdk!.clipboard.readText()).length,
      (count) => output("native-output", t("clipboardSize", { count }))
    ),
  clipboardWrite: () =>
    run(
      "clipboardWrite",
      () => sdk!.clipboard.writeText(element("clipboard-value").value),
      () => output("native-output", t("written"))
    ),
  fullscreenEnter: () =>
    run(
      "fullscreenEnter",
      () => sdk!.fullscreen.request(),
      (value) =>
        output(
          "native-output",
          t("fullscreenState", { active: t(value.active ? "yes" : "no") })
        )
    ),
  fullscreenExit: () =>
    run(
      "fullscreenExit",
      () => sdk!.fullscreen.exit(),
      (value) =>
        output(
          "native-output",
          t("fullscreenState", { active: t(value.active ? "yes" : "no") })
        )
    ),
  audioPlay: () =>
    run(
      "audioPlay",
      async () => {
        if (audioHandle) {
          await sdk!.audio.stop(audioHandle);
        }
        return sdk!.audio.play("chime", {
          volume: 0.2,
          loop: element("media-loop").checked,
        });
      },
      (value) => {
        audioHandle = value.handle;
        output("media-output", t("mediaStarted"));
      },
      { onDiscard: (value) => sdk!.audio.stop(value.handle) }
    ),
  audioStop: () =>
    run(
      "audioStop",
      async () => {
        if (!audioHandle) {
          output("media-output", t("noPlayback"));
          throw error("NOT_PLAYING");
        }
        await sdk!.audio.stop(audioHandle);
        audioHandle = null;
      },
      () => output("media-output", t("written"))
    ),
  videoPlay: () =>
    run(
      "videoPlay",
      async () => {
        if (videoHandle) {
          await sdk!.video.stop(videoHandle);
        }
        return sdk!.video.play("pattern", {
          volume: 0.2,
          loop: element("media-loop").checked,
        });
      },
      (value) => {
        videoHandle = value.handle;
        output("media-output", t("mediaStarted"));
      },
      { onDiscard: (value) => sdk!.video.stop(value.handle) }
    ),
  videoStop: () =>
    run(
      "videoStop",
      async () => {
        if (!videoHandle) {
          output("media-output", t("noPlayback"));
          throw error("NOT_PLAYING");
        }
        await sdk!.video.stop(videoHandle);
        videoHandle = null;
      },
      () => output("media-output", t("written"))
    ),
  http: () =>
    run(
      "http",
      () => {
        const method = element("http-method").value as HttpMethod;
        const options: HttpRequestOptions = {
          method,
          query: parseJsonInput(element("http-query").value, 2048) as Record<
            string,
            string
          >,
        };
        if (method !== "GET") {
          options.json = parseJsonInput(element("http-body").value);
        }
        return sdk!.http.request(element("http-endpoint").value, options);
      },
      (value) =>
        networkOutput(
          "http-output",
          t("httpResult", { status: value.status, bytes: bytes(value.body) }),
          { headers: value.headers, body: value.body }
        )
    ),
  socketConnect: () =>
    run(
      "socketConnect",
      () => {
        if (socket?.readyState === "open") {
          throw error("BUSY");
        }
        return sdk!.webSocket.connect(element("socket-endpoint").value, {
          query: parseJsonInput(element("socket-query").value, 2048) as Record<
            string,
            string
          >,
        });
      },
      attachSocket,
      { onDiscard: (value) => value.close() }
    ),
  socketSend: () =>
    run("socketSend", () => {
      if (!socket) {
        throw error("SOCKET_CLOSED");
      }
      return socket.send(parseJsonInput(element("socket-data").value));
    }),
  socketClose: () =>
    run("socketClose", async () => {
      if (!socket) {
        throw error("SOCKET_CLOSED");
      }
      const current = socket;
      await current.close();
      if (socket === current) {
        socket = null;
        clearSocketListeners();
        output("socket-output", t("socketClosed", { code: 1000 }));
      }
    }),
  rejectHeader: () =>
    run(
      "rejectHeader",
      // This deliberately invalid input exercises the SDK's caller-header rejection.
      () =>
        sdk!.http.request("unused", {
          headers: { Cookie: "test-only" },
        } as unknown as HttpRequestOptions),
      null,
      { expectedCode: "INVALID_ARGUMENTS" }
    ),
  rejectBody: () =>
    run(
      "rejectBody",
      () =>
        sdk!.http.request("unused", { method: "POST", json: "x".repeat(5000) }),
      null,
      { expectedCode: "MESSAGE_LIMIT" }
    ),
};

const pointerPad = element("pointer-pad");
const lockCanvas = element("pointer-lock-canvas");
const pointerLock = createPointerLockSample({
  request() {
    if (typeof lockCanvas.requestPointerLock !== "function") {
      throw error("API_UNSUPPORTED");
    }
    if (document.pointerLockElement) {
      throw error("POINTER_LOCK_BUSY");
    }
    return lockCanvas.requestPointerLock();
  },
  exit: () => document.exitPointerLock(),
  isLocked: () => document.pointerLockElement === lockCanvas,
  onChange(snapshot) {
    if (!stopped) {
      lockSnapshot = snapshot;
      renderPointerLock();
    }
  },
  onError(failure) {
    if (!stopped) {
      lockFailure = safeCode(failure);
      runner.record("pointerLock", resultState(failure), { code: lockFailure });
      renderPointerLock();
    }
  },
});
element("pointer-lock-request").addEventListener("click", () => {
  if (
    runner.mode !== "connected" ||
    !sdk!.permissions.has("pointer.lock") ||
    stopped
  ) {
    return;
  }
  lockFailure = undefined;
  pointerLock.request();
});
element("pointer-lock-exit").addEventListener("click", () =>
  pointerLock.release()
);
document.addEventListener("pointerlockchange", () => pointerLock.changed());
document.addEventListener("pointerlockerror", () =>
  pointerLock.failed(error("POINTER_LOCK_FAILED"))
);
document.addEventListener("mousemove", (event) =>
  pointerLock.move(event.movementX, event.movementY)
);
window.addEventListener("blur", () => pointerLock.release());
const toneSample = createToneSample({
  createContext() {
    if (typeof AudioContext !== "function") {
      throw error("API_UNSUPPORTED");
    }
    return new AudioContext();
  },
  onChange(snapshot) {
    if (!stopped) {
      toneSnapshot = snapshot;
      renderTone();
    }
  },
  onError(failure) {
    if (!stopped) {
      toneFailure = safeCode(failure);
      runner.record("webAudioPlay", resultState(failure), {
        code: toneFailure,
      });
      renderTone();
    }
  },
});
element("web-audio-play").addEventListener("click", () => {
  if (
    runner.mode !== "connected" ||
    !sdk!.permissions.has("audio.webAudio") ||
    stopped
  ) {
    renderTone();
    return;
  }
  toneFailure = undefined;
  try {
    toneSample.play();
  } catch (failure) {
    toneFailure = safeCode(failure);
    runner.record("webAudioPlay", resultState(failure), { code: toneFailure });
    renderTone();
  }
});
element("web-audio-stop").addEventListener("click", () => toneSample.stop());
const pointerSample = createPointerSample({
  capture(pointerId) {
    if (pointerId === -1) {
      return;
    }
    if (typeof pointerPad.setPointerCapture !== "function") {
      throw error("API_UNSUPPORTED");
    }
    pointerPad.setPointerCapture(pointerId);
    runner.record("pointerCapture", "success");
  },
  release(pointerId) {
    if (pointerId !== -1 && pointerPad.hasPointerCapture(pointerId)) {
      pointerPad.releasePointerCapture(pointerId);
    }
  },
  async play() {
    if (!element("pointer-sound").checked) {
      return null;
    }
    const result = await runner.run(
      "pointerAudio",
      () => sdk!.audio.play("chime", { volume: 0.2, loop: true }),
      {
        onDiscard: (value) => sdk!.audio.stop(value.handle),
      }
    );
    if (!stopped) {
      output(
        "pointer-audio-output",
        t(
          result.accepted
            ? "mediaStarted"
            : result.code
              ? resultState({ code: result.code })
              : "wasmPreview"
        )
      );
    }
    return result.accepted ? result.value : null;
  },
  stop: (handle) => sdk!.audio.stop(handle),
  onChange(snapshot) {
    pointerSnapshot = snapshot;
    pointerPad.classList.toggle("is-held", snapshot.active);
    pointerPad.setAttribute("aria-pressed", String(snapshot.active));
    output("pointer-output", t(snapshot.status));
  },
  onError(failure) {
    if (stopped) {
      return;
    }
    runner.record("pointerCapture", resultState(failure), {
      code: safeCode(failure),
    });
    output(
      "pointer-audio-output",
      t("operationError", {
        state: t(resultState(failure)),
        code: safeCode(failure),
      })
    );
  },
});
pointerPad.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || stopped) {
    return;
  }
  event.preventDefault();
  pointerPad.focus();
  pointerSample.begin(event.pointerId);
});
pointerPad.addEventListener("pointermove", (event) => {
  const rect = pointerPad.getBoundingClientRect();
  pointerSample.move(
    event.pointerId,
    event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
  );
});
pointerPad.addEventListener("keydown", (event) => {
  if ([" ", "Enter"].includes(event.key)) {
    event.preventDefault();
    if (!event.repeat && !stopped) {
      pointerSample.begin(-1);
    }
  }
});
pointerPad.addEventListener("keyup", (event) => {
  if ([" ", "Enter"].includes(event.key)) {
    event.preventDefault();
    pointerSample.finish("pointerReleased", -1);
  }
});
pointerPad.addEventListener("pointerup", (event) =>
  pointerSample.finish("pointerReleased", event.pointerId)
);
pointerPad.addEventListener("pointercancel", (event) =>
  pointerSample.finish("pointerCancelled", event.pointerId)
);
pointerPad.addEventListener("lostpointercapture", (event) =>
  pointerSample.finish("pointerCaptureLost", event.pointerId)
);
window.addEventListener("blur", () => pointerSample.finish("pointerBlurred"));
pointerPad.addEventListener("blur", () =>
  pointerSample.finish("pointerBlurred")
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pointerLock.release();
    pointerSample.finish("pointerHidden");
    toneSample.stop();
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-action]"
)) {
  button.addEventListener("click", () => {
    const operation = button.dataset.action!;
    const http = operation === "http";
    const ws = operation === "socketConnect";
    if (http || ws) {
      const name = element(http ? "http-endpoint" : "socket-endpoint").value;
      if (
        !Object.hasOwn(
          http ? manifest.endpoints || {} : manifest.websockets || {},
          name
        )
      ) {
        runner.record(operation, "notConfigured", { code: "NOT_CONFIGURED" });
        return;
      }
    }
    void actions[operation]();
  });
}
element("width").addEventListener("change", (event) => {
  element("specimen").classList.toggle(
    "is-narrow",
    (event.target as HTMLSelectElement).value === "narrow"
  );
  element("specimen").classList.toggle(
    "is-tablet",
    (event.target as HTMLSelectElement).value === "tablet"
  );
});
element("appearance").addEventListener("change", (event) => {
  element("specimen").classList.toggle(
    "is-light",
    (event.target as HTMLSelectElement).value === "light"
  );
  element("specimen").classList.toggle(
    "is-dark",
    (event.target as HTMLSelectElement).value === "dark"
  );
});
element("direction").addEventListener("change", (event) => {
  element("specimen").dir = (event.target as HTMLSelectElement).value;
});
element("large-type").addEventListener("change", (event) => {
  element("specimen").classList.toggle(
    "is-large-type",
    (event.target as HTMLInputElement).checked
  );
});
element("language").addEventListener("change", (event) => {
  manualLocale = true;
  locale = (event.target as HTMLSelectElement).value as keyof typeof messages;
  localize();
});
element("sample-form").addEventListener("submit", (event) => {
  event.preventDefault();
  output("sample-result", t("formValid"));
  runner.record("layoutForm", "success");
});
element("stop-waiting").addEventListener("click", () => {
  toneSample.stop();
  for (const operation of latestState!.pendingOperations || []) {
    if (operationOutputs[operation]) {
      output(operationOutputs[operation], t("stoppedWaiting"));
    }
  }
  runner.stopWaiting();
});
element("clear-results").addEventListener("click", () => runner.clear());
element("clear-private").addEventListener("click", () => {
  for (const id of [
    "identity-output",
    "storage-output",
    "cookie-output",
    "native-output",
    "http-output",
    "socket-output",
  ]) {
    output(id, t("notTested"));
  }
});

localize();
renderState({ mode: runner.mode, pending: 0, entries: [] });
const observer = new ResizeObserver(dimensions);
observer.observe(lab);
window.addEventListener("resize", dimensions);
async function initialize() {
  await runner.connect();
  if (runner.mode === "connected") {
    if (sdk!.permissions.has("theme.read")) {
      unsubscribeTheme = sdk!.theme.onChange(applyTheme);
    }
    await sdk!.lifecycle
      .ready()
      .catch((failure) =>
        runner.record("permissions", "failed", { code: safeCode(failure) })
      );
  }
}
void initialize();
window.addEventListener("pagehide", () => {
  pointerLock.dispose();
  pointerSample.finish("pointerHidden");
  toneSample.stop();
  stopped = true;
  runner.dispose();
  observer.disconnect();
  unsubscribeTheme?.();
  clearSocketListeners();
  socket?.close().catch(() => {});
  if (audioHandle) {
    sdk!.audio.stop(audioHandle).catch(() => {});
  }
  if (videoHandle) {
    sdk!.video.stop(videoHandle).catch(() => {});
  }
  socket = null;
  audioHandle = videoHandle = null;
});
