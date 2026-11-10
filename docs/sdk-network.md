# HTTP 与 WebSocket

在 manifest 声明应用需要的业务接口，再通过 SDK 调用。地址必须使用 HTTPS/WSS 默认 443 端口。固定图片、音视频、JSON 与二进制文件使用单独的 [`remote_assets` 素材清单](developer-guide.md#开发者-cdn-素材)，不占用这里的业务请求正文/响应限额。

## 声明端点

```json
{
  "permissions": ["user.read", "network.request", "network.websocket"],
  "endpoints": {
    "createMessage": {
      "url": "https://api.example.com/messages",
      "method": "POST",
      "query": ["room"],
      "auth": "platform"
    }
  },
  "websockets": {
    "events": {
      "url": "wss://api.example.com/events",
      "query": ["room"],
      "auth": "platform"
    }
  }
}
```

替换为自己有权运营的服务。HTTP、WS 各最多 16 个端点；调用者只传端点名和获准动态 query，不能覆盖 URL、固定 query 或 headers。URL 不带凭据、片段、相对路径段、反斜杠或未编码非 ASCII 字符。`mini_app_token` 是保留参数，不能声明。

| 项目              | 限制                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| 业务 URL          | 最多 2048 字节                                                                          |
| 动态 query        | 最多 16 项，每值最多 200 UTF-8 字节                                                     |
| HTTP 常量 headers | manifest 声明，最多 16 项；名称 64 字符、值 256 字节；不允许鉴权、Cookie、Host 等敏感头 |
| WS 子协议         | manifest 的 `protocols` 声明，最多 8 项；不支持自定义握手 headers                       |

公开 HTTP 可用默认 `auth: "none"`。受保护 HTTP 和所有 WS 使用 `platform` 并获准 `user.read`；服务端须验证 JWT 并检查业务权限，见 [服务端鉴权](server-auth.md)。匿名模式没有通用 HTTP/WS 权限；已登录的嵌入页按同样的应用权限使用这些接口。获批的固定 CDN 素材可供访客读取，但不携带平台 JWT。

## HTTP

```ts
const response = await sdk.http.request("createMessage", {
  query: { room: "lobby" },
  json: { text: "Hello" },
});
showResult(response.status, response.body);
```

方法由 manifest 固定；可选 `method` 必须与声明一致。支持 GET/POST/PUT/PATCH/DELETE，GET 无正文；JSON 正文最多 4 KiB。返回 `{ status, headers, body }`，响应 JSON 最多 64 KiB，空正文为 `null`。HTTP 总截止为 5 秒。

HTTP 不携带 Cookie，并拒绝所有重定向；端点填写最终地址。服务须允许论坛 origin 的 CORS、OPTIONS、Authorization、Content-Type 和声明常量头，错误响应也要有 CORS。

## WebSocket

```ts
const connection = await sdk.webSocket.connect("events", {
  query: { room: "lobby" },
});
const off = connection.on("message", showMessage);
connection.on("error", ({ code }) => showError(code));
connection.on("close", ({ code }) => showClosed(code));
await connection.send({ type: "join" });
// 离开该功能时：
await connection.close();
off();
```

连接就绪后使用 `send/close/on`；`on` 支持 `message/error/close` 并返回取消订阅函数。

服务在 upgrade 前验证 `mini_app_token` query 中的 JWT，握手后传普通 JSON。握手拒绝重定向。WSS 不能使用论坛同一 hostname，包括不同端口。

每实例最多 2 条连接，连接等待 20 秒；JSON 每条最多 4 KiB、32 层，收发各 30 条/秒。连接就绪后立即订阅消息。连接最多存活 `min(300 秒, JWT 剩余有效期)`，服务端也须执行此限制；应用自行处理重连。

## 授权与错误

JWT 有效期为 15 分钟。HTTP 返回 401 时本次请求失败，下次调用重新获取授权；写操作不会自动重试。

退出或失去使用权限时应用会停止。已签发 JWT 可能使用到到期；开发者仍需自己的账号、资源权限和连接限额。

处理 `PERMISSION_DENIED`、`ACCESS_DENIED`、`INVALID_ARGUMENTS`、`RATE_LIMIT`、`MESSAGE_LIMIT`、`BACKPRESSURE`、`TIMEOUT`、`SOCKET_CLOSED` 和 `APP_UNLOADED`，不要改用原生网络 API。取消等待不能撤销已完成的业务写入。
