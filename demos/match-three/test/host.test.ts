import type { MiniAppTheme, MiniAppUser } from "@discourse-mini-app/sdk";
import { describe, expect, test } from "bun:test";
import { createHost } from "../src/host.ts";
import messages from "../src/strings.json";

describe("optional community capabilities", () => {
  test("keeps the connected identity after theme and locale changes relocalize the page", async () => {
    // Theme fixtures contain only the fields this adapter reads for localization.
    let changeTheme: (theme: MiniAppTheme) => void;
    const user = {
      id: 1,
      username: "ada",
      name: "Ada",
      initials: "A",
      trustLevel: 1,
      avatarUrl: null,
    };
    const labels: { identity?: string; mode?: string } = {};
    const host = createHost(
      {
        ready: Promise.resolve(),
        permissions: {
          has: (name) => ["user.read", "theme.read"].includes(name),
        },
        user: { getCurrent: async () => user },
        theme: {
          get: async () => ({ locale: "en", mode: "light" }) as MiniAppTheme,
          onChange(callback) {
            changeTheme = callback;
            return () => {};
          },
        },
      },
      messages,
      {
        onTheme() {
          labels.identity = "Connecting";
          labels.mode = "Connecting";
        },
        onIdentity: (identity) => {
          labels.identity = identity?.name;
        },
        onMode: (mode) => {
          labels.mode = host.t(mode);
        },
      }
    );
    await host.connect();
    changeTheme!({ locale: "zh_CN", mode: "dark" } as MiniAppTheme);
    expect(labels).toEqual({
      identity: user.name,
      mode: messages["zh_CN"].connected,
    });
    changeTheme!({ locale: "en", mode: "light" } as MiniAppTheme);
    expect(labels).toEqual({
      identity: user.name,
      mode: messages.en.connected,
    });
  });

  test("local preview has no identity and keeps scores only in memory", async () => {
    const events: Array<MiniAppUser | string | number | null> = [];
    const host = createHost(null, messages, {
      onIdentity: (user) => events.push(user),
      onMode: (mode) => events.push(mode),
      onBest: (best) => events.push(best),
    });
    await host.connect();
    await host.saveScore(20);
    await host.save("state", { score: 20 });
    expect(await host.load("state")).toBeNull();
    expect(host.has("user.read")).toBe(false);
    expect(events).toEqual([null, "preview", 20]);
  });

  test("missing permissions skip API calls and still complete initialization", async () => {
    let rendered = false;
    const host = createHost(
      {
        ready: Promise.resolve(),
        permissions: { has: () => false },
        lifecycle: {
          ready: async () => {
            rendered = true;
          },
        },
      },
      messages
    );
    await host.connect();
    await host.saveScore(50);
    await host.save("state", {});
    expect(await host.load("state")).toBeNull();
    await host.rendered();
    expect(rendered).toBe(true);
  });

  test("revoked permissions return a guest session without an unhandled rejection", async () => {
    const identities: Array<MiniAppUser | null> = [];
    const rejected = async () => {
      throw Object.assign(new Error("Denied"), { code: "PERMISSION_DENIED" });
    };
    const host = createHost(
      {
        ready: Promise.resolve(),
        permissions: {
          has: (name) => ["user.read", "storage.read"].includes(name),
        },
        user: { getCurrent: rejected },
        localStorage: { getItem: rejected },
      },
      messages,
      { onIdentity: (user) => identities.push(user) }
    );
    await host.connect();
    expect(await host.load("state")).toBeNull();
    expect(identities).toEqual([null]);
  });

  test("stores the game's own best score through generic storage", async () => {
    const saved: Array<[string, unknown]> = [];
    const displayed: number[] = [];
    const host = createHost(
      {
        ready: Promise.resolve(),
        permissions: {
          has: (name) => ["storage.read", "storage.write"].includes(name),
        },
        localStorage: {
          getItem: async (key) => (key === "best-score" ? "7" : null),
          setItem: async (key, value) => {
            saved.push([String(key), Number(value)]);
            return null;
          },
        },
      },
      messages,
      { onBest: (best) => displayed.push(best) }
    );
    await host.connect();
    await host.saveScore(12);
    await host.saveScore(4);
    expect(saved).toEqual([["best-score", 12]]);
    expect(displayed).toEqual([7, 12, 12]);
  });

  test("serializes saved snapshots so a new game cannot be overwritten by an older write", async () => {
    const saved: number[] = [];
    let release: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = createHost(
      {
        ready: Promise.resolve(),
        permissions: { has: (name) => name === "storage.write" },
        localStorage: {
          setItem: async (_key, value) => {
            if ((JSON.parse(String(value)) as { score: number }).score === 4) {
              await firstWrite;
            }
            saved.push((JSON.parse(String(value)) as { score: number }).score);
            return null;
          },
        },
      },
      messages
    );
    await host.connect();
    const state = { score: 4 };
    const old = host.save("state", state);
    state.score = 999;
    const fresh = host.save("state", { score: 0 });
    release!();
    await Promise.all([old, fresh]);
    expect(saved).toEqual([4, 0]);
  });
});
