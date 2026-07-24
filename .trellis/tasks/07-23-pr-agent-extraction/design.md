# Design — PR agent 抽离为独立自部署项目

> 依据:6 维全量分析(模块/表归属/依赖/API+UI/密钥/摄入),证据见 task 讨论。核心结论:**外部耦合 95% 集中在 activities SQLite DB 层**(概念上本就属于 PR agent,只背了 admin/多租户/sync 包袱);`runtime-config` 是唯一真正的多租户接缝;H5 页面零共享 UI 依赖可直接搬;4 个纯叶子照抄。

## 0. 待定问题定论(prd Q1–Q4)

- **Q1 数据边界 → 全自包含**。自有单文件 SQLite/libsql,装 24 表核心集(22 PR-owned + `activities` + `splits`)。跨界 FK 只有 3 处指向 `activities`(见 §2),把 `activities` 纳入即闭合,零残留耦合。
- **Q2 活动数据默认来源 → 新增通用导入端点** `POST /api/activities/import`(接 `RawActivity`/GPX summary JSON),作一等公民;Keep/Strava 降级为可选适配器。这样自部署者**零第三方账号**也能喂进跑步数据(配合 Apple 健康摄入)。
- **Q3 dashboard 管理面 → 内置 mini-admin**。5 个面板耦合很轻,保留为内置管理页(非纯 API)。
- **Q4 技术栈 → 去 Next,改 Hono(Bun)后端 + Vite React 静态 H5**,单进程/单容器(见 §1/§6)。理由:H5 是纯 React(零 Next 运行时 API)、SSE 是 Web 标准 `ReadableStream`、API 对 Next 仅浅耦合(`NextResponse`/`next/server`/`cookies()`),agent 核心与框架无关——Next 的 SSR/RSC/文件路由全未用上,却带来 canary/turbopack/require-hook 一堆构建坑(见 memory)。
- **activities 真相源(2026-07-23 定)→ 方案甲:不与主站合并**。主站继续用远程 Turso、归主站;PR agent 抽离后**自持本地库 + 自带摄入**,两者解耦。审计 P1「本地 shared.db ↔ 主站 Turso 分裂」由抽离本身化解,**现网零迁移、无高风险动作**(见 [[research/db-audit.md]] C 级不做)。

## 1. 目标形态与技术栈

- **去 Next**:后端 **Hono**(跑在 **Bun**),前端 **Vite + React** 打静态资源,由 Hono `serveStatic` 一并托管 → 单进程/单容器。单用户,自有 libsql/SQLite 单文件库(`file:./data/pr.db`,WAL)。
- 一条 `docker compose up` 起:app + 卷(DB + uploads)。可选 Phoenix(OTel)profile。
- npm 依赖极简(见 §4):后端 `hono`、`@anthropic-ai/sdk`、`openai`、`@libsql/client`、`drizzle-orm`、`nanoid`、`@opentelemetry/api`(可选)、`node-cron`;前端 `react`+`vite`,dashboard 用 `lucide-react`;H5 页面零第三方 UI。
- **为什么不是 Next**:H5 是纯 React(零 Next 运行时 API,仅 `'use client'` + `<img>` 的 eslint 注释)、SSE 用 Web 标准 `ReadableStream`+`new Response(stream)`、API 对 Next 仅浅耦合;Next 的 SSR/RSC/文件路由全未用上,却带 canary/turbopack/require-hook/standalone-COPY 一堆坑(见 memory)。去掉后构建更快、镜像更小、开源更好读。

## 2. 数据面设计

### 2.1 自有库表集(24 表核心)
- **PR-owned(22)**:activityReviews, reviewAnnotations, agentRuns, agentStateSnapshots, notificationDeliveries, subjectiveFeedback, memoryItems, memoryEvents, friendProfile, friendDiaryEntries, raceGoals, healthDailyMetrics, lifeEvents, knowledgeDocuments, knowledgeChunks, knowledgeEmbeddings, ragRetrievalLogs, ragEvalCases, prFeedbackEvents, prMetricEvents, conversationThreads, conversationMessages。
- **必带的平台表(2)**:`activities`(PR 只读的主数据源;3 张 PR 表 FK 指向它)、`splits`(review-features 读每公里明细)。
- **可选(+3,仅当内置 sync)**:`userProfile`(持 sync 凭据)、`syncLogs`、`stravaEvents`。
- **排除**:`activityInsights`(属 `lib/ai.ts` 的 dashboard 洞察功能,非 PR agent;除非一并搬 ai.ts)。

### 2.2 跨界 FK(必须让 `activities` 存在于自有库)
| 子表(PR-owned) | 列 | → activities | onDelete |
|---|---|---|---|
| activityReviews | activityId | id | set null |
| reviewAnnotations | activityId | id | cascade |
| subjectiveFeedback | activityId | id | set null |

`splits.activityId→activities` 是平台→平台(非跨界)。其余 PR FK 全是 owned→owned(内部闭合)。`activityReviews.runId` / `agentRuns.subjectId` 等是无约束纯文本,不构成硬边界。

### 2.3 DB 层重写策略(关键:签名不动,72 call-site 零改)
- 现状:`src/lib/db/activities-client.ts`(586 行)暴露 `getActivitiesDb()`(drizzle)+ `getActivitiesClient()`(raw libsql,仅 `metrics.ts` 用 9 条聚合)+ 别名 `getDb`。72 个 drizzle call-site 分布在 19 个 pr 文件。
- **重写而非照搬**:保留 `getActivitiesDb()`/`getActivitiesClient()` 签名,替换实现为"定点 `file:./data/pr.db` libsql client + 精简 `ensureSchema`"。丢弃这些多租户/共享库包袱:
  - 30s TTL 配置缓存 + last-known-good 回退(`:44-90`,因 DB URL 来自 admin app_settings 才需要)→ 固定路径。
  - `getDatabaseConfig()` 里 `getRuntimeSettings({force:true})` + URL/token 杂耍(`:59-78`)→ 一个 env 或固定路径。
  - `ensureActivitiesSchema()`(`:96-475`,28 表 inline DDL + ALTER + ~35 索引)→ 精简到 24 表 DDL。
  - 主站并发读 WAL PRAGMA(`:479-490`)→ 保留 WAL,单写者无并发理由但无害。
- **DDL 来源**:现有 inline `CREATE TABLE`(`activities-client.ts:99-474`)直接裁剪;或改 drizzle-kit 迁移(design 阶段二选一,倾向沿用 inline 保一致)。

### 2.4 库统一(回应"现状是否统一")
现状**不统一**(见 [[research/db-audit.md]]):`admin.db`(`db.ts`,配置/scheduler/访问分析)+ `shared.db`(`activities-client.ts`,activities + 全部 PR 表,本地)+ `ai.ts` 自建 client(activity_insights,连远程 Turso)——**3 个入口**,且 `DATABASE_URL` 一键三义。standalone **统一为一个本地 `file:./data/pr.db` + 一个 client 工厂**(保 `getActivitiesDb()`/`getActivitiesClient()` 签名);`ai.ts` 若搬则并入同库,不再自建。admin 的访问分析表(page_views/click_events…)属 admin 专有,**不进** PR agent 库。

## 3. 依赖处理(8 个外部模块的处置)

| 模块 | 处置 | 说明 |
|---|---|---|
| `db/activities-client` | **重写** | 保签名换实现(§2.3) |
| `db/activities-schema` | **搬+精简** | 复制 24 表定义,删 sync/主站表 |
| `runtime-config` | **重实现** | 唯一多租户接缝:现读 admin `app_settings`+crypto+settings 注册表(经 `@/lib/store`)。改成"读 `process.env`(+可选本地 config 文件)返回 `Record<string,string>`",签名不变 → `PR_EMBEDDING_*`/model keys 等调用零改 |
| `utils.generateId` | **照抄** | 3 行 nanoid 封装(14 文件用),带 `nanoid` 依赖 |
| `observability/trace` | **照抄** | 75 行自包含,唯一依赖 `@opentelemetry/api`(无 provider 时 no-op) |
| `activity/review-features` | **照抄** | 287 行 PR 专用分析,依赖 DB 层 → 逼 `splits` 入库 |
| `weather/open-meteo` | **照抄** | 375 行,零内部依赖,keyless `fetch` |
| `sync/parser.calculateDistance` | **照抄** | ~20 行纯 haversine |

叶子合计仅拉入 `nanoid` + `@opentelemetry/api`(可选)+ 全局 `fetch`。

## 4. 可插拔边界(R3/R4)

- **数据源**:沿用现有 `SyncAdapter` 接口 + `RawActivity` DTO(`sync/adapters/base.ts`)作插件契约;`SyncSource` switch(`service.ts:69`)按 env 开关加载。Keep/Strava = opt-in 插件,默认关;Nike(死)/Garmin(stub)剔除。新增 `POST /api/activities/import`(通用 RawActivity/GPX)作默认零依赖入口。
- **LLM 网关**:已 config 驱动(`ANTHROPIC_*`/`OPENAI_*`,`callPrModel` 走 baseURL/model 注入),无需改造,仅去注释里的 mimo/grok 私有名。
- **通知渠道**:现 `notify.ts` 硬编 pushplus(China-only)。抽成 `NotificationChannel` 接口(`send(title,content,link)`),pushplus 作一个可选实现;缺省 no-op / 日志。派发器 `notifications/dispatcher.ts` 依接口。
- **Embedding**:已 config 驱动(`PR_EMBEDDING_*`),缺失则 RAG 退化纯 lexical(BM25)。零改。

## 5. 数据摄入契约(R2)

- **健康(一等公民,通用可移植)**:`POST /api/health/daily`,Bearer `HEALTH_IMPORT_TOKEN`,Apple 健康快捷指令 JSON(rich `sleepSegments`/`sleepSegmentsText`+naps+hrv/restingHr/steps/audio),服务端 `deriveSleep` 派生,`(date,source)` 幂等 upsert 入 `health_daily_metrics`。副作用(`projectFriendProfile`/`generateDailyReview`)非阻塞。原样保留。
- **活动写入契约(内部目标)**:`RawActivity` DTO → `processor.syncActivity`(`(source,sourceId)` 去重、GPX 解析、split 生成)写 `activities`+`splits`。所有数据源汇入此核心。富化步骤(赛事匹配 Playwright、Open-Meteo 天气)设为可开关(重依赖)。
- **新增通用导入**:`POST /api/activities/import` 直接吃 `RawActivity`/GPX summary → 复用 `processor.syncActivity`,给无第三方账号用户兜底。

## 6. API + UI 迁移(Hono + Vite)

- **API → Hono**:19 个 `/api/pr/*` + 3 个 `/api/health/*` 从 Next route handler 机械改成 Hono 路由(逻辑体不变,只换外壳):
  - `NextResponse.json(x)` → `c.json(x)`;`NextRequest` → Hono `Context`/标准 `Request`;`cookies()`(`next/headers`,3 处 admin-session)→ 读 `Cookie` 头解析。
  - **SSE 原样移**:`chat` 路由现用 Web 标准 `ReadableStream`+`new Response(stream,{headers})`(`chat/route.ts:51/108`,**非 Next 专有**),Hono 直接 `return c.body(stream,{headers})` 或 `streamSSE`。事件词表(`thinking/text/tool/text_reset/replace/done/error`)不变。
  - multipart(`/api/pr/upload`)→ Hono `c.req.parseBody()`;图片查询串 token(`/api/pr/image/[name]?t=`)→ Hono 参数路由。
  - auth 三件套(`withAuth`/`withPrChatAuth`/`withHealthImportAuth`)→ Hono middleware;token 源 `getRuntimeSetting`→env(`PR_CHAT_TOKEN`/`HEALTH_IMPORT_TOKEN`/`ADMIN_SESSION_SECRET`)。
  - ⚠️ **`/api/activities/reviews*` 迁入并重命名 `/api/pr/reviews*`**(PrReviewsPanel 数据源,原在 `/api/pr` 外)。
- **H5 `/pr` → Vite React 静态**:现有 `page.tsx`(756 行,纯 React,唯一 import `react`)去掉 `'use client'` + `@next/next/no-img-element` eslint 注释即为组件本体,Vite 打静态;Hono `serveStatic` 托管在 `/pr`。SSE/上传/图片全走上面的 Hono 端点。
- **Dashboard(mini-admin)→ 同 Vite React app**(或第二入口):PrPanel + MemoryPanel + PrReviewsPanel + HealthRecoveryPanel + HomeLocationCard;根挂 `ToastProvider`;cherry-pick `LoadingState`/`CollapsibleSection`(`dashboard/components/shared.tsx`,别整文件搬);带 `cn`/`formatDateTime`(`utils.ts`)+ `lucide-react`。

## 7. 密钥/业务剥离清单(R6,逐 file:line)

**必须剥离(硬编私有域/业务)**
- `notifications/dispatcher.ts:11` — 回退域 `runpaceflow-admin.razet.me` → 空/`localhost`。
- `dashboard/DashboardView.tsx:122` — `href="https://phoenix.razet.me"` → config 驱动或删。
- `docker-compose.example.yml` — cloudflared/heyun/`phoenix.razet.me`/host-network 部署形状 → 换通用 compose。
- `Dockerfile:42-47` — `registry.npmmirror.com`+ipv4first(heyun IPv6 workaround)→ 默认 registry。
- `settings.ts:182` 占位 `mimo-v2.5`;`model.ts:178/215/245/362`、`chat.ts:38` 注释里的 `mimo-v2.5-pro`/`grok 系` 私有网关模型名 → 泛化。
- `scripts/eval/*` 里 `phoenix.razet.me`/`fufu`/`heyun` SOCKS 隧道/指纹注释 → 开源前清。

**决策:保留但可选**
- `notify.ts:9` pushplus(China-only)→ 抽成可选通道(§4)。微信 UI 串(SchedulerPanel/PrReviewsPanel/daily.ts)随之。
- Keep/Strava 凭据(`settings.ts:100-149`)→ `.env.example` 占位空,可选。

**已核验干净(无需动)**
- 源码**无内嵌真实密钥**(`sk-`/`ghp_`/`eyJ`/`AKIA`/`xoxb-` 0 命中)。
- **无硬编个人手机号/真名/家庭 GPS**(home location 由 DB/轨迹派生;eval `30.25,120.15` 是合成 fixture)。
- 天气用 keyless Open-Meteo;AI base URL 全 config 驱动(私有网关 URL 在 DB 设置里,不在代码)。

## 8. `.env.example` 键全集(单用户自部署)

- **基础设施**:`DATABASE_URL`(默认 `file:./data/pr.db`)、`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`、`SETTINGS_ENCRYPTION_KEY`、`PR_UPLOAD_DIR`。
- **AI(8)**:`ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL`/`ANTHROPIC_VISION_MODEL`、`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`/`OPENAI_API_FORMAT`。
- **PR(7+3)**:`PR_CHAT_TOKEN`、`PR_EMBEDDING_API_KEY`/`_BASE_URL`/`_MODEL`、`PR_MEMORY_RECONCILE_APPLY`、`PR_REVIEW_MODEL`/`_PROVIDER` + `PR_CHAT_MAX_TOKENS`/`PR_MEMORY_DECAY_DAYS`。
- **摄入/同步**:`HEALTH_IMPORT_TOKEN`、(可选)`KEEP_MOBILE`/`KEEP_PASSWORD`、`STRAVA_CLIENT_ID`/`_SECRET`/`_REFRESH_TOKEN`/`STRAVA_WEBHOOK_VERIFY_TOKEN`。
- **通知(可选)**:`PUSHPLUS_TOKEN`。
- **可观测(可选)**:`PHOENIX_COLLECTOR_ENDPOINT`/`PHOENIX_PROJECT_NAME`/`PHOENIX_API_KEY`。
- 剔除现 `.env.example` 里的 stale `NIKE_ACCESS_TOKEN`/`NIKE_REFRESH_TOKEN`(不在 settings.ts)。

## 9. 目标 repo 结构(建议)

```
pr-agent/
├─ server/                   # Hono(Bun)
│  ├─ index.ts               # Hono app:挂路由 + serveStatic(client 构建产物)+ scheduler init
│  ├─ routes/{pr,health,activities}.ts   # 22 路由(含 reviews 重命名到 /api/pr/reviews)
│  ├─ middleware/auth.ts     # withAuth/withPrChatAuth/withHealthImportAuth → Hono 中间件
│  └─ lib/
│     ├─ pr/                 # 原样搬(35 文件)
│     ├─ db/                 # client(重写,单文件 pr.db,统一入口)+ schema(精简 24 表)
│     ├─ config.ts           # runtime-config 重实现(env reader)
│     ├─ ingest/             # RawActivity + processor + 可选 adapters(keep/strava)
│     ├─ notifications/      # NotificationChannel 接口 + pushplus 可选实现
│     ├─ observability/ weather/ utils.ts   # 照抄叶子(trace/open-meteo/generateId/haversine/cn/formatDateTime)
│     └─ scheduler.ts        # 显式单用户 cron 初始化(替代 lazy GET /api/health 引导)
├─ client/                   # Vite + React(静态)
│  ├─ pr/                    # H5 对话(page.tsx 组件本体,去 'use client')
│  └─ dashboard/             # mini-admin 5 面板 + ToastProvider
├─ data/                     # 卷:pr.db + uploads
├─ Dockerfile / docker-compose.yml / .env.example / README.md
```

## 10. 迁移期兼容与风控

- **不动现网 admin**:新 repo 是拷贝式抽离;现 admin 保持运行,PR 功能不中断。原仓 `src/lib/pr` 暂不删(可后续按需下线,另立任务)。
- **保真基线**:沿用现有 eval harness(`scripts/eval`,108 条 16 维)+ /pr e2e 作抽离后回归对照。
- **单用户假设不破**:`friendProfile.limit(1)` 语义原样保留,不引 tenant 维度。
- **调度引导**:标准 app 用显式 scheduler init(或外部 cron 打 `/api/cron`),替代现在"首个 `GET /api/health` 懒启动"(那是 admin/前台分离假设的产物)。
