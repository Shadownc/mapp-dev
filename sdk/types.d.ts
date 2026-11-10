// Generated from sdk/src by tools/build-sdk.ts.
export type Permission = "user.read" | "user.lookup" | "launch.read" | "theme.read" | "storage.read" | "storage.write" | "cookies.read" | "cookies.write" | "clipboard.read" | "clipboard.write" | "fullscreen" | "pointer.lock" | "audio.play" | "audio.webAudio" | "video.play" | "assets.remote" | "network.request" | "network.websocket";
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/** Static CDN resource formats accepted by the platform. */
export type RemoteAssetMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" | "audio/wav" | "audio/mpeg" | "audio/ogg" | "video/mp4" | "video/webm" | "application/json" | "application/octet-stream";
/** Immutable remote file approved together with the application manifest. */
export interface RemoteAssetDeclaration {
    /** Fixed HTTPS resource URL; callers cannot add query parameters or credentials. */
    url: string;
    /** Lowercase SHA-256 of the response bytes after HTTP content decoding. */
    sha256: string;
    /** Exact file byte length, at most 32 MiB. */
    size: number;
    /** Expected response media type, excluding parameters. */
    mime: RemoteAssetMime;
}
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
