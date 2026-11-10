# 能力测试台

独立 Bun + Vite 项目，展示布局和公开 SDK。应用 ID 从社区应用页面复制。保留 `../../sdk`：

```sh
bun install --frozen-lockfile
bun run dev
MINI_APP_ID=平台应用ID MINI_APP_VERSION=1.0.1 bun run build
```

预览：`http://127.0.0.1:5193/`。本地模式只调试布局。调真实 API 时，用 `MINI_APP_ID=应用ID MINI_APP_VERSION=1.0.1 bun run build:debug` 构建并上传 sandbox；DevTools 选择微应用 iframe 看日志和断点，Network 查看开发者服务请求。提审流程见 [调试步骤](../../docs/developer-guide.md#调试)。

## 展示内容

- 布局：320/768 px 样本、RTL、深浅配色、大字号、长文字、表单和滚动。
- 数据：当前用户、按用户 ID 查询、启动 query/hash、权限列表、主题与包内文件读取。
- 浏览器能力：localStorage、Cookie、剪贴板、全屏、包内音视频。
- 运行能力：通过 `sdk.wasm.instantiate` 加载声明的包内 WASM，显示真实模块、实例与 `answer() = 42`；本地预览不模拟结果。
- 原生 Web Audio：需 `audio.webAudio`，点击后创建并恢复 `AudioContext`，播放最多 5 秒的低音量合成音。显示真实上下文状态，顶部喇叭可静音；`running` 不代表已验证听觉输出。隐藏或离开页面时停止并关闭，浏览器的自动播放限制仍适用。
- 指针捕获：按住并拖出按钮后松开，或用空格/Enter 操作；取消、失焦和页面隐藏时复位。可选循环提示音不阻塞指针状态，迟到的音频句柄会停止。
- 鼠标锁定：需 `pointer.lock`，点击原生 `canvas.requestPointerLock()`，通过浏览器事件确认状态；原生 `mousemove` 显示 `movementX/Y`。按 Esc 或退出按钮释放，失焦、隐藏和卸载时清理；不会自动重试或把请求返回当作锁定成功。
- 网络：HTTP 请求，以及 WS 连接、发送、接收和关闭。返回内容仅在结果区临时显示，不写入日志，可用“清除私人结果”清除。

状态区分未执行、成功、API 缺失、平台限制、权限拒绝、用户取消、超时和实际执行失败。WASM 编译失败也可能来自 CSP，不能仅凭 `CompileError` 判断原因。Worker 和 SharedArrayBuffer 只显示平台限制，不进行调用。日志最多 40 条，只保留操作名、状态、错误码和耗时。示例请求较多权限，实际应用应删去不用的权限。

Cookie 示例的读、写、删除共用合法名称 `capability-lab_sample`。

## 配置网络展示

默认 manifest 的 `endpoints`、`websockets` 为空，未配置项目不发请求。改为自己控制的 HTTPS/WSS 443 服务，再重建：

```json
{
  "endpoints": {
    "status": {
      "url": "https://api.example.com/status",
      "method": "GET",
      "auth": "platform"
    },
    "echo": {
      "url": "https://api.example.com/echo",
      "method": "POST",
      "auth": "platform"
    }
  },
  "websockets": {
    "events": {
      "url": "wss://api.example.com/events",
      "auth": "platform",
      "protocols": ["json.v1"]
    }
  }
}
```

页面默认端点名为 `status/events`；POST 展示改用 `echo`。服务需配置论坛 origin 的 CORS，验证平台 JWT 并忽略 Cookie 鉴权；WSS 不能与论坛使用同一 hostname。配置和示例见 [HTTP/WS](../../docs/sdk-network.md)、[服务端鉴权](../../docs/server-auth.md)。不要在输入框填真实个人数据或秘密。

媒体是包内短 WAV 提示音和 1 秒 MP4 测试图案，无外部资源或采集。打包脚本另外生成固定的 39 字节 `wasm/answer.wasm`，在 manifest 的普通 `assets` 中声明；无需下载编译器或外部模块。

## 人工检查

检查窄屏、主题、权限拒绝、存储恢复、取消操作，以及 HTTP/WS 成功与故障。离开页面时关闭连接并取消订阅。匿名和外站嵌入请用正式分享链接检查。
