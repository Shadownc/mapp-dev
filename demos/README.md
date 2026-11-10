# 独立微应用示例

四个项目只依赖 `../../sdk`，使用 Bun 1.4.3+、Vite 8.3.5 和 TypeScript。复制项目时保留目录关系：

```text
sdk/
demos/
  brick-breaker/
  game-2048/
  match-three/
  capability-lab/
```

| 项目                                   | 本地预览                 |
| -------------------------------------- | ------------------------ |
| [打砖块](brick-breaker/README.md)      | `http://127.0.0.1:5191/` |
| [2048](game-2048/README.md)            | `http://127.0.0.1:5192/` |
| [糖果连线](match-three/README.md)       | `http://127.0.0.1:5194/` |
| [能力测试台](capability-lab/README.md) | `http://127.0.0.1:5193/` |

在任一项目目录运行：

```sh
bun install --frozen-lockfile
bun run dev
MINI_APP_ID=平台应用ID MINI_APP_VERSION=1.0.0 bun run build
```

`build` 先做类型检查，再生成 `dist/package/app.zip`。应用 ID 从应用页面复制；只上传这个 ZIP，内容变化使用新版本号。已有缓存可加 `--offline` 安装。

本地预览只调试布局和业务，不安装假 SDK。真实能力在上传后的 `/apps-sandbox/<app-id>/<version>-<8-char-sha>` 中检查。游戏通过 `user/theme/localStorage` 使用获准能力，存储失败仍可游玩；能力测试台还提供 Cookie、剪贴板、全屏、媒体与网络展示。

源码入口为 `src/main.ts`，正文为 `src/template.html`，配置和打包脚本分别在 `vite.config.ts`、`scripts/`。ZIP 包含五个基本文件及已声明的 `assets/media` 资源，见 [开发说明](../docs/developer-guide.md)。

调真实 SDK 时，用 `MINI_APP_ID=应用ID MINI_APP_VERSION=1.0.1 bun run build:debug` 生成调试 ZIP 并上传 sandbox。DevTools 选择微应用 iframe 看日志、源码和断点，Network 查看开发者服务请求。调试完成后提交正式候选版；完整步骤见 [调试说明](../docs/developer-guide.md#调试)。
