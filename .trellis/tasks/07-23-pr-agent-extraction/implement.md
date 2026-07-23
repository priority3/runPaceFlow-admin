# Implement — PR agent 抽离为独立自部署项目

> 执行原则:**拷贝式抽离,不动现网 admin**;每阶段可独立编译/验证/回滚;单用户假设不破。目标新仓 `running-companion-agent`(位置待 P0 定)。保真基线 = 现有 eval harness + /pr e2e。

## 阶段总览

| 阶段 | 目标 | 产出可验证物 | 回滚点 |
|---|---|---|---|
| P0 | 脚手架 + 目标仓落位 | Hono+Vite 骨架起、serveStatic 通 | 删新仓目录 |
| P1 | 数据面 + 纯叶子 | `ensureSchema` 建 24 表、DB 层单测过 | git revert 到 P0 |
| P2 | 搬 `src/lib/pr` + config 重实现 | `tsc` 全绿、无外部 `@/` 悬空 import | 分支回退 |
| P3 | API 路由 + H5 + dashboard | 本地起服务、`/pr` 200、面板可交互 | 分支回退 |
| P4 | 摄入 + 调度 + 可插拔 | health 摄入写库、通用 import 写库、cron 触发 | 分支回退 |
| P5 | 密钥剥离 + 自部署包 | 干净环境 `docker compose up` 起 | 分支回退 |
| P6 | 保真验证 + 自部署冒烟 | eval/ e2e 与现网对照、自部署跑通 | — |

---

## P0 — 脚手架与落位(Hono + Vite,去 Next)
- [ ] 定目标仓位置(独立 repo `running-companion-agent`;先本地建,git init)。
- [ ] 双目录骨架(design §9):`server/`(Hono on Bun)+ `client/`(Vite React)。
- [ ] 依赖:server `hono @anthropic-ai/sdk openai @libsql/client drizzle-orm nanoid node-cron`(可选 `@opentelemetry/api`);client `react react-dom vite @vitejs/plugin-react`(dashboard 用 `lucide-react`)。
- **验证**:`bun run server`(Hono 起 3030 返 200)+ `vite build`(出 client 静态)+ Hono `serveStatic` 托管静态首页通。
- **回滚**:删目录。

## P1 — 数据面 + 纯叶子(foundation 先行,后面全依赖它)
- [ ] `lib/db/schema.ts`:从 `activities-schema.ts` 复制 24 表定义(22 PR-owned + activities + splits),删 sync/主站表 + activityInsights。
- [ ] `lib/db/client.ts`:**保留 `getActivitiesDb()`/`getActivitiesClient()`/`getDb` 签名**,实现改定点 `file:./data/pr.db`(WAL)+ 精简 `ensureSchema`(24 表 DDL,从 `activities-client.ts:99-474` 裁剪,保留跨界 FK 到 activities)。
- [ ] 照抄纯叶子:`utils.generateId`(+`cn`/`formatDateTime`)、`observability/trace.ts`、`weather/open-meteo.ts`、`sync/parser.calculateDistance`、`activity/review-features.ts`。
- [ ] `lib/config.ts`:`getRuntimeSettings()`/`getRuntimeSetting()` 重实现为 env(+可选本地 JSON)reader,**签名不变**。
- **验证**:小脚本调 `ensureSchema()` 建库 → `sqlite3 data/pr.db '.tables'` 出 24 表;`getActivitiesDb().select()` 空查询通;`tsc` 该目录无错。
- **回滚**:revert 到 P0。
- **review gate**:表集/DDL/跨界 FK 与 design §2 一致后再进 P2。

## P2 — 搬 `src/lib/pr` + 接线
- [ ] 整目录复制 `src/lib/pr/`(35 文件)到新仓。
- [ ] 全局改 import:`@/lib/db/activities-client`→`@/lib/db/client`、`@/lib/db/activities-schema`→`@/lib/db/schema`、`@/lib/runtime-config`→`@/lib/config`、`@/lib/utils`/`observability`/`weather`/`activity/review-features`/`sync/parser` → 新路径。
- [ ] `ai.ts`:decision——本阶段**不搬**(非 PR 依赖,属 dashboard 洞察);如需再单列。
- [ ] 处理 >500 行文件(`memory.ts` 863、`review.ts` 510):**本任务只搬不重构**(保真优先);拆分另立 follow-up(记 CLAUDE.md 500 行约束为技术债)。
- **验证**:`tsc --noEmit` 全绿;`grep -r "@/lib/" src/lib/pr | grep -vE "已迁移前缀"` 无悬空引用。
- **回滚**:分支回退。

## P3 — API(Hono)+ H5/dashboard(Vite)
- [ ] auth → Hono middleware:搬 `api-helpers.ts` 三件套 + `auth.ts`(session HMAC);`NextResponse`→`c.json`、`cookies()`→读 Cookie 头;token 源 `getRuntimeSetting`→env。
- [ ] 22 路由改 Hono:19 `/api/pr/*` + 3 `/api/health/*`;`chat` 的 `ReadableStream` SSE 原样 `c.body(stream)`;`upload` 用 `c.req.parseBody()`;`image/[name]?t=` 参数路由。
- [ ] **`/api/activities/reviews*` → `/api/pr/reviews*`**(迁入+重命名),同步改面板 fetch。
- [ ] H5 → Vite `client/pr`:`page.tsx` 去 `'use client'` + eslint 注释;SSE 事件词表一致性核对(client ↔ Hono chat 路由)。
- [ ] dashboard → Vite `client/dashboard`:5 面板;根挂 `ToastProvider`;cherry-pick `LoadingState`/`CollapsibleSection`。Hono `serveStatic` 托管两者构建产物。
- **验证**:起 server → `curl /pr` 200;dashboard 5 面板加载、Memory 确认/归档、reviews 列表、home-location CRUD(read_page/console 核对无报错)。
- **回滚**:分支回退。
- **review gate**:H5 对话能发消息、SSE 流式正常、工具循环(主动查证)+ 多模态 + 记忆落库 → 再进 P4。

## P4 — 摄入 + 调度 + 可插拔
- [ ] health 摄入:`POST /api/health/daily` 端到端(Bearer `HEALTH_IMPORT_TOKEN` → 派生 → `(date,source)` upsert)。
- [ ] 新增 `POST /api/activities/import`(通用 RawActivity/GPX)→ 复用 `processor.syncActivity` 写 activities/splits。
- [ ] 可选数据源适配器:Keep/Strava 按 `SyncSource` env 开关加载,默认关;Nike/Garmin 剔除。
- [ ] 通知:抽 `NotificationChannel` 接口,pushplus 作可选实现,缺省 no-op;`dispatcher.ts` 依接口。
- [ ] 调度:显式 scheduler init(替代 lazy `GET /api/health` 引导);或文档化"外部 cron 打 `/api/cron`"。
- **验证**:curl health 摄入 → 库有行;curl import 一条假活动 → activities/splits 有行;手动触发一次 daily review → `activity_reviews` 出 `is_current` 行;无 pushplus token 时派发 no-op 不报错。
- **回滚**:分支回退。

## P5 — 密钥/业务剥离 + 自部署包
- [ ] 按 design §7 逐条剥离:razet.me 回退域、phoenix.razet.me 链接、mimo/grok 注释名、Dockerfile npmmirror/heyun、eval 脚本里的隧道/指纹。
- [ ] `.env.example`:写全 design §8 键集,占位空;删 stale Nike 键。
- [ ] 通用 `Dockerfile`(去 heyun/npmmirror,标准 registry,standalone 输出)+ `docker-compose.yml`(app + 卷,可选 phoenix profile,非 host-network)。
- [ ] `README.md`:自部署步骤(clone→配 .env→compose up→配 Apple 健康快捷指令/导入)、Apple 健康摄入契约文档、可选数据源/通知说明。
- **验证**:`grep -rIE "razet|heyun|npmmirror|mimo|grok|fufu" src Dockerfile docker-compose.yml`(除中性注释)零命中;`docker compose config` 通过。
- **回滚**:分支回退。

## P6 — 保真验证 + 自部署冒烟
- [ ] `tsc` + `eslint` 全绿;`bun run build` 通过。
- [ ] **保真回归**:跑抽离后 eval harness(移植 `scripts/eval`,去隧道/指纹)对照现网维度分;/pr e2e(对话/工具/多模态/记忆)人工过一遍。
- [ ] **干净环境冒烟**:全新目录 `git clone`(或 tar)→ 只配必要 `.env` → `docker compose up` → `/pr` 200、健康摄入通、一次对话出正文(用刚上线的 grok tool-loop 修复所在的 `callPrModel`)。
- [ ] 收尾:新仓首个 commit(priority3 身份)、README 完成度自查。
- **完成定义**:干净环境自部署跑通 + 核心链路(对话/复盘/每日反思/RAG)保真 = 达标。

---

## 依赖顺序与并行度
- 严格串行:**P1(数据面)→ P2(搬 pr)→ P3(API/UI)**——后者全依赖前者。
- 可并行:P4 的"通用 import 端点"与"通知接口抽取"互不依赖;P5 的密钥剥离可在 P3 后随时穿插。
- 单人预估:P1~P3 是主体工作量(DB 层重写 + import 重接线 + UI 挂载);P4~P6 相对机械。

## 未决/风险
- **Hono 端口移植面**:22 路由的 `NextResponse`/`next/server`/`cookies()`→Hono 是机械但量大;SSE/multipart/静态托管按 Hono API 重接一遍(SSE 因是 Web 标准 `ReadableStream`,风险低)。P3 逐一核对。
- **session cookie 一致性**:admin-session 现经 `next/headers cookies()` 读;Hono 下改读 `Cookie` 头 + 复用同一 HMAC(`ADMIN_SESSION_SECRET`),须保证签发/校验完全一致,否则登录态失效。
- **`memory.ts`(863)/`review.ts`(510)超 500 行**:本任务保真只搬不拆,记为技术债 follow-up。
- **eval harness 移植**:含 Phoenix/隧道耦合,移植时需去业务化(P6)。
- **调度模型**:lazy 引导改显式后,需确认所有定时任务(daily/weekly/diary/memory_maintenance/retention)在单用户 app 下的触发方式。
