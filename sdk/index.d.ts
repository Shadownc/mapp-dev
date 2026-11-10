// Generated from sdk/src by tools/build-sdk.ts.
import type { HttpMethod, JsonValue, Permission } from "./types.js";
export type { HttpMethod, JsonValue, Permission, RemoteAssetDeclaration, RemoteAssetMime, } from "./types.js";
export interface MiniAppUser {
    id: number;
    username: string;
    name: string;
    initials: string;
    /** Discourse trust level (0–4), or null if unavailable. */
    trustLevel: number | null;
    /** A 288px avatar as a session-local Blob URL, or null when unavailable. */
    avatarUrl: string | null;
}
/** Public query parameters and fragment supplied when opening the app. */
export interface MiniAppLaunchParameters {
    query: Record<string, string[]>;
    /** Preserves the encoded fragment without its leading #. */
    hash: string;
}
/** Appearance preferences for the app. */
export interface MiniAppTheme {
    mode: "light" | "dark";
    background: string;
    text: string;
    accent: string;
    border: string;
    /** Discourse locale code, such as zh_TW. */
    locale: string;
    reducedMotion: boolean;
    viewport: {
        width: number;
        height: number;
    };
}
export interface PlaybackOptions {
    /** Volume from 0 to 1; defaults to 1. */
    volume?: number;
    /** Repeat the approved asset until stopped; defaults to false. */
    loop?: boolean;
}
export interface MiniAppError extends Error {
    /** For example PERMISSION_DENIED, USER_CANCELLED, TIMEOUT or APP_UNLOADED. */
    code?: string;
}
export interface HttpRequestOptions {
    /** Must equal the endpoint's approved method when supplied. */
    method?: HttpMethod;
    query?: Record<string, string>;
    /** JSON only, up to 4 KiB. */
    json?: JsonValue;
    /** Headers are declared in the reviewed manifest, never supplied by the caller. */
    headers?: never;
}
export interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    body: JsonValue;
}
export interface SocketEvents {
    message: JsonValue;
    error: {
        code: string;
    };
    close: {
        code: number;
        reason: string;
    };
}
/** An SDK connection for exchanging JSON messages. */
export interface MiniAppSocket {
    readonly id: string;
    readonly readyState: "open" | "closing" | "closed";
    readonly ready: Promise<void>;
    /** Resolves when queued to the developer connection, before business processing. */
    send(data: JsonValue): Promise<null>;
    close(): Promise<null>;
    on<Event extends keyof SocketEvents>(event: Event, listener: (value: SocketEvents[Event]) => void): () => void;
}
/** Installed by the platform before the application's bundled script runs. */
export interface MiniAppSDK {
    /** Resolves when the communication channel connects, before app initialization finishes. */
    readonly ready: Promise<void>;
    /** Low-level, permission-checked RPC. Prefer the named methods below. */
    request(method: string, params?: {
        [key: string]: JsonValue;
    }): Promise<JsonValue>;
    readonly permissions: {
        list(): Permission[];
        has(permission: Permission): boolean;
    };
    readonly lifecycle: {
        /** Call once after the first render or an initialization error has been displayed. */
        ready(): Promise<void>;
    };
    readonly user: {
        /** Returns null for anonymous public/embed sessions. Requires user.read. */
        getCurrent(): Promise<MiniAppUser | null>;
        /** Requires user.lookup; uses community profile visibility and returns a basic data snapshot. */
        getById(userId: number): Promise<MiniAppUser>;
    };
    readonly launch: {
        /** Requires launch.read. Repeated query values retain their order; the snapshot never updates. */
        getParameters(): Promise<MiniAppLaunchParameters>;
    };
    readonly theme: {
        get(): Promise<MiniAppTheme>;
        /** Requires theme.read; returns an unsubscribe function. */
        onChange(listener: (theme: MiniAppTheme) => void): () => void;
    };
    /** Permission-controlled browser localStorage scoped to this app and environment. */
    readonly localStorage: {
        /** Coerces keys to strings, like the browser Storage API. */
        getItem(key: unknown): Promise<string | null>;
        /** Coerces both the key and value to strings before storing. */
        setItem(key: unknown, value: unknown): Promise<null>;
        removeItem(key: unknown): Promise<null>;
        clear(): Promise<null>;
    };
    /** Browser cookies restricted to this app prefix and app route. */
    readonly cookies: {
        get(name: string): Promise<string | null>;
        set(name: string, value: string, options?: {
            maxAge?: number;
        }): Promise<null>;
        remove(name: string): Promise<null>;
    };
    readonly clipboard: {
        readText(): Promise<string>;
        writeText(text: string): Promise<null>;
    };
    readonly fullscreen: {
        request(): Promise<{
            active: boolean;
        }>;
        exit(): Promise<{
            active: boolean;
        }>;
    };
    readonly audio: {
        /**
         * Requires audio.play; returns an independent playback handle without prompting.
         * Muting only silences output; playback, progress and remote downloads continue.
         * Allows four simultaneous sounds and 20 calls per second; excess sounds are rejected, not queued.
         */
        play(asset: string, options?: PlaybackOptions): Promise<{
            handle: string;
        }>;
        /**
         * Stops one playback handle without prompting, whether or not this run is muted.
         * Exempt from play and general per-minute quotas; total pending and message limits still apply.
         */
        stop(handle: string): Promise<null>;
    };
    readonly video: {
        play(asset: string, options?: PlaybackOptions): Promise<{
            handle: string;
        }>;
        stop(handle: string): Promise<null>;
    };
    readonly http: {
        /** Requires network.request. Returns bounded JSON and selected response headers. */
        request(endpoint: string, options?: HttpRequestOptions): Promise<HttpResponse>;
    };
    readonly webSocket: {
        /** Requires network.websocket and user.read; resolves after developer JWT authentication. */
        connect(endpoint: string, options?: {
            query?: Record<string, string>;
        }): Promise<MiniAppSocket>;
    };
    /** Reads files belonging to this ZIP; no remote URL or filesystem access. */
    readonly assets: {
        /** Reads binary resources; core text files are returned as UTF-8 bytes. */
        readBytes(path: string): Promise<Uint8Array<ArrayBuffer>>;
        /** Decodes a file as UTF-8, rejecting invalid text. */
        readText(path: string): Promise<string>;
        /** Reads and parses a JSON file. */
        readJson(path: string): Promise<JsonValue>;
    };
    /** Compiles and instantiates reviewed package-local WebAssembly files. */
    readonly wasm: {
        /** Requires a .wasm path declared in manifest.assets; remote files and URLs are rejected. */
        instantiate(path: string, imports?: WebAssembly.Imports): Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    };
}
/** Returns the app's SDK. */
export declare function getSDK(): MiniAppSDK;
