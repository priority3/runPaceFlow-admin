# PR Agent 完整技术方案

## 目标定位

PR 是 RunPaceFlow 里的跑友型 Agent。它不是普通助手，也不是单纯的数据看板，而是一个长期了解用户、热爱运动、会认真看训练数据、会结合生活状态和目标给出复盘与提醒的“老朋友”。

系统需要完整覆盖：

- Apple Watch 经 Strava 同步来的跑步、骑行等运动数据。
- Strava activity detail 和 streams 的拉取、解析和特征提取。
- 跑后 PR 复盘、图表批注、训练建议、周总结和比赛目标复盘。
- 微信测试号异步推送。
- Dashboard 展示、重生成、重试通知、反馈录入。
- 主观反馈、老友日记、长期偏好、伤病注意点、比赛目标。
- HealthKit 睡眠、HRV、静息心率等恢复数据。
- 早起照片、饮食照片、装备照片、伤痛照片等多模态生活输入。
- 训练知识库 RAG。
- 多 Agent / 状态机编排。

## 现有基础

当前 repo 已具备以下能力，可作为 PR Agent 的底座：

- Next.js API Routes、React Dashboard、Bun runtime。
- Drizzle/libSQL 活动库连接。
- `activities`、`splits`、`sync_logs`、`activity_insights` 等运动数据表。
- Strava adapter、增量同步和同步适配层抽象。
- Strava streams 拉取能力。
- GPX 解析、公里分段、天气获取、赛事匹配。
- AI provider 接入：Claude/OpenAI compatible。
- Scheduler、手动 cron 触发、配置中心。

PR Agent 在这个基础上扩展，不把既有运动事实表变成 Agent 输出表。

## 总体架构

```text
External Data
  Apple Watch -> Strava
  HealthKit Shortcuts
  Photos / Manual Feedback
  Training Knowledge Docs
        |
        v
Ingestion
  Sync Adapters
  Strava Webhook Receiver
  Health Import API
  Multimodal Upload API
  Feedback API
  Knowledge Ingestion
        |
        v
Fact Store
  activities
  splits
  sync_logs
  gpx_data
  route_coordinates
  health_daily_metrics
  subjective_feedback
  life_events
        |
        v
Feature Store
  kilometer features
  stream moments
  weather context
  recovery signals
  race goal progress
  image observations
        |
        v
Memory & Retrieval
  friend_profile
  friend_diary_entries
  race_goals
  knowledge_chunks
  conversation_messages
        |
        v
Agent Orchestration
  Analyst
  Recovery Analyst
  Memory Curator
  Race Planner
  Nutrition / Life Observer
  Knowledge Retriever
  Friend Persona
        |
        v
Outputs
  activity_reviews
  review_annotations
  weekly reviews
  race goal reviews
  friend diary
  notification_deliveries
        |
        v
Delivery
  Dashboard
  WeChat Test Account
```

## 核心原则

- 运动事实与 Agent 输出分离：`activities` 和 `splits` 只保存事实，PR 复盘写入 `activity_reviews`。
- 复盘可追溯：每条 PR 输出保存 `features_json` 和 `context_json`，能解释当时用了哪些数据。
- 通知异步化：微信测试号发送不阻塞同步、AI 生成或用户操作。
- 上下文统一构建：所有 PR 输出统一通过 `src/lib/pr/context.ts` 组装上下文。
- 多模态输入进入事实层：照片识别结果存成结构化观察，再进入 PR 上下文。
- RAG 只提供依据，不覆盖事实：知识库检索结果进入 prompt context，不改写活动数据。
- 多 Agent 编排复用业务函数：Agent 节点调用已有同步、特征、记忆、RAG、通知模块。

## 数据模型

### 运动事实层

沿用或扩展：

- `activities`
- `splits`
- `sync_logs`
- `user_profile`
- `activity_insights`

`activity_insights` 继续保留为专业分析缓存；PR 的人格化复盘不写入此表。

### PR 输出表

```sql
CREATE TABLE activity_reviews (
  id text PRIMARY KEY NOT NULL,
  activity_id text,
  kind text NOT NULL,
  features_json text NOT NULL,
  context_json text,
  content text NOT NULL,
  model text NOT NULL,
  provider text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);

CREATE INDEX idx_activity_reviews_activity_id
  ON activity_reviews(activity_id);

CREATE INDEX idx_activity_reviews_kind_created_at
  ON activity_reviews(kind, created_at);
```

`kind` 取值：

- `pr_activity_review`
- `pr_weekly_review`
- `pr_race_goal_review`
- `pr_recovery_review`
- `pr_life_observation`

### 图表批注表

```sql
CREATE TABLE review_annotations (
  id text PRIMARY KEY NOT NULL,
  review_id text NOT NULL,
  activity_id text NOT NULL,
  type text NOT NULL,
  at_seconds integer,
  kilometer real,
  label text NOT NULL,
  content text NOT NULL,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (review_id) REFERENCES activity_reviews(id) ON DELETE cascade,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE cascade
);
```

`type` 取值：

- `surge`
- `slowdown`
- `pause`
- `high_hr`
- `strong_finish`
- `hr_drift`
- `weather_note`
- `race_goal_note`

### 微信测试号通知投递表

```sql
CREATE TABLE notification_deliveries (
  id text PRIMARY KEY NOT NULL,
  review_id text,
  channel text NOT NULL,
  recipient text,
  title text NOT NULL,
  content text NOT NULL,
  payload_json text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at integer,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (review_id) REFERENCES activity_reviews(id) ON DELETE SET NULL
);

CREATE INDEX idx_notification_deliveries_status_created_at
  ON notification_deliveries(status, created_at);

CREATE INDEX idx_notification_deliveries_review_id
  ON notification_deliveries(review_id);
```

`channel` 固定为：

- `wechat_test_account`

微信测试号发送流程：

```text
activity_reviews insert
  -> notification_deliveries pending
  -> notification_dispatcher
  -> get WeChat access_token
  -> send template/customer message
  -> mark sent / failed
```

### 主观反馈表

```sql
CREATE TABLE subjective_feedback (
  id text PRIMARY KEY NOT NULL,
  activity_id text,
  mood text,
  rpe integer,
  pain_json text,
  note text,
  source text NOT NULL,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);
```

### 老友记忆表

```sql
CREATE TABLE friend_profile (
  id text PRIMARY KEY NOT NULL,
  display_name text,
  tone text,
  goals_json text,
  preferences_json text,
  injury_notes_json text,
  observations_json text,
  source_diary_id text,
  updated_at integer DEFAULT (unixepoch()) NOT NULL
);
```

```sql
CREATE TABLE friend_diary_entries (
  id text PRIMARY KEY NOT NULL,
  period_start integer NOT NULL,
  period_end integer NOT NULL,
  content text NOT NULL,
  observations_json text,
  model text NOT NULL,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);
```

### 比赛目标表

```sql
CREATE TABLE race_goals (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  race_date integer NOT NULL,
  distance_meters real NOT NULL,
  target_type text NOT NULL,
  target_time_sec integer,
  priority text NOT NULL DEFAULT 'primary',
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  updated_at integer DEFAULT (unixepoch()) NOT NULL
);
```

### 恢复数据表

```sql
CREATE TABLE health_daily_metrics (
  id text PRIMARY KEY NOT NULL,
  date text NOT NULL,
  sleep_minutes integer,
  deep_sleep_minutes integer,
  rem_sleep_minutes integer,
  hrv real,
  resting_hr integer,
  source text NOT NULL,
  payload_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);

CREATE UNIQUE INDEX idx_health_daily_metrics_date_source
  ON health_daily_metrics(date, source);
```

### 生活与多模态输入表

```sql
CREATE TABLE life_events (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  occurred_at integer NOT NULL,
  media_url text,
  raw_text text,
  observation_json text,
  model text,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);
```

`type` 取值：

- `morning_photo`
- `meal_photo`
- `gear_photo`
- `injury_photo`
- `manual_note`

### Strava Webhook 事件表

```sql
CREATE TABLE strava_events (
  id text PRIMARY KEY NOT NULL,
  aspect_type text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  owner_id text,
  payload_json text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  processed_at integer
);

CREATE UNIQUE INDEX idx_strava_events_unique
  ON strava_events(aspect_type, object_type, object_id, created_at);
```

### 知识库表

```sql
CREATE TABLE knowledge_documents (
  id text PRIMARY KEY NOT NULL,
  title text NOT NULL,
  source text,
  metadata_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);
```

```sql
CREATE TABLE knowledge_chunks (
  id text PRIMARY KEY NOT NULL,
  document_id text NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  metadata_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE cascade
);
```

```sql
CREATE TABLE knowledge_embeddings (
  id text PRIMARY KEY NOT NULL,
  chunk_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  vector_json text NOT NULL,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id) ON DELETE cascade
);
```

### 对话记录表

```sql
CREATE TABLE conversation_messages (
  id text PRIMARY KEY NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  context_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);
```

## 模块设计

### 同步模块

文件：

```text
src/lib/sync/service.ts
src/lib/sync/adapters/strava.ts
src/lib/strava/events.ts
```

职责：

- 定时同步 Strava 活动。
- 接收 Strava Webhook 并写入 `strava_events`。
- drain pending webhook events。
- 保持 `(source, source_id)` 去重。
- 返回新增 `activityIds`。

关键输出：

```ts
export interface SyncResult {
  success: boolean
  activitiesCount: number
  activityIds: string[]
  errorMessage?: string
  logId: string
}
```

### 运动特征模块

文件：

```text
src/lib/activity/review-features.ts
src/lib/activity/stream-moments.ts
```

职责：

- 从 `activities + splits + weatherData` 提取公里级特征。
- 从 GPX/Strava streams 构造 `StreamPoint`。
- 计算移动窗口配速、心率、海拔、停顿。
- 输出冲刺、掉速、心率峰值、心率漂移、强收尾等 moments。

核心类型：

```ts
export interface ActivityReviewFeatures {
  version: number
  summary: {
    activityId: string
    title: string
    type: string
    distanceKm: number
    durationSec: number
    averagePaceSecPerKm: number | null
    averageHeartRate: number | null
    maxHeartRate: number | null
    elevationGain: number | null
    weatherDescription: string | null
  }
  pace: {
    trend: 'negative_split' | 'positive_split' | 'steady' | 'unknown'
    fastestKm: number | null
    slowestKm: number | null
    firstHalfAvgPace: number | null
    secondHalfAvgPace: number | null
  }
  effort: {
    fatigueSignal: 'low' | 'medium' | 'high' | 'unknown'
    heartRateNote: string | null
  }
  moments: ReviewMoment[]
}
```

### 上下文模块

文件：

```text
src/lib/pr/context.ts
```

职责：

- 读取活动特征。
- 读取最近训练负荷。
- 读取主观反馈。
- 读取恢复数据。
- 读取比赛目标。
- 读取老友日记和 profile。
- 调用 RAG 检索训练知识。
- 组装统一 `PrContext`。

核心类型：

```ts
export interface PrContext {
  activity?: ActivityReviewFeatures
  recentTraining?: RecentTrainingContext
  subjectiveFeedback?: SubjectiveFeedbackContext[]
  recovery?: RecoveryContext
  raceGoal?: RaceGoalContext
  friendProfile?: FriendProfileContext
  friendDiary?: FriendDiaryContext
  lifeEvents?: LifeEventContext[]
  retrievedKnowledge?: KnowledgeContext[]
}
```

### PR 生成模块

文件：

```text
src/lib/pr/prompts.ts
src/lib/pr/review.ts
```

职责：

- 生成跑后复盘。
- 生成周总结。
- 生成比赛目标复盘。
- 生成恢复建议。
- 生成生活输入观察。
- 将内容写入 `activity_reviews`。
- 生成 `review_annotations`。

PR 语气要求：

- 中文。
- 像懂用户的跑友。
- 不输出生硬报表。
- 必须引用具体数据或上下文。
- 可以调侃，但不羞辱。
- 可以提醒休息，但不做医学诊断。
- 不在结尾追问用户补数据。

### 微信测试号通知模块

文件：

```text
src/lib/notifications/dispatcher.ts
src/lib/notifications/wechat-test-account.ts
```

职责：

- 将需要推送的 review 写入 `notification_deliveries`。
- 缓存/刷新微信 access token。
- 调用微信测试号模板消息或客服消息接口。
- 记录 pending/sent/failed。
- 支持重试。

配置：

```text
PR_NOTIFICATION_ENABLED
WECHAT_TEST_ACCOUNT_APP_ID
WECHAT_TEST_ACCOUNT_APP_SECRET
WECHAT_TEST_ACCOUNT_TEMPLATE_ID
WECHAT_TEST_ACCOUNT_OPEN_ID
```

### Dashboard 模块

新增页面/组件：

```text
src/app/dashboard/components/PrReviewsPanel.tsx
src/app/dashboard/components/ActivityDetailPanel.tsx
src/app/dashboard/components/FriendDiaryPanel.tsx
src/app/dashboard/components/RaceGoalsPanel.tsx
src/app/dashboard/components/HealthRecoveryPanel.tsx
src/app/dashboard/components/LifeEventsPanel.tsx
```

能力：

- 最近 PR 复盘列表。
- 单活动详情：配速、心率、路线、批注。
- 主观反馈录入。
- 微信通知状态和重试。
- 老友日记查看和编辑。
- 比赛目标管理。
- 睡眠/HRV/RHR 趋势。
- 生活照片观察记录。

### HealthKit 恢复数据模块

文件：

```text
src/lib/pr/health.ts
src/app/api/health/daily/route.ts
```

职责：

- 接收 iOS Shortcuts/HealthKit JSON。
- 幂等写入每日睡眠、HRV、静息心率。
- 输出恢复状态标签。
- 将恢复状态注入 PR context。

### 多模态生活输入模块

文件：

```text
src/lib/pr/life-events.ts
src/app/api/life-events/route.ts
```

输入：

- 早起照片。
- 饮食照片。
- 装备照片。
- 伤痛/贴扎照片。
- 手动生活备注。

处理：

- 上传文件或外部 URL。
- 多模态模型生成结构化 observation。
- 写入 `life_events`。
- 注入 PR context 和 friend diary。

示例 observation：

```json
{
  "type": "meal_photo",
  "summary": "高碳水晚餐，蛋白质偏少",
  "training_relevance": "适合长距离前补糖，但恢复蛋白不足",
  "memory_candidate": false
}
```

### 老友日记模块

文件：

```text
src/lib/pr/diary.ts
```

职责：

- 汇总最近活动、reviews、subjective feedback、life events、health metrics、race goals。
- 生成 `friend_diary_entries`。
- 提取可更新 profile 的候选观察。
- 通过白名单字段更新 `friend_profile`。

### 赛事目标模块

文件：

```text
src/lib/pr/race-goals.ts
src/app/api/race-goals/route.ts
```

职责：

- 维护比赛目标。
- 计算倒计时。
- 计算备赛周期位置：基础期、强化期、专项期、减量期、赛后恢复。
- 计算周跑量、长距离进度。
- 注入 PR context。

### RAG 知识库模块

文件：

```text
src/lib/pr/rag.ts
scripts/ingest-knowledge.ts
```

职责：

- 导入训练理论文档。
- 切块。
- 生成 embedding。
- 按 query 检索训练知识。
- 输出带来源的知识上下文。

RAG 进入场景：

- PR 解释训练建议原因。
- PR 生成周总结。
- PR 围绕比赛目标给训练方向。
- 用户在 Dashboard 或聊天入口询问训练理论。

### 多 Agent / 状态机编排

建议 Agent：

- `Analyst`：运动数据与 streams 特征提取。
- `RecoveryAnalyst`：睡眠、HRV、RHR、疲劳信号。
- `LifeObserver`：照片和生活输入观察。
- `MemoryCurator`：老友日记和 profile 更新。
- `RacePlanner`：比赛目标和周期语境。
- `KnowledgeRetriever`：RAG 检索。
- `FriendPersona`：统一 PR 口吻输出。

编排状态：

```ts
export interface PrAgentState {
  trigger: 'activity_synced' | 'webhook_event' | 'manual_review' | 'weekly_review' | 'life_event' | 'user_question'
  activityId?: string
  lifeEventId?: string
  context: PrContext
  features?: ActivityReviewFeatures
  retrievedKnowledge?: KnowledgeContext[]
  draft?: string
  final?: string
}
```

## API 设计

```text
GET  /api/activities/reviews
POST /api/activities/reviews/regenerate
POST /api/activities/reviews/notify
POST /api/notifications/retry

POST /api/activities/feedback
GET  /api/activities/feedback/recent

GET  /api/race-goals
POST /api/race-goals
PATCH /api/race-goals/:id
DELETE /api/race-goals/:id

POST /api/health/daily

POST /api/life-events
GET  /api/life-events

GET  /api/strava/webhook
POST /api/strava/webhook

POST /api/pr/weekly-review
POST /api/pr/diary/generate
POST /api/pr/chat
```

## 后台任务

Scheduler jobs：

- `sync`：同步 Strava 活动。
- `strava_event_drain`：处理 Strava webhook 事件。
- `pr_review`：为未生成复盘的新活动补生成 review。
- `notification_dispatch`：发送微信测试号通知。
- `friend_diary`：生成老友日记并更新 profile。
- `weekly_review`：生成周总结和比赛目标复盘。
- `knowledge_ingestion`：导入知识库文档。
- `retention_cleanup`：按策略清理过期临时数据。

## 端到端流程

### 同步后跑后复盘

```text
sync job / manual sync
  -> performSync
  -> activityIds
  -> buildReviewFeatures
  -> buildPrContext
  -> Agent orchestration
  -> activity_reviews insert
  -> review_annotations insert
  -> notification_deliveries pending
  -> notification_dispatch
  -> WeChat Test Account
```

### Strava Webhook 跑后复盘

```text
POST /api/strava/webhook
  -> strava_events pending
  -> strava_event_drain
  -> targeted sync
  -> buildReviewFeatures
  -> buildPrContext
  -> activity_reviews
  -> notification_deliveries
```

### 主观反馈影响复盘

```text
POST /api/activities/feedback
  -> subjective_feedback insert
  -> regenerate review
  -> context_json records feedback ids
```

### 生活照片输入

```text
POST /api/life-events
  -> media stored
  -> multimodal observation
  -> life_events insert
  -> context update
  -> optional pr_life_observation review
  -> optional WeChat notification
```

### 老友日记

```text
friend_diary job
  -> recent activities
  -> reviews
  -> feedback
  -> life_events
  -> health metrics
  -> race goals
  -> friend_diary_entries
  -> friend_profile patch
```

## 配置项

```text
PR_REVIEW_ENABLED
PR_NOTIFICATION_ENABLED
PR_REVIEW_PROVIDER
PR_REVIEW_MODEL
PR_REVIEW_TONE
PR_REVIEW_MAX_PER_SYNC
PR_CONTEXT_DAYS
PR_DIARY_ENABLED

WECHAT_TEST_ACCOUNT_APP_ID
WECHAT_TEST_ACCOUNT_APP_SECRET
WECHAT_TEST_ACCOUNT_TEMPLATE_ID
WECHAT_TEST_ACCOUNT_OPEN_ID

STRAVA_WEBHOOK_ENABLED
STRAVA_WEBHOOK_VERIFY_TOKEN

HEALTH_IMPORT_TOKEN
HEALTH_CONTEXT_ENABLED

LIFE_EVENTS_ENABLED
MULTIMODAL_PROVIDER
MULTIMODAL_MODEL

RAG_ENABLED
EMBEDDING_PROVIDER
EMBEDDING_MODEL
```

## 验收标准

- 同步新活动后自动生成 PR 复盘。
- PR 复盘能引用距离、配速、心率、天气、爬升和具体 moments。
- 微信测试号能收到异步推送。
- 微信发送失败会写入 `notification_deliveries.last_error`，可重试。
- Dashboard 能展示 review、批注、通知状态、反馈、目标、日记、恢复数据。
- 用户填写 RPE 和备注后，重新生成的复盘能体现主观状态。
- 设置比赛目标后，PR 输出能结合倒计时和备赛周期位置。
- 导入睡眠/HRV/RHR 后，PR 能结合恢复状态。
- 上传早起/饮食/装备/伤痛照片后，系统能生成结构化观察并纳入上下文。
- 老友日记能总结长期偏好、风险和训练习惯。
- RAG 能为训练建议提供知识依据。
- 多 Agent 编排失败时能记录错误，并保留单 Agent 复盘可用。
- 任何 AI、微信、RAG、多模态失败都不影响运动数据同步入库。

## 风险与处理

- Strava 限流：保留现有接近限流提前停止策略，Webhook drain 可重试。
- 微信测试号 token 失效：dispatcher 自动刷新 access token，失败写入 `last_error`。
- AI 输出泛化：prompt 要求引用具体数据，输出保存 features/context 快照。
- 医学风险：PR 只做训练和恢复建议，不做医学诊断。
- 多模态误判：照片识别结果作为 observation，进入日记前由 MemoryCurator 过滤。
- 记忆污染：`friend_profile` 更新使用白名单 patch，不允许 AI 任意覆盖。
- RAG 幻觉：知识检索结果带 source metadata，输出不把知识库内容写入事实表。
- 重复事件：活动按 `(source, source_id)` 去重，review 按 activity/kind/features hash 控制重复。
- 历史复盘错位：`activity_reviews.context_json` 保存生成时使用的 profile、diary、feedback、race goal、life event 引用。
