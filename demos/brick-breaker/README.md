# 打砖块

三关、三条生命，支持键盘、鼠标和触摸。空格发球/暂停，方向键或 A/D 移动，P 暂停；离开页面自动暂停。

```sh
bun install --frozen-lockfile
bun run dev
MINI_APP_ID=平台应用ID MINI_APP_VERSION=1.0.0 bun run build
```

预览：`http://127.0.0.1:5191/`。上传 `dist/package/app.zip`，manifest ID 从社区应用页面复制。

社区模式通过 SDK 读取用户/主题，用 localStorage 保存本机最高分和上一局成绩。缺少权限或存储失败仍可游玩。规则在 `src/physics.ts`，平台适配在 `src/host.ts`。保留 `../../sdk`，公共构建说明见 [示例目录](../README.md)。

调真实 SDK：`MINI_APP_ID=应用ID MINI_APP_VERSION=1.0.1 bun run build:debug` 后上传 sandbox；在 DevTools 选择微应用 iframe 看日志和断点。提审流程见 [调试步骤](../../docs/developer-guide.md#调试)。
