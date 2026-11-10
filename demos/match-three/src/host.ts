import type {
  JsonValue,
  MiniAppSDK,
  MiniAppTheme,
  MiniAppUser,
  Permission,
} from "@discourse-mini-app/sdk";

/** Capabilities used by the optional community adapter. */
export type HostSDK = Pick<MiniAppSDK, "ready"> & {
  permissions: Pick<MiniAppSDK["permissions"], "has">;
  user?: Pick<MiniAppSDK["user"], "getCurrent">;
  theme?: Pick<MiniAppSDK["theme"], "get" | "onChange">;
  localStorage?: Partial<MiniAppSDK["localStorage"]>;
  lifecycle?: MiniAppSDK["lifecycle"];
};

/** Connects a game to available platform capabilities without blocking local play. */
export function createHost(
  sdk: HostSDK | null,
  messages: Record<string, Record<string, string>>,
  callbacks: {
    onNotice?: (text: string) => void;
    onTheme?: (theme: MiniAppTheme) => void;
    onIdentity?: (user: MiniAppUser | null) => void;
    onMode?: (mode: "preview" | "connected" | "guest" | "disconnected") => void;
    onBest?: (best: number) => void;
  } = {}
) {
  let locale = "en";
  let connected = false;
  let best = 0;
  let unsubscribe: (() => void) | null | undefined;
  let session:
    | {
        user: MiniAppUser | null;
        mode: "preview" | "connected" | "guest" | "disconnected";
      }
    | undefined;
  let writes: Promise<unknown> = Promise.resolve();
  const t = (key: string, values: object = {}) =>
    (messages[locale]?.[key] ?? messages["zh_CN"][key] ?? key).replace(
      /\{(\w+)\}/g,
      (_: string, name: string) =>
        String((values as Record<string, unknown>)[name] ?? "")
    );
  const has = (permission: Permission) =>
    connected && sdk!.permissions.has(permission);
  const report = (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code;
    // Retain the underlying exception so a developer can identify the failing capability.
    // eslint-disable-next-line no-console
    console.warn("[match-three] Community API failed", error);
    callbacks.onNotice?.(
      t("apiError", {
        code:
          typeof code === "string"
            ? code
            : error instanceof Error
              ? error.name
              : "UNKNOWN_ERROR",
      })
    );
  };
  const applyTheme = (theme: MiniAppTheme) => {
    locale = Object.hasOwn(messages, theme.locale) ? theme.locale : "en";
    callbacks.onTheme?.(theme);
    if (session) {
      showSession(session.user, session.mode);
    }
  };
  function showSession(
    user: MiniAppUser | null,
    mode: "preview" | "connected" | "guest" | "disconnected"
  ) {
    session = { user, mode };
    callbacks.onIdentity?.(user);
    callbacks.onMode?.(mode);
  }
  async function call<T, F = null>(
    permission: Permission,
    action: () => T | Promise<T>,
    fallback: F = null as F
  ): Promise<T | F> {
    if (!has(permission)) {
      return fallback;
    }
    try {
      return await action();
    } catch (error) {
      report(error);
      return fallback;
    }
  }
  return {
    t,
    has,
    async connect() {
      unsubscribe?.();
      unsubscribe = null;
      if (!sdk) {
        showSession(null, "preview");
        return;
      }
      try {
        await sdk.ready;
        connected = true;
        if (has("theme.read")) {
          unsubscribe = sdk!.theme!.onChange(applyTheme);
          const theme = await call("theme.read", () => sdk!.theme!.get());
          if (theme) {
            applyTheme(theme);
          }
        }
        const [user, result] = await Promise.all([
          call("user.read", () => sdk!.user!.getCurrent()),
          call(
            "storage.read",
            () => sdk!.localStorage!.getItem!("best-score"),
            0
          ),
        ]);
        best = Math.max(
          best,
          Number.isSafeInteger(Number(result)) && Number(result) >= 0
            ? Number(result)
            : 0
        );
        callbacks.onBest?.(best);
        showSession(user, user ? "connected" : "guest");
      } catch (error) {
        showSession(null, "disconnected");
        report(error);
      }
    },
    async saveScore(score: number) {
      const previous = best;
      best = Math.max(best, score);
      callbacks.onBest?.(best);
      if (best === previous || !has("storage.write")) {
        return;
      }
      const snapshot = best;
      writes = writes.then(() =>
        call(
          "storage.write",
          async () => {
            await sdk!.localStorage!.setItem!("best-score", String(snapshot));
            return true;
          },
          false
        )
      );
      if (await writes) {
        callbacks.onNotice?.(t("saved"));
      }
    },
    load(key: string) {
      return call("storage.read", async () => {
        const value = await sdk!.localStorage!.getItem!(key);
        if (value === null) {
          return null;
        }
        try {
          return JSON.parse(value) as JsonValue;
        } catch {
          callbacks.onNotice?.(t("saveUnreadable"));
          return null;
        }
      });
    },
    save(key: string, value: JsonValue) {
      const snapshot = JSON.stringify(value);
      writes = writes.then(() =>
        call("storage.write", () => sdk!.localStorage!.setItem!(key, snapshot))
      );
      return writes;
    },
    async rendered() {
      if (sdk) {
        try {
          await sdk.lifecycle!.ready();
        } catch (error) {
          report(error);
        }
      }
    },
    dispose() {
      connected = false;
      unsubscribe?.();
    },
  };
}
