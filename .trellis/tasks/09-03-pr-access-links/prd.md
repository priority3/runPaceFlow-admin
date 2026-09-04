# admin 面板签发 PR 对话入口链接与设备管理

## Goal

在 dashboard 的「PR 伙伴」标签页里签发 pr-agent 的一次性对话入口链接(带二维码,手机扫码即进),
并查看/吊销已兑换的设备。目前这套只能 curl,拿到链接后还要手工传到手机上。

## Background

pr-agent 于 2026-09-03 把 H5 对话页的鉴权从单枚长期共享令牌(`PR_CHAT_TOKEN`)换成两段式:
管理接口签发一次性链接(7 天有效、只能用一次)→ 手机兑换成设备专属令牌(90 天滑动过期、可单独吊销)。
对应端点(均为 `withAuth`,认「会话 cookie 或 Bearer PR_ADMIN_TOKEN」):

| 端点 | 说明 |
|---|---|
| `POST /api/pr/access/links` | 签发,返回 `{ url, token, expiresAt }`(明文 token 只此一次) |
| `GET /api/pr/access/links` | 签发记录,`status: pending / used / expired` |
| `GET /api/pr/access/devices` | 设备清单,`status: active / expired / revoked` |
| `DELETE /api/pr/access/devices/:id` | 吊销单台设备(最迟 60s 生效,对方有校验缓存) |

本仓是消费者:经 `proxyToPrAgent`(`src/lib/pr-agent-client.ts`)用 `PR_AGENT_TOKEN` 转发,
不复刻任何令牌逻辑。

## Requirements

### 代理路由(照 `src/app/api/pr/jobs/route.ts` 的一行式写法)

- `src/app/api/pr/access/links/route.ts` — `POST` + `GET`
- `src/app/api/pr/access/devices/route.ts` — `GET`
- `src/app/api/pr/access/devices/[id]/route.ts` — `DELETE`

### 面板 `PrAccessCard.tsx`

- 「生成入口链接」按钮 → 展示链接 + 复制按钮 + **二维码**(手机扫码即进)
- 明文链接只在签发响应里出现一次,刷新面板后不再可得 —— UI 必须讲清这点
- 设备列表:标签(UA 摘要)、最后使用、到期、状态徽章;吊销走 inline 两步确认
- 签发记录:按需展开,展示 `status` 与使用时间
- 挂进 `PrPanel.tsx` 的一个 `CollapsibleSection`

### 约束

- 二维码**必须本地渲染**(新增依赖 `qrcode.react`)。绝不可用外部二维码服务 ——
  那等于把一次性访问令牌发给第三方。
- 遵循 `.trellis/spec/frontend/`:单引号无分号、语义 token 类(面板是浅色底)、
  `const { success, error: toastError } = useToast()`、`void Promise.resolve().then(fetchX)`
  起首屏、`cache: 'no-store'` + `res.ok`、失败必须 toast 或 `loadError` 横幅、
  无 `window.confirm`、无 `console.*`、文件 ≤500 行。

## Acceptance Criteria

- [ ] `bun run lint` 与 `bun run type-check` 均退出 0
- [ ] 面板点「生成入口链接」→ 出现链接、复制按钮与可扫的二维码
- [ ] 手机扫码后能进 pr-agent 对话页(链接随即作废)
- [ ] 设备列表显示该设备,吊销后该设备刷新页面即掉线
- [ ] pr-agent 不可达时面板显示失败横幅并提示检查 `PR_AGENT_URL`,不是空白面板
- [ ] 二维码为本地渲染,网络面板中无对第三方二维码服务的请求

## Notes

- 上游改动:pr-agent PR #10(`feat(auth)!: 对话入口改为一次性链接 + 设备令牌`),已合并部署。
- 本仓无需新增 env:`PR_AGENT_URL` / `PR_AGENT_TOKEN` 已在用。
- pr-agent 若未配 `PUBLIC_BASE_URL`,返回的 `url` 是相对路径(`/pr?t=...`)——
  二维码扫出来会打不开,必须补全成绝对地址。
- 补全放在**代理路由(服务端)**而不是面板里:前端规范禁止客户端读 `process.env` /
  `NEXT_PUBLIC_*`,配置只能经服务端 props 或 `/api` 下发。补全要用
  `NEXT_PUBLIC_PR_AGENT_URL`(对外地址)而不是 `PR_AGENT_URL`(容器内服务名,
  手机访问不到)。因此 `POST /links` 是唯一一条**不用纯 `proxyToPrAgent`** 的路由。
