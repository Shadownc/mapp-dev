# 开发说明

## 开发与发布

1. 在社区个人资料的应用页创建应用，填写名称、说明和图标；复制应用 ID，填入 manifest。
2. 使用 [示例项目](../demos/README.md) 或 SDK 开发，只申请实际需要的权限。
3. 在沙箱页签上传 `dist/package/app.zip` 并保存，等待构建处理完成。
4. 沙箱页签列出每个构建，固定有效期 7 天，也可手动过期（不可恢复）。在正式页新建发布，选择版本与构建，填写更新说明和审核备注；提审中可以撤回。
5. 在 `/apps-sandbox/<app-id>/<version>-<8-char-sha>` 检查实际运行。作者需有开发者资格，管理员可预览审核。
6. 正式审核和处理完成后收到系统私信，再手动上线。新发布版本必须高于已发布的最高版本；历史正式版可重新上线回滚。材料与处罚规则见 [提审说明](submission-review.md)。

同一应用中，原始 ZIP 的完整 SHA-256 相同就视为同一构建，重复提交会直接拒绝（`BUILD_EXISTS`），已过期也不例外。临时处理失败请重试原记录；更新或重新测试过期构建时，请修改内容或版本号后重新打包。

## 项目和运行 ZIP

使用 Bun 1.4.3+。保留示例对 `../../sdk` 的引用：

```sh
cd demos/brick-breaker
bun install --frozen-lockfile
bun run dev
MINI_APP_ID=应用ID MINI_APP_VERSION=1.0.0 bun run build
```

Vite 输出单个 IIFE `app.js` 和 `app.css`，用 SDK `pack` 生成 ZIP。只上传运行 ZIP，不上传开发项目目录或旁边的 `package.json`。五个基础文件在根目录；其他文件必须在 manifest 的 `assets` 或 `media` 中声明：

```text
manifest.json
index.html
app.js
app.css
strings.json
data/…        可选，列入 assets
images/…      可选，列入 assets
wasm/…        可选，列入 assets
media/…       可选，列入 media
```

示例中把普通资源放入 `public/`，例如 `public/data/settings.json`，并在 manifest 的 `assets` 中列出 `data/settings.json`；构建会将它打入 ZIP。

`index.html` 是正文片段，不带脚本入口、内联样式或事件属性。用 `addEventListener`、`textContent` 和 CSS 类编写界面；目前不支持动态分包、外部脚本和字体加载。包内图片经 SDK 读取后以 Blob 加载。未声明文件、目录项、链接、重复或越界路径不接受，请使用 SDK 打包。

版本只使用 `1.2.3` 这样的三段数字，最长 64 字符；不同构建由构建标识区分。

## Manifest

```json
{
  "format": 1,
  "id": "019a2a58-0000-7000-8000-000000000001",
  "version": "1.0.0",
  "entry": "index.html",
  "script": "app.js",
  "style": "app.css",
  "permissions": ["user.read", "theme.read"],
  "assets": ["data/settings.json", "images/logo.png"]
}
```

- `id` 使用应用页面分配的值，原样复制，不要自行生成；示例 ID 要替换成自己的 ID。
- `version` 使用 `x.x.x` 三段数字，如 `1.2.0`，不带前导零或后缀，最长 64 字符。同一版本可上传多个沙箱构建；新建正式发布时必须高于历史最高正式版本。
- `entry/script/style` 固定如上；`permissions` 是申请列表，以实际批准结果为准。
- 可选 `assets` 是包内普通资源的路径数组。五个基础文件无需重复列入，`media` 已声明的文件也不要再列入；读取自带文件无需额外权限，见 [文件读取](../sdk/README.md#包内文件)。
- 大素材可以通过 `remote_assets` 声明固定的开发者 CDN 文件，并申请 `assets.remote`，详见下节。它们不放入 ZIP，也不重复列入 `assets`。
- 网络通过可选 `endpoints/websockets` 声明，见 [HTTP/WS](sdk-network.md)。
- 可选 `media` 使用 `assetId: { path, kind, mime }`，例如 `"chime": { "path": "media/chime.wav", "kind": "audio", "mime": "audio/wav" }`。路径为 `media/[A-Za-z0-9_-]+\.[a-z0-9]+`；支持 `audio/wav`、`audio/mpeg`、`audio/ogg`、`video/mp4`、`video/webm`，仅播放。

| 项目              | 限额                                |
| ----------------- | ----------------------------------- |
| 上传 ZIP          | 以上传页面显示的大小限制为准        |
| 解压总量 / 单文件 | 32 MiB / 8 MiB                      |
| 文件 / 媒体数     | 128 / 16                            |
| 文件路径          | 160 字节 ASCII，无空段、`.` 或 `..` |
| manifest JSON     | 64 KiB，最多 32 层                  |

打包器还会检查首屏内容大小；较大的数据文件放到 `assets`，用 SDK 文件 API 读取。

## 包内 WebAssembly

单线程 WASM 使用普通包内资源：将 `public/wasm/answer.wasm` 打入 ZIP，并把 `wasm/answer.wasm` 加入 manifest 的 `assets`。不需要新增 WASM 权限，文件仍遵守 8 MiB 单文件及整个 ZIP 的限额。

```ts
const { module, instance } = await sdk.wasm.instantiate("wasm/answer.wasm");
```

第二个可选参数是原生 WebAssembly imports，返回值中的 `module`、`instance` 也是原生对象。方法只接受已声明的包内 `.wasm`，拒绝任意 URL、未声明文件和远程素材；该限制只适用于此方法，不是对原生 WebAssembly 所有字节来源的强制约束。

读取或编译期间退出应用会以 `APP_UNLOADED` 拒绝，并阻止随后实例化及执行 start。处理 `ASSET_NOT_FOUND`、`API_UNSUPPORTED`、文件读取失败以及原生 `CompileError`、`LinkError`、`RuntimeError`；编译错误也可能来自浏览器策略。JS `eval`/`new Function`、Worker、SharedArrayBuffer 和多线程 WASM 仍不开放；JSPI 与 WASM GC 仅按当前浏览器的原生检测结果使用。

## 开发者 CDN 素材

图片、音频、视频、JSON 和二进制数据可以放在自己有权运营的 CDN，按需读取；代码与首屏必需文件仍放在运行 ZIP 中。申请 `assets.remote`，并在 manifest 的 `remote_assets` 中逐项声明。下面是需要合并到完整 manifest 的片段，URL、SHA-256 和 `size` 都必须替换为真实文件信息：

```json
{
  "permissions": ["assets.remote", "audio.play"],
  "remote_assets": {
    "images/atlas.webp": {
      "url": "https://cdn.example.com/game/v1/atlas.webp",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "size": 10485760,
      "mime": "image/webp"
    },
    "media/music.ogg": {
      "url": "https://cdn.example.com/game/v1/music.ogg",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "size": 4194304,
      "mime": "audio/ogg"
    }
  },
  "media": {
    "music": { "path": "media/music.ogg", "kind": "audio", "mime": "audio/ogg" }
  }
}
```

- `remote_assets` 的键是 SDK 使用的虚拟路径，不是 URL。它遵循包内路径规则，不能与基础文件、包内文件或 `assets` 列表重名。远程音视频仍在 `media` 中声明，`path` 指向远程键，且 MIME 必须完全相同；此时不要再把对应媒体文件打进 ZIP。
- 每项只能包含 `url`、`sha256`、`size`、`mime` 四个字段。`sha256` 为实际文件的 64 位小写十六进制 SHA-256，`size` 为实际文件字节数。内容、大小或 MIME 不符合声明时读取失败；替换 CDN 内容需要更新清单、构建新版本并重新提审。
- URL 使用 HTTPS 默认 443 端口和公开 CDN 域名，不包含账号密码、片段、反斜杠或相对路径段；不能使用 IP 地址、localhost、`.local`、`.internal` 等目标。固定 query 可写在 URL 中，不能使用 `mini_app_token`；调用时不能添加 query、正文或请求头。
- CDN 须允许论坛 origin 的 CORS GET，例如 `Access-Control-Allow-Origin: https://community.example.com`；origin 不含论坛子目录。填写最终地址，不依赖重定向、Cookie、Authorization 或短期登录链接。CDN 会收到访问者的 IP，但不会收到论坛 Cookie 或平台 JWT。
- 保持同一 URL 的文件字节稳定，优先使用带版本或内容哈希的 URL，不覆盖旧发布版本仍引用的素材。关闭会改变文件内容的自动图片转码、按设备返回不同格式等功能。`size` 和 SHA-256 对应下载后的资源字节，不是外层 HTTP 压缩传输长度。
- URL 路径中的空格、方括号等特殊字符必须百分号编码；URL 不能包含原始换行、制表符或反斜杠。虚拟路径和媒体 ID 仍只接受各自规定的字符，不接受末尾换行。
- 已公开运行且获批的应用可在访客模式读取这些固定素材；这不开放通用 HTTP 或 WebSocket 业务接口。远程 JavaScript、HTML、CSS 和 source map 不作为素材接受；不支持动态下载执行代码。

可以在构建脚本中用本地原文件生成描述符，再将原文件原样上传到 CDN：

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RemoteAssetDeclaration } from "@discourse-mini-app/sdk";

const bytes = await readFile("./public/images/atlas.webp");
const atlas: RemoteAssetDeclaration = {
  url: "https://cdn.example.com/game/v1/atlas.webp",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: bytes.byteLength,
  mime: "image/webp",
};
// 将 atlas 写入 manifest.remote_assets["images/atlas.webp"]。
```

通过 `sdk.assets.readBytes/readText/readJson` 传入声明的虚拟路径读取，图片字节按 [SDK 示例](../sdk/README.md#包内文件) 创建 Blob URL。远程音视频使用 `sdk.audio.play("music")` / `sdk.video.play(assetId)`，仍需对应播放权限。音频输出由本次运行的声音开关控制，视频逐次确认。请提供加载进度或等待提示，处理拒绝、超时和 CDN 不可用；不要因素材失败阻塞全部界面。

远程媒体须先完整下载并校验，下载阶段最多 30 秒；视频随后等待用户确认，最多 60 秒。静音时，`audio.play` 仍可下载声明的远程音频并正常播放，返回独立句柄，只是不输出声音。远程播放调用的总期限仍为 105 秒，音频运行中无需等待确认。

这个通路适合小游戏素材和短视频，不提供边下载边播放或 HLS/DASH。先渲染加载界面并调用 `lifecycle.ready()`，再按关卡按需读取素材，避免等待整套资源后才显示首屏。建议同时请求不超过两个大文件；排队也计入远程读取的 45 秒 SDK 调用期限。

| 远程素材项目            | 限额                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 清单条数                | 128                                                                                                                                                                                   |
| 单文件 / 全清单声明大小 | 32 MiB / 256 MiB                                                                                                                                                                      |
| 不同文件并发下载        | 2                                                                                                                                                                                     |
| 单次下载截止            | 30 秒                                                                                                                                                                                 |
| 当前实例已验证素材缓存  | 最多 64 MiB                                                                                                                                                                           |
| 支持 MIME               | `image/png`、`image/jpeg`、`image/gif`、`image/webp`、`image/avif`、`audio/wav`、`audio/mpeg`、`audio/ogg`、`video/mp4`、`video/webm`、`application/json`、`application/octet-stream` |

清单元数据仍计入 manifest 的 64 KiB 上限。远程素材下载后先验证完整大小、MIME 和 SHA-256，再提供给应用；命中已验证缓存时复用结果，不在游戏每帧重复计算哈希。缓存淘汰、退出后重新进入或重试下载时会重新验证。请分批加载关卡与大型素材，释放不再使用的 Blob URL；包内文件继续遵守原来的 8 MiB 单文件限制。

## 音频与长按操作

获批 `audio.webAudio`，或同时获批 `audio.play` 并声明了音频素材的应用，在代码执行前显示“开启声音”和“静音进入”，只决定初始声音状态。运行中可通过顶部喇叭随时切换；开关只影响本次运行，关闭或刷新后重新选择。`audio.play/stop` 不弹框，播放和停止由应用控制；平台只提供总声音开关，不显示音频列表或暂停、停止按钮。视频保留原有播放器界面，视频播放、剪贴板和全屏仍逐次确认。

静音只关闭输出，既有和新音频仍正常播放、保留进度及独立的 `{ handle }`，可照常停止，也可下载声明的远程音频。取消静音后会听到当前背景音乐或循环音频，不补播已经结束的短音效。

仅使用 `sdk.audio.play/stop` 的现有应用无需增加 `audio.webAudio`，也无需为声音开关修改调用代码或重新打包。使用原生在线 `AudioContext` 的应用则必须新增 `audio.webAudio` 权限并重新提审，见下节。

每个实例最多同时播放 4 路音频、2 路视频，满额拒绝新播放，不排队补播。`audio.play` 最多 20 次/秒；`audio.stop` 不占播放限额或通用的 60 次/分钟限额，但仍受合计 16 个待响应请求、120 条消息/秒的限制。处理播放失败，避免密集重试。

长按蓄力等操作应先同步更新按下状态，不要 `await` 音效后才记录或结束操作。下面的 `beginCharge`、`endCharge` 分别供 `pointerdown` 和 `pointerup`/`pointercancel` 调用；暂停游戏时也调用 `endCharge`。`charge` 是 manifest 中声明的音频 ID：

```ts
let charge: { handle?: string } | null = null;
const stopSound = (handle: string) => {
  void sdk.audio.stop(handle).catch(() => {});
};

function beginCharge() {
  if (charge) return;
  const press: { handle?: string } = {};
  charge = press;
  void sdk.audio
    .play("charge", { loop: true })
    .then(({ handle }) => {
      if (charge === press) press.handle = handle;
      else stopSound(handle);
    })
    .catch(() => {});
}

function endCharge() {
  const handle = charge?.handle;
  charge = null;
  if (handle) stopSound(handle);
}
```

即使松手早于播放 Promise 返回，旧操作的句柄返回后也会立即停止；音效失败不会阻塞按下或松手逻辑。实际游戏还应管理 `setPointerCapture()` 与释放、取消，只让对应指针结束本次操作；这种拖动或长按捕获不需要 `pointer.lock`。

## 鼠标锁定

第一人称视角等需要隐藏光标、持续读取相对位移的应用，应在 manifest 的 `permissions` 中加入 `pointer.lock`，获批后调用原生 `Element.requestPointerLock()`。没有 `sdk.pointerLock` 包装或平台额外确认框；`mousemove` 的 `movementX/movementY` 留在应用内处理，不经过 RPC。

锁定请求必须来自应用内的用户点击，并在该处理函数的第一个 `await` 前调用。兼容返回 Promise 或 `void` 的浏览器，处理同步异常和 Promise 拒绝；通过 `pointerlockchange`、`pointerlockerror` 以及 `document.pointerLockElement === target` 判断结果，不能因为调用返回就显示“已锁定”。只在目标元素确实持有锁时应用相对位移。

用户可按 Esc，应用也可调用 `document.exitPointerLock()`。失焦、页面隐藏或应用关闭时会自动释放；退出后更新界面，等待新的用户点击，不自动重锁。优先请求不带选项的标准锁；`unadjustedMovement` 按浏览器支持作为可选增强，失败时让用户点击标准锁重试。

全屏继续通过 `sdk.fullscreen.request/exit` 使用。组合这两项能力时，可以先进入全屏，再让用户在应用中点击锁定；不要 `await` SDK 全屏后立即调用原生锁定，因为用户激活不会随异步 SDK 响应传回。

已使用原生锁定的应用新增权限后重新打包、提审即可，原生调用不需改名；没有使用锁定则无需申请。普通拖动、蓄力和长按继续使用 pointer capture。

## 原生 Web Audio

合成音效或混音使用浏览器原生 `AudioContext`，需在 manifest 的 `permissions` 中加入 `audio.webAudio` 并获得批准。调用方式不变，无需改用新的 SDK 音频方法，也无需为了合成音频声明 `media` 文件。初始声音选择与顶部喇叭统一控制输出；静音不暂停 context 的时钟、调度或音频进度。

每次运行最多有 4 个未关闭的在线 context；用完后等待 `context.close()` 完成即可释放名额，退出应用也会关闭 context。该配额独立于 `sdk.audio.play` 的 4 路文件播放。

先渲染界面并调用 `sdk.lifecycle.ready()`，再在应用自己的点击处理函数中调用 `context.resume()`。浏览器仍可能要求该用户手势；不要先等待音频启动再进行首次渲染，并处理拒绝或一直未恢复的状态。

`OfflineAudioContext` 允许离线处理，不需要 `audio.webAudio` 且不会直接输出声音。不支持 `createMediaStreamDestination()` 和 AudioWorklet 脚本加载。

## 开发者服务的 JWT 公钥

如果微应用连接自有后端，开发者服务器可以通过 `GET <社区基地址>/mini-app-api/jwks` 获取 JWT 验证公钥，无需登录或 API key。例如社区位于 `https://community.example.com/forum`，就请求 `https://community.example.com/forum/mini-app-api/jwks`，不要漏掉子目录。

返回的 `keys` 数组包含当前 ES256 / P-256 公钥，可以直接作为 `@discourse-mini-app/sdk/server` 的 `publicKey` 参数。固定配置可信的社区地址并缓存、刷新公钥，不要相信未验签令牌中的密钥地址；获取和完整验签示例见 [服务端鉴权](server-auth.md#获取-jwt-验证公钥)。这个密钥用于后端验证 JWT，不是应用包验签密钥。

## 用户资料

需要展示成员信息时，申请 `user.read` 后调用 `sdk.user.getCurrent()`；查询其他成员使用 `user.lookup` 和 `sdk.user.getById(userId)`。两者返回相同字段，访客的当前用户为 `null`：

```ts
const user = await sdk.user.getCurrent();
if (user) {
  nameElement.textContent = user.name;
  trustElement.textContent = String(user.trustLevel ?? "—");
  if (user.avatarUrl) {
    avatarImage.src = user.avatarUrl;
    avatarImage.alt = user.name;
  } else {
    initialsElement.textContent = user.initials;
  }
}
```

头像请求固定为 288 像素，`avatarUrl` 可在微应用内直接显示，仅在本次运行中有效。头像不可用时返回 `null`，不会使已获准的用户资料查询失败。信任等级为 0–4，未提供时为 `null`；详细字段和头像限额见 [SDK](../sdk/README.md)。

## 调试

1. `bun run dev` 调界面和业务逻辑；本地预览不模拟用户或平台 SDK。
2. 需要真实 SDK 时，构建新版本调试包并上传 sandbox：

   ```sh
   MINI_APP_ID=应用ID MINI_APP_VERSION=1.0.1 bun run build:debug
   ```

3. 打开对应 sandbox 页面，在 DevTools 的 Console/Sources 中选择运行微应用的 frame，查看日志、源码和断点；在 Network 查看开发者服务请求与响应。
4. 确认功能后提交正式候选版。sandbox 保留 source map，正式发布移除 source map；不要在业务代码中读取它。

SDK 权限与用法见 [API 文档](../sdk/README.md)。先等 `sdk.ready`，首次渲染或显示错误后调用 `lifecycle.ready()`。处理拒绝、取消、超时和卸载，不能访问父 DOM、论坛 Cookie 或其他应用。支持窄屏、触摸、键盘、深浅主题与减少动效；离开时取消订阅，游戏在页面隐藏时暂停。
