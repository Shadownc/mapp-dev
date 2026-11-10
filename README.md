# Discourse 微应用开发指南

本仓库提供微应用开发指南、SDK、类型声明和三个 Bun + Vite 示例，帮助你创建、调试和发布社区微应用。克隆仓库后保留 `sdk/` 与 `demos/` 的相对目录；示例通过 `file:../../sdk` 使用本地 SDK。

1. 阅读 [开发说明](docs/developer-guide.md)，在社区个人资料的应用页创建应用。
2. 按 [示例说明](demos/README.md) 预览、构建项目，将应用页面分配的 ID 写入 manifest。
3. 上传原始 `app.zip`，完成 sandbox 检查后按 [提审说明](docs/submission-review.md) 发布。

参考：[SDK API](sdk/README.md) · [HTTP/WS](docs/sdk-network.md) · [服务端鉴权](docs/server-auth.md)。

开发者资格由社区配置。上传原始 `app.zip`；不要把访问令牌或其他秘密放进包内。

## 仓库内容

- `docs/`：开发、提审、HTTP/WS 与 JWT 服务端鉴权说明。
- `sdk/`：可直接使用的 SDK 模块和 TypeScript 类型声明。
- `demos/brick-breaker`、`demos/game-2048`、`demos/capability-lab`：完整示例源码、配置、打包脚本和测试源码。每个示例可独立安装依赖和构建。

进入任一示例执行 `bun install --frozen-lockfile`，再运行 `bun run dev`。按照示例 README 配置应用 ID 并构建后，将生成的 `dist/package/app.zip` 上传到社区的应用管理页面。
