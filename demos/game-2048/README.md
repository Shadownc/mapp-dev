# 2048

支持方向键、WASD、触摸和方向按钮。P 或空格暂停，达到 2048 后可继续；离开页面自动暂停。

```sh
bun install --frozen-lockfile
bun run dev
MINI_APP_ID=平台应用ID MINI_APP_VERSION=1.0.0 bun run build
```

预览：`http://127.0.0.1:5192/`。上传 `dist/package/app.zip`，manifest ID 从社区应用页面复制。

社区模式通过 SDK 读取用户/主题，用 localStorage 每五秒及暂停/结算时保存进度；未保存操作可能丢失。读取存档时校验格子、数字、得分和步数。规则在 `src/engine.ts`，平台适配在 `src/host.ts`；缺少权限或存储失败仍可游玩。保留 `../../sdk`，公共构建说明见 [示例目录](../README.md)。

调真实 SDK：`MINI_APP_ID=应用ID MINI_APP_VERSION=1.0.1 bun run build:debug` 后上传 sandbox；在 DevTools 选择微应用 iframe 看日志和断点。提审流程见 [调试步骤](../../docs/developer-guide.md#调试)。
