# 社区排行榜部署

这个目录是独立的 Bun + SQLite 服务，需要持续运行在你控制的服务器上。前端 ZIP 本身不提供跨用户存储。当前项目没有配置或部署任何公网排行榜服务，`app.config.json` 中的 `leaderboard.enabled` 默认是 `false`，界面隐藏排行榜。

## 排行规则

- 显示前 50 名及自己的排名。先按服务端确认的通关数降序，再按各关历史最高分之和降序；完全相同按用户 ID 字符串排序，确保顺序稳定。
- 玩家通过“社区排行榜 → 开始社区排位”获得服务端签发的对局编号和随机种子，在 2 小时内完成并点击“提交 / 重试成绩”。
- 服务端从平台 JWT 读取社区用户 ID，重放最多 30 步合法操作，计算通关状态和分数。忽略客户端传入的分数、通关数和用户 ID。只累计各关最佳成绩，重玩不会叠加刷分。
- 排位解锁根据服务端已验证的成绩计算。普通练习和之前的浏览器存档不能直接上榜。开始新排位会替代尚未提交的旧排位；重玩/顶部选关会回到练习模式。
- 同一结果重试不会重复累计。提交失败时前端保留待提交记录；可重试或明确放弃。若用户拒绝存储权限，关闭页面后不能恢复这份记录。
- 榜单只返回社区用户 ID、排名、已通关数、总分，没有使用客户端自报昵称，以免冒用其他玩家身份。服务端数据库保存这些成绩和短期对局记录。
- 重放验证防止直接篡改分数或提交非法操作；它不能阻止机器人求解、读取随机种子预测后续棋盘或多次重开挑选棋盘，不应作为高价值竞赛的完整反作弊方案。

## 启动服务

需要 Bun 1.4.3+，保留仓库中的 `sdk/` 与 `demos/match-three/` 目录关系。在项目目录安装依赖后配置环境变量。下面域名均为说明占位符，必须换成真实地址。

PowerShell 示例：

```powershell
cd F:\xxl\demos\match-three
$env:COMMUNITY_URL = "https://你的社区域名"
$env:API_ORIGIN = "https://你的排行榜服务域名"
$env:APP_ID = "01a1c353-5aa1-7bb8-9c4d-78f610ed9c70"
$env:APP_CHANNEL = "sandbox"
$env:DATABASE_PATH = "./data/leaderboard-sandbox.sqlite"
$env:HOST = "127.0.0.1"
$env:PORT = "8787"
.\node_modules\.bin\bun.cmd run server
```

Linux 部署时使用相同变量并运行 `bun run server`。交给 systemd 或容器管理进程；SQLite 数据目录使用持久磁盘，备份数据库（运行时需包含 WAL，或先用 SQLite 备份接口生成一致快照）。本实现面向单实例部署，不把 SQLite 文件放到多实例共享网络磁盘上。

服务端启动时从固定 `COMMUNITY_URL/mini-app-api/jwks` 拉取公钥，每分钟刷新。首次失败不启动；已有公钥超过 15 分钟未成功刷新时拒绝鉴权。轮换期间旧令牌可能需重新获取，前端显示授权失败并允许重试。服务端不接受请求指定的公钥来源，不需要论坛 API key 或私钥。

社区如果有 `/forum` 子目录，`COMMUNITY_URL` 要包含它；`API_ORIGIN` 必须是无路径、无尾斜杠的 HTTPS origin。API 使用默认 443 端口，不把本机 HTTP 端口写进 manifest。

在域名对应的服务器上配置 HTTPS 反向代理，例如 Caddy（实际域名替换后）：

```caddyfile
scores.your-domain.com {
    request_body {
        max_size 4KB
    }
    reverse_proxy 127.0.0.1:8787
}
```

保持 `/v1/...` 路径不变，不重定向。代理应设置请求体接收超时和常规连接限额；不要记录 Authorization。应用错误响应也带 CORS，OPTIONS 不要求令牌。只允许已配置社区 origin，不使用 Cookie 鉴权。

## 生成可连接服务的 ZIP

服务部署好后，先将应用项目目录下 `app.config.json` 中的 `leaderboard.enabled` 改为 `true`，再在应用项目目录执行：

```powershell
$env:MINI_APP_API_ORIGIN = "https://你的排行榜服务域名"
$env:MINI_APP_ID = $null
$env:MINI_APP_VERSION = $null
$env:MINI_APP_DEBUG = $null
.\node_modules\.bin\bun.cmd run build
```

打包器只在开关开启且传入有效 HTTPS origin 时给 ZIP 内的 manifest 添加 `network.request`，并声明 3 个 `auth: platform` 端点。开关开启但缺少地址时会报错；关闭时忽略地址，隐藏排行榜且不发起排行榜请求：

| 名称 | 方法与路径 | 用途 |
| --- | --- | --- |
| leaderboard | GET /v1/leaderboard | 前 50 和当前用户排名 |
| startRun | POST /v1/runs | 新建指定排位关卡，正文 `{ "level": 1 }` |
| submitResult | POST /v1/results | 提交 `{ "runId": "…", "actions": [[1,9],[27]] }` |

操作 `[a,b]` 是相邻交换，`[a]` 是引爆特殊糖果。没有合法消除的交换不计步、不写入操作记录。服务端请求正文限制 4 KiB，对每个用户每分钟限 45 次请求、开局间隔至少 3 秒。

上传 `dist/package/app.zip` 到社区沙箱，获准 `user.read` 和 `network.request` 后才能联网；存档依赖 `storage.read/write`。开启排行榜后，匿名访问或拒绝联网时仍可玩练习模式，界面明确显示排行榜不可用。关闭开关时不展示排行榜或排位模式提示，旧排位存档按普通游戏继续，不保留待提交记录。

沙箱和正式分别运行 `APP_CHANNEL=sandbox` / `production` 服务，推荐不同域名、端口和数据库。正式打包时切换为正式服务的 `MINI_APP_API_ORIGIN`。即使用同一个数据库，数据键也包括社区、应用、环境及规则版本，不会混榜；一个服务进程只接受配置的 channel。

## 验证与维护

运行 `bun test test/leaderboard.test.ts` 检查 JWT、CORS、身份与环境隔离、计分重放、幂等和限额。全量检查用 `bun test test` 与 `bun run typecheck`。

真实沙箱验收：两个账号各完成一局并提交 → 刷新查看共享榜单 → 同一关重玩验证只保留最高分 → 提交失败后重试 → 关闭重开恢复排位操作 → 确认正式榜没有测试成绩。

改动 `engine.ts`、`levels.ts` 或计分规则时，要同步部署前后端并更新 `src/ranked.ts` 的 `RULES_VERSION`。不同规则版本单独排名，旧规则进行中的对局不能按新规则验分。
