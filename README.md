# RunPaceFlow Admin

RunPaceFlow 的**运维控制台**(单用户自部署):主站与 [pr-agent](https://github.com/priority3/pr-agent)
的仪表盘、数据面板与配置中心,一个容器搞定。

## 面板一览

| 菜单 | 做什么 |
|---|---|
| 概览 | 活动统计、服务健康、信标状态 |
| PR 伙伴 | 记忆确认/纠正、最近反思、近 14 天恢复、常跑地点 |
| 数字分身 | 3D 形象(VRM)+ 记忆气泡 + 实时状态条 + 成长回放 |
| 运动数据 | 活动列表与详情 |
| 访问分析 | 主站 PV/UV、转化、热图 |
| 任务调度 | cron 任务的启停与手动触发 |
| 系统监控 | 进程/内存/库连接、审计日志 |
| 配置管理 | 分组配置(加密入库)+ **PR Agent 模型网关**(改完即生效,免重启) |

## 架构边界(读代码前值得知道)

- **PR 能力的 owner 是 pr-agent**:本仓的 `/api/pr/*`、数字分身、模型网关配置全部是
  **薄代理**(`lib/pr-agent-client.ts`,经 `PR_AGENT_URL` + `PR_AGENT_TOKEN` 服务端转发),
  不再持有第二份实现——曾经的 `lib/pr` 副本(6.8k 行)已删除。
- **活动同步的 owner 在本仓**:Keep/Strava 适配器 + 每小时增量同步;同步完成后调
  pr-agent 生成复盘。
- **三个库,别混**:`admin.db`(本仓配置/访问分析)、`shared.db`(活动/健康/PR 数据,
  与 pr-agent 共享卷)、主站库(settings 里的 `DATABASE_URL`,通常远程 Turso)。
- 旧 H5 对话页 `/pr` 只剩跳转壳(跳去 pr-agent 的域名),历史推送链接不断链。

## 本地启动

```bash
cp .env.example .env.local
bun install
bun run dev        # http://localhost:3030
```

## 服务器部署

推 `main` 即自动部署(GitHub Actions:checks → rsync → 服务器上 compose 现场构建)。
服务器本地持有 `.env` 与 `docker-compose.yml`(部署刻意不覆盖,见 `.github/workflows/deploy.yml`
的排除清单)。手动部署参考:

```bash
cp .env.example .env
docker compose -f docker-compose.example.yml up -d --build
```

自身必需的变量:

- `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`:登录与会话
- `SETTINGS_ENCRYPTION_KEY`:配置加密密钥(丢了密文配置全废,务必另存一份)
- `CONFIG_DATABASE_URL`:配置库(本地 `file:./data/admin.db` 或 Turso)
- `ACTIVITIES_DATABASE_URL`:活动/PR 共享库(与 pr-agent 挂同一卷)
- `PR_AGENT_URL` / `PR_AGENT_TOKEN`:pr-agent 服务端地址(容器内网)与共享 token
  (对应 pr-agent 侧 `PR_ADMIN_TOKEN`)——不配则 PR 系面板 502
- `NEXT_PUBLIC_PR_AGENT_URL`:pr-agent 公网地址(`/pr` 跳转与面板外链用)

## 给主应用导出配置

```bash
curl -fsSL -H "Authorization: Bearer $CONFIG_EXPORT_TOKEN" \
  https://<admin 域名>/api/settings/export > .env.production
```

网页里也可以导入/导出 `.env` 文本。

## 部署注意

- `PR_HOME_LAT/LNG/LABEL` 已不生效:常跑地点属 PR 画像数据,在「PR 伙伴」面板设置
  (未设置时按活动轨迹自动推导)。
- 配置面板里的 `ANTHROPIC_*` 分组只喂**本仓的 AI 洞察**;PR 对话用的网关在顶部
  「PR Agent 模型网关」卡片里配(存到 pr-agent 侧,密文落库)。
- 与 pr-agent 共库部署时,PR 系定时任务由 pr-agent 跑(本仓 scheduler 只保留
  sync / insights / daily_report / strava_event_drain / retention_cleanup)。
