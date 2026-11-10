# @discourse-mini-app/sdk

通过 `getSDK()` 获取 SDK，等待 `sdk.ready` 后调用 API。完成首次渲染或显示错误后，调用 `lifecycle.ready()`。

```ts
import { getSDK } from "@discourse-mini-app/sdk";

const sdk = getSDK();
await sdk.ready;
try {
  const user = sdk.permissions.has("user.read")
    ? await sdk.user.getCurrent()
    : null;
  const player = document.getElementById("player");
  if (player) player.textContent = user?.name ?? "访客";
} finally {
  await sdk.lifecycle.ready();
}
```

## 权限与 API

| 权限                                 | 方法                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| `user.read`                          | `user.getCurrent()`                                               |
| `user.lookup`                        | `user.getById(userId)`                                            |
| `launch.read`                        | `launch.getParameters()`                                          |
| `theme.read`                         | `theme.get()`、`theme.onChange(callback)`                         |
| `storage.read` / `storage.write`     | `localStorage.getItem/setItem/removeItem/clear`                   |
| `cookies.read` / `cookies.write`     | `cookies.get/set/remove`                                          |
| `clipboard.read` / `clipboard.write` | `clipboard.readText/writeText`                                    |
| `fullscreen`                         | `fullscreen.request/exit`                                         |
| `pointer.lock`                       | 原生 `Element.requestPointerLock()`、`document.exitPointerLock()` |
| `audio.play` / `video.play`          | `audio.play(assetId)`、`video.play(assetId)`、对应 `stop(handle)` |
| `audio.webAudio`                     | 原生在线 `AudioContext`，调用方式仍为浏览器 API                   |
| `network.request`                    | `http.request(endpointName, options)`                             |
| `network.websocket`                  | `webSocket.connect(endpointName, options)`                        |
| `assets.remote`                      | `assets.readBytes/readText/readJson(path)` 读取声明的 CDN 素材    |

先检查 `sdk.permissions.has()`，并处理 Promise 拒绝。匿名模式的用户为 `null`，不能查询其他用户、使用剪贴板或通用 HTTP/WS；获批的固定 CDN 素材仍可读取。

- 用户资料包含 `id/username/name/initials/trustLevel/avatarUrl`。使用 `id` 关联用户数据和判断身份，用户名只用于展示。`trustLevel` 是 0–4 的论坛信任等级，未提供时为 `null`；它是展示信息，不是开发者服务器的授权凭据。
- `avatarUrl` 是请求 288 像素头像后得到的本次运行内 Blob URL，可直接设置为图片的 `src`。读取失败、头像缺失或头像资源预算用尽时为 `null`，可回退显示 `initials`。不要持久化或手动回收这个地址；离开微应用后会失效。每次运行最多保留 128 张头像、合计 8 MiB，单张最多 256 KiB。
- 头像支持 PNG、JPEG、GIF、WebP 和 AVIF。不支持的图片格式返回 `null`。
- 主题包含颜色、明暗、语言、容器尺寸和减少动效偏好；`onChange` 返回取消订阅函数。
- 启动参数返回 `{ query: Record<string, string[]>, hash }` 快照；重复 query 保留，hash 不含 `#`。总量最多 8 KiB，不能作为身份凭据。
- `audio.play/video.play` 只播放 manifest 声明的包内资源或固定 CDN 素材。远程媒体同时需要 `assets.remote` 和对应播放权限。剪贴板文字最多 4 KiB；剪贴板、全屏和视频播放逐次确认。音频输出由本次运行的声音开关控制。
- 一般调用最多 60 次/分钟。`audio.play` 使用独立的 20 次/秒额度；`audio.stop` 不占这两项额度。所有调用合计最多 16 个待响应请求，并受每秒 120 条消息的总限制。处理 `PERMISSION_DENIED`、`USER_CANCELLED`、`TIMEOUT`、`RATE_LIMIT`、`MESSAGE_LIMIT` 和离开后的 `APP_UNLOADED`。

获取当前论坛界面语言需 `theme.read`，语言代码沿用 Discourse，例如 `zh_CN`、`zh_TW`、`en`：

```ts
const { locale } = await sdk.theme.get();
const unsubscribe = sdk.theme.onChange(({ locale }) => updateLanguage(locale));
```

## 鼠标锁定

需要鼠标锁定时，在 manifest 的 `permissions` 中加入 `pointer.lock` 并提审。批准后直接使用原生 `Element.requestPointerLock()`，没有 `sdk.pointerLock` 包装或平台额外确认框。`mousemove` 的 `movementX/movementY` 是应用内原生事件，不经过 RPC。

在应用自己的用户点击处理函数中、首个 `await` 之前发起请求。浏览器可能返回 Promise 或 `void`；处理同步异常与 Promise 拒绝，并以 `pointerlockchange`、`pointerlockerror` 和 `document.pointerLockElement` 确认结果，不能把方法返回视为成功。

使用 `document.exitPointerLock()` 或 Esc 退出；应用失焦、隐藏或关闭时会自动释放，不自动重锁。优先使用不带选项的标准锁；`unadjustedMovement` 是可选能力，不支持时提供标准锁入口，让用户点击重试。

全屏仍使用 `sdk.fullscreen.request/exit`。若同时需要全屏和锁定，先通过 SDK 进入全屏，再让用户在应用内点击锁定；不要在 `await sdk.fullscreen.request()` 后直接请求原生锁定，此时最初的用户激活已不可依赖。

已有原生锁定代码只需新增权限、重新打包提审，调用方式不变；未使用锁定的应用无需申请。`setPointerCapture()` 用于拖动和长按，不需要 `pointer.lock`，见 [开发说明](../docs/developer-guide.md#鼠标锁定)。

## 音频播放

获批 `audio.webAudio`，或同时获批 `audio.play` 并声明了音频素材的应用，在代码执行前让用户选择初始声音状态。运行中可通过顶部喇叭随时开启声音或静音；开关只影响本次运行，关闭或刷新后重选。`audio.play/stop` 不弹框，音频由应用控制，平台只提供总声音开关，不显示音频列表或暂停、停止按钮；视频保留原有播放器界面。

静音只关闭输出，既有和新音频仍正常播放、保留进度及独立的 `{ handle }`，也可下载声明的远程音频。`stop(handle)` 照常停止对应音频；取消静音会恢复当前背景音乐或循环音频的声音，不补播已结束的短音效。

仅使用 `sdk.audio.play/stop` 的现有应用保持兼容，无需增加 `audio.webAudio` 或为声音开关重新打包。使用原生在线 `AudioContext` 的应用需申请 `audio.webAudio` 并重新提审；API 调用仍使用浏览器原生接口。

每个实例最多同时播放 4 路音频、2 路视频；满额直接拒绝新播放，不排队补播。音效不应阻塞输入状态；长按开始时先更新状态，松手早于 `play` 返回时应在取得句柄后立即停止。处理失败，不要循环重试，见 [长按操作示例](../docs/developer-guide.md#音频与长按操作)。

## 原生 Web Audio

获批 `audio.webAudio` 后可使用 `new AudioContext()`。顶部喇叭同步控制其总输出；静音不暂停音频时钟、节点调度或播放进度。每次运行最多保留 4 个未关闭的在线 context，成功 `close()` 后释放名额；退出应用会关闭这些 context。

浏览器的用户手势要求仍然存在：在应用自己的点击处理函数中调用 `context.resume()`，并处理拒绝。先完成首次渲染并调用 `sdk.lifecycle.ready()`，不要等待音频启动或 `resume()` 完成后才显示界面。

`OfflineAudioContext` 可用于离线处理，无需 `audio.webAudio`，也不直接发声。不支持 `createMediaStreamDestination()` 或 AudioWorklet 脚本加载。

## 包内文件

读取只限当前包的基础文件和声明资源，不需要额外权限。三个方法均为异步：

| 方法                               | 返回内容                                                    |
| ---------------------------------- | ----------------------------------------------------------- |
| `await sdk.assets.readText(path)`  | UTF-8 文字                                                  |
| `await sdk.assets.readJson(path)`  | JSON 数据，例如 `await sdk.assets.readJson("strings.json")` |
| `await sdk.assets.readBytes(path)` | 文件字节；基础文本按 UTF-8 返回                             |

普通资源在 manifest 的 `assets` 路径数组中声明；`media` 已声明的文件不要重复列入。包内图片使用 Blob，例如：

```ts
const bytes = await sdk.assets.readBytes("images/logo.png");
const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
const logo = new Image();
logo.src = url;
document.body.append(logo);
// 图片不再使用时：URL.revokeObjectURL(url)
```

图片使用读取到的字节创建 Blob，或使用用户资料接口提供的 Blob 地址；音视频在 `media` 声明后使用 `sdk.audio/video.play()`。包内单文件最多 8 MiB，整个 ZIP 的文件数和大小限制见 [开发说明](../docs/developer-guide.md#项目和运行-zip)。

## WebAssembly

单线程 WASM 文件放入运行 ZIP，并在普通 `assets` 中声明，例如 `"assets": ["wasm/answer.wasm"]`。不需要新增 WASM 权限，仍遵守包内单文件 8 MiB 等限制：

```ts
const { module, instance } = await sdk.wasm.instantiate("wasm/answer.wasm");
const answer = instance.exports.answer;
if (typeof answer === "function") console.log(answer());
```

`instantiate(path, imports?)` 接收原生 WebAssembly imports，返回原生 `module` 和 `instance`。只接受本地已声明的 `.wasm` 路径，不接受 URL、未声明文件或 `remote_assets`。此方法的路径限制不代表浏览器原生 WebAssembly 的所有字节来源都受它约束。

读取前后及编译完成后会检查应用生命周期，退出后以 `APP_UNLOADED` 拒绝，避免随后执行模块 start。不可用的浏览器 API 返回 `API_UNSUPPORTED`，非法路径返回 `ASSET_NOT_FOUND`；文件读取错误与原生 `CompileError`、`LinkError`、`RuntimeError` 原样传播。`CompileError` 也可能来自浏览器策略，不能一概视为文件语法错误。

JS `eval`/`new Function`、Worker、SharedArrayBuffer 和多线程 WASM 仍不开放。JSPI、WASM GC 依赖浏览器原生特性检测，SDK 不提供兼容层或统一支持保证。

## CDN 素材

通过 manifest 的 `remote_assets` 固定素材 URL、SHA-256、字节数与 MIME，并申请 `assets.remote`。虚拟路径不能与包内文件重名，不放入 `assets` 或 ZIP；`media.path` 可以指向远程素材，但 MIME 必须匹配。完整声明和构建步骤见 [开发者 CDN 素材](../docs/developer-guide.md#开发者-cdn-素材)。

```ts
if (sdk.permissions.has("assets.remote")) {
  const bytes = await sdk.assets.readBytes("images/atlas.webp");
  const atlasUrl = URL.createObjectURL(
    new Blob([bytes], { type: "image/webp" })
  );
  // 将 atlasUrl 设置为图片 src；不用时调用 URL.revokeObjectURL(atlasUrl)。
  if (sdk.permissions.has("audio.play")) {
    await sdk.audio.play("music", { volume: 0.5, loop: true });
  }
}
```

`readText` 使用 UTF-8，`readJson` 继续解析 JSON，`readBytes` 返回文件原始字节。只传已声明的虚拟路径，不能传任意 URL。每个清单最多 128 项、每项 32 MiB、总计 256 MiB；并发下载最多 2 个不同文件，下载截止 30 秒，当前实例的已验证缓存最多 64 MiB。相同文件的并发读取合并；只在每次下载后校验一次，缓存命中复用已验证结果。

远程读取的 SDK 调用期限为 45 秒（含排队），远程音视频播放为 105 秒（含下载；视频还包括逐次确认），包内播放调用为 60 秒。这些是调用上限，音频运行中不等待确认。图片、音效和关卡数据应分批按需加载；视频必须完整校验后才播放，适用于短视频，不支持 HLS/DASH 或边下载边播放。

CDN 需允许论坛 origin 的 CORS GET，且不依赖 Cookie、认证头或重定向。改动内容或 URL 后应更新描述符并重新提审；校验失败没有忽略 SHA-256 的回退。常见失败包括 `ASSET_NOT_FOUND`、`PERMISSION_DENIED`、`REMOTE_ASSET_FAILED`、`REMOTE_ASSET_INVALID`、`RATE_LIMIT` 和 `APP_UNLOADED`。远程素材不提供脚本、HTML、CSS 的加载执行能力。

## 浏览器存储

存储仅保存在当前浏览器，按应用及正式/沙盒隔离；`clear()` 只清当前应用范围。用户级 key 由应用组织，数据不跨设备同步。

```ts
await sdk.localStorage.setItem("progress", JSON.stringify({ level: 2 }));
const raw = await sdk.localStorage.getItem("progress");
const progress = raw === null ? null : JSON.parse(raw);
```

key 长度 1–80 字符，单值最多 4 KiB，每个应用环境最多 64 个键、64 KiB。

`cookies` 同样按应用及正式/沙盒隔离。key 限字母、数字、点、下划线或连字符；`maxAge` 为秒，默认一天、最长 30 天，0 表示删除。当前范围最多 32 项、总量 4 KiB。

浏览器拒绝存储时返回 `STORAGE_UNAVAILABLE`，应用应处理保存失败。切换账号不会自动切换此应用的数据。

## 网络与打包

HTTP 返回 `{ status, headers, body }`，WS 返回可 `send/close/on` 的连接；目标由 manifest 固定。使用方法见 [HTTP/WS](../docs/sdk-network.md)，开发者服务认证见 [服务端鉴权](../docs/server-auth.md)。

使用 `@discourse-mini-app/sdk/pack` 构建原始 ZIP。下例只包含基础文件；声明的包内 `assets/media` 文件也应按相同路径加入 `files`，`remote_assets` 中的文件不要加入：

```ts
import { readFile } from "node:fs/promises";
import { pack } from "@discourse-mini-app/sdk/pack";

await pack({
  outputDirectory: "dist/package",
  manifest: JSON.parse(await readFile("manifest.json", "utf8")),
  files: {
    "index.html": await readFile("dist/web/index.html"),
    "app.js": await readFile("dist/web/app.js"),
    "app.css": await readFile("dist/web/app.css"),
    "strings.json": await readFile("dist/web/strings.json"),
  },
});
```

Vite 的单 IIFE/CSS 构建配置和媒体打包见 [完整示例](../demos/README.md)。运行 ZIP 只含编译产物，格式与调试步骤见 [开发说明](../docs/developer-guide.md)。
