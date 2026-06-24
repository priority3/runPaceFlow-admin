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
  memory_items
  friend_profile
  friend_diary_entries
  race_goals
  knowledge_chunks
  conversation_messages
  agent_runs
  agent_state_snapshots
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

## 伙伴体验模型

PR 的产品目标不是“生成一段训练分析”，而是形成一个长期陪跑的伙伴。工程上需要把伙伴感拆成可验证的行为约束，而不是只依赖 prompt 语气。

### 伙伴能力边界

PR 应该像长期跑友一样做到：

- 记得长期事实：常跑距离、常用装备、伤病注意点、比赛目标、偏好的鼓励方式。
- 读得懂当下状态：最近训练负荷、睡眠恢复、主观疲劳、生活事件和当天活动表现。
- 主动但不过度：跑后、周总结、目标节点、异常恢复状态时主动触达；没有新事实时不硬聊。
- 有连续性：复盘能自然引用“你最近几周”“上次提到”“这个目标还剩几天”，而不是每次从零开始。
- 有边界感：不把一次偶发情绪写成长期性格，不把照片误判当成确定事实，不做医学诊断。
- 能被纠正：用户改正 PR 的判断后，系统应记录更正，后续输出避免重复犯错。

### 输出分层

同一份数据进入 PR 后，不直接变成最终文案，而是分成三层：

```text
facts
  activities / health / feedback / life_events
        |
        v
interpretation
  features / recovery_state / memory_candidates / risk_flags
        |
        v
companion response
  review / notification / diary / chat reply
```

实现要求：

- `facts` 必须来自数据库事实表或外部导入原文，不允许 AI 改写。
- `interpretation` 可以由规则和 AI 共同生成，但必须保存来源和置信度。
- `companion response` 可以有语气和陪伴感，但必须引用 `facts` 或 `interpretation` 的证据。

### 主动触达策略

PR 的主动性通过规则触发，而不是让模型自由决定：

- `activity_synced`：新跑步/骑行入库后生成跑后复盘。
- `recovery_alert`：睡眠、HRV、静息心率和训练负荷出现明显风险时提醒。
- `race_milestone`：比赛目标进入关键周期节点时复盘目标进度。
- `weekly_review`：固定周总结，更新老友日记和长期观察。
- `user_feedback`：用户补充 RPE、疼痛、备注后重生成相关复盘。

每次触达都写入 `agent_runs` 和 `notification_deliveries`，避免重复推送。

## 记忆与状态系统

记忆不是一张随意覆盖的 profile，而是一套“原子记忆 + 日记摘要 + 当前画像 + 证据快照”的状态系统。

### 状态分层

```text
Immutable Fact State
  activities / splits / health_daily_metrics / subjective_feedback / life_events / race_goals
        |
        v
Derived State
  review_features / stream_moments / recovery_state / race_progress / memory_candidates
        |
        v
Working State
  agent_runs / agent_state_snapshots / conversation_messages
        |
        v
Relationship State
  memory_items / friend_diary_entries / friend_profile
        |
        v
Output State
  activity_reviews / review_annotations / notification_deliveries
```

- `Immutable Fact State`：只追加或按幂等键更新事实，不让 AI 直接写入结论。
- `Derived State`：可重算，可带版本号；算法或 prompt 更新后允许回填。
- `Working State`：保存一次 Agent 运行的输入、步骤、错误、草稿和最终状态，支持失败恢复。
- `Relationship State`：PR 对用户的长期理解，只能由 MemoryCurator 按白名单更新。
- `Output State`：用户看到的内容，必须保存 context 快照，避免历史内容因当前记忆变化而漂移。

### 记忆类型

`memory_items` 保存原子记忆，每条只表达一个可审核事实或偏好：

- `preference`：用户喜欢的表达方式、训练建议密度、提醒节奏。
- `goal`：比赛目标、阶段目标、想突破的距离或配速。
- `injury`：伤病史、疼痛位置、需要避免的训练刺激。
- `habit`：常跑时间、常用路线、训练习惯、补给习惯。
- `relationship_note`：用户明确表达过的陪伴偏好，例如喜欢轻松调侃还是直接给建议。
- `correction`：用户纠正过 PR 的错误判断。
- `risk_pattern`：多次出现且有证据的风险模式，例如连续高负荷后睡眠下降。

### 记忆生命周期

```text
candidate
  -> confirmed
  -> active
  -> decayed
  -> archived
```

- `candidate`：从反馈、聊天、日记、活动模式中提取的候选记忆，不能直接强引用。
- `confirmed`：用户明确说过，或多次事实支持，允许进入 PR 上下文。
- `active`：近期仍有用的长期记忆。
- `decayed`：长期未被证实或和新事实冲突，降低引用优先级。
- `archived`：用户删除、更正或明显过期，不再进入上下文。

MemoryCurator 每次只输出 patch：

```ts
export interface MemoryPatch {
  action: 'create' | 'confirm' | 'update' | 'decay' | 'archive'
  memoryId?: string
  type: MemoryItemType
  content: string
  evidence: MemoryEvidence[]
  confidence: number
  reason: string
}
```

patch 写入前必须经过 schema 校验、白名单字段校验和冲突检测。

### 当前画像

`friend_profile` 是从 `memory_items` 和最近日记投影出来的当前画像，不是唯一真相源。它用于快速构建上下文：

- `display_name`：称呼。
- `companion_style_json`：PR 的陪伴风格，例如直接、温和、轻松、有一点调侃。
- `active_goals_json`：当前目标摘要，来源于 `race_goals` 和目标类记忆。
- `training_preferences_json`：训练偏好、提醒偏好、数据展示偏好。
- `injury_watchlist_json`：需要谨慎引用的伤痛和风险。
- `recent_state_json`：最近 7-30 天状态摘要，包括恢复、压力、训练节奏。
- `do_not_assume_json`：用户纠正过、PR 不应再默认的判断。

当 `memory_items` 变化时异步刷新 `friend_profile`。如果刷新失败，不影响事实同步和复盘生成，最多降级为只读事实上下文。

### 上下文取用规则

`buildPrContext()` 只取必要记忆，避免把全部长期记忆塞进 prompt：

- 跑后复盘：活动特征 + 近 14 天训练 + 相关伤病/目标/偏好 + 最近 3 条高相关日记。
- 周总结：近 7-14 天训练 + 恢复趋势 + 目标进度 + 本周新增/变化的记忆。
- 聊天：用户问题 + 最近会话摘要 + top-k 相关记忆 + RAG 结果。
- 生活输入：life event + 最近训练/恢复 + 相关偏好，不直接更新长期记忆。

每次上下文构建都保存 `context_json`，包含 memory ids、版本号、证据来源和检索参数。

### 数据一致性

- 外部事实表使用幂等键：Strava 用 `(source, source_id)`，HealthKit 用 `(date, source)`。
- 派生状态使用 `input_hash` 和 `builder_version`，相同输入不重复生成。
- Agent 运行使用 `agent_runs.status` 控制 `pending/running/succeeded/failed/cancelled`。
- 通知使用 `(review_id, channel, recipient)` 避免重复发送。
- 记忆更新使用乐观版本 `version`，旧 patch 不能覆盖新画像。
- 用户手动编辑或删除记忆时，写入 `memory_events`，并触发 profile 重投影。

## 上下文管理架构

上下文管理是 PR 的中枢。它决定每次输出到底能看到什么、按什么优先级看、如何避免过期记忆和无关 RAG 污染回答。

### Context Budget

`buildPrContext()` 不把所有数据塞进模型，而是按预算装配：

```ts
export interface ContextBudget {
  maxTokens: number
  activityTokens: number
  recentTrainingTokens: number
  memoryTokens: number
  diaryTokens: number
  healthTokens: number
  ragTokens: number
  conversationTokens: number
}
```

默认策略：

- 跑后复盘优先级：本次活动事实 > 近 14 天训练 > active 目标/伤病记忆 > 主观反馈 > RAG。
- 周总结优先级：近 7-14 天训练趋势 > 恢复趋势 > 目标进展 > 本周新增记忆 > RAG。
- 聊天优先级：用户问题 > 当前会话摘要 > top-k 相关记忆 > 事实数据 > RAG。
- 生活事件优先级：原始 life event > 多模态 observation > 近期训练/恢复 > candidate 记忆。

每类上下文都必须带 `source_ref`：

```ts
export interface ContextItem {
  id: string
  type: 'activity' | 'feature' | 'memory' | 'diary' | 'health' | 'rag' | 'conversation' | 'feedback'
  content: string
  sourceRef: string
  confidence?: number
  freshnessScore?: number
  relevanceScore?: number
  tokenEstimate: number
}
```

### Context Assembly Pipeline

```text
trigger
  -> resolve subject
  -> load immutable facts
  -> compute derived features
  -> retrieve relevant memory
  -> retrieve diary / conversation summary
  -> retrieve RAG if needed
  -> rank + dedupe + budget
  -> write context snapshot
  -> call Agent orchestration
```

实现要求：

- 所有 `PrContext` 都保存 `context_json`，包括被选中和被丢弃的上下文摘要。
- 记忆和 RAG 都要有 `relevanceScore`，低于阈值不进入 prompt。
- `candidate` 记忆默认不进入强结论，只能进入“可能/看起来/这次先观察”的表达。
- 上下文构建输出 `input_hash`，用于判断是否需要重生成 review。
- 当前 `friend_profile` 只作为快速索引，最终上下文仍要引用原始 `memory_items` ids。

### Context Guardrails

- 事实优先：模型输出不得用 RAG 或记忆覆盖活动事实。
- 新鲜度优先：同类记忆中近期证据优先，过期记忆进入 `decayed` 后默认不取。
- 纠错优先：`correction` 和 `do_not_assume_json` 永远进入上下文，防止重复犯错。
- 来源可见：Dashboard 能展示一条 PR 复盘用了哪些记忆、RAG chunk 和事实来源。
- 可重放：给定 `context_json`、`features_json`、prompt version 和 model，应能复现同一轮输入。

## 多 Agent 编排架构

多 Agent 不按“多个聊天机器人”理解，而是把不同业务判断拆成可测试节点。每个节点输入输出结构化状态，最终由 `FriendPersona` 统一生成伙伴式表达。

### Agent 节点职责

- `FactLoader`：读取活动、健康、反馈、目标、生活事件等事实。
- `FeatureBuilder`：构造公里特征、stream moments、训练负荷、恢复标签。
- `MemoryRetriever`：检索 active/correction/candidate 记忆。
- `KnowledgeRetriever`：按任务意图检索 RAG，并过滤低可信 chunk。
- `RiskAnalyst`：识别疲劳、伤痛、负荷跃迁和恢复风险。
- `RacePlanner`：计算比赛周期、目标进度和本周训练位置。
- `MemoryCurator`：生成 memory patches，但不直接覆盖长期画像。
- `FriendPersona`：把结构化分析变成最终复盘、提醒或聊天回复。
- `Evaluator`：对输出做事实引用、语气、风险和可行动性检查。

### 编排模式

```text
FactLoader
  -> FeatureBuilder
  -> parallel:
       MemoryRetriever
       KnowledgeRetriever
       RiskAnalyst
       RacePlanner
  -> FriendPersona
  -> Evaluator
  -> MemoryCurator
  -> Persist + Notify
```

关键规则：

- `FriendPersona` 只负责表达，不负责发明事实。
- `Evaluator` 失败时可要求 `FriendPersona` 带约束重写，最多重试一次。
- `MemoryCurator` 在输出之后运行，避免为了生成当前回复而提前污染记忆。
- 单节点失败要能降级：RAG 失败不影响复盘；记忆失败不影响事实分析；通知失败不影响 review 入库。
- 所有节点写 `agent_state_snapshots(step, state_json)`。

### Agent Contract

```ts
export interface AgentNode<I, O> {
  name: string
  version: string
  run(input: I, state: PrAgentState): Promise<{
    output: O
    metrics: AgentNodeMetrics
    warnings?: string[]
  }>
}
```

每个节点必须暴露：

- `version`：用于回放和灰度。
- `input_hash`：用于缓存和幂等。
- `warnings`：用于记录降级原因。
- `metrics`：耗时、token、成本、错误类型。

## RAG 架构

RAG 不是“让 PR 看一堆训练文章”，而是给训练建议提供可引用依据。它不进入事实层，也不替代用户自己的数据。

### Knowledge Ingestion

```text
knowledge document
  -> normalize markdown/text/pdf
  -> chunk by heading + semantic boundary
  -> attach metadata
  -> embedding
  -> index
  -> retrieval eval set
```

chunk metadata：

```ts
export interface KnowledgeChunkMetadata {
  source: string
  author?: string
  topic: 'training' | 'recovery' | 'nutrition' | 'race' | 'injury_prevention' | 'gear'
  audience: 'beginner' | 'intermediate' | 'advanced'
  evidenceLevel: 'personal' | 'coach' | 'study' | 'official' | 'unknown'
  language: 'zh' | 'en'
  updatedAt?: string
}
```

### Retrieval Pipeline

```text
query plan
  -> lexical search
  -> vector search
  -> metadata filter
  -> rerank
  -> evidence compression
  -> context budget merge
```

不同场景使用不同 query：

- 跑后复盘：用活动特征和风险标签生成 query，例如 `positive split + high HR drift + recovery run`。
- 周总结：用训练趋势和目标阶段生成 query，例如 `10k race build phase weekly mileage progression`。
- 聊天：用用户原问题 + 相关记忆生成 query。
- 伤痛/恢复：只检索低风险恢复建议，不生成诊断结论。

### RAG Guardrails

- RAG chunk 必须带来源 metadata，输出不能伪造引用。
- 与用户活动事实冲突时，事实优先，RAG 只能作为一般建议。
- 低相关或低可信 chunk 不进入上下文。
- 对医学、伤痛、营养等高风险主题只输出保守训练建议。
- 每次检索记录 `retrieval_query`、`chunk_ids`、`scores`、`rerank_reason`。

## 指标体系

指标分为系统指标、Agent 质量指标、伙伴体验指标和数据飞轮指标。指标既要能看线上稳定性，也要能回答“PR 有没有越来越懂我”。

### 系统指标

- 同步成功率：`sync_success_rate`。
- 同步延迟：活动产生到入库、入库到 review 生成、review 到微信发送。
- Agent 成功率：`agent_runs.succeeded / total`。
- 节点失败率：按 Agent node 和错误类型统计。
- 成本指标：每次 review 的 token、模型费用、RAG 检索耗时。
- 通知送达率：pending、sent、failed、retry success。

### Agent 质量指标

- 事实引用率：输出中有多少结论能对应 `context_json` 来源。
- 幻觉率：用户纠正、Evaluator 标记、无来源结论的比例。
- 可行动性：是否给出具体、可执行且不过度的训练建议。
- 语气一致性：是否符合 `companion_style_json`。
- 记忆使用准确率：引用的 memory 是否 active、相关且未被纠正。
- RAG 有效性：被引用 chunk 的相关度、来源质量和用户反馈。

### 伙伴体验指标

- 复盘打开率、微信点击率、Dashboard 回访率。
- 反馈率：用户是否补充 RPE、疼痛、备注或纠正。
- 记忆确认率：candidate memory 被用户确认的比例。
- 记忆撤回率：active memory 被用户归档或纠正的比例。
- 连续性评分：复盘是否自然承接上周、本目标、近期状态。
- 打扰率：用户关闭通知、降低频率、忽略推送的比例。

### 数据飞轮指标

- 新事实进入量：每周新增活动、反馈、健康、life events。
- 记忆成长量：新增 candidate、confirmed、active memory。
- 上下文命中率：review/chat 中命中的相关记忆和 RAG chunk。
- 复盘改进率：重生成后用户正反馈比例。
- 闭环完成率：同步 -> review -> 推送 -> 用户反馈 -> 记忆更新。

## 闭环结构与数据飞轮

PR 要越用越懂用户，必须把每次互动变成下一次更好的上下文，而不是只保存一段文案。

### 核心闭环

```text
Strava / Health / Life / Feedback
  -> facts
  -> features + context
  -> Agent output
  -> user reaction / correction / silence
  -> memory patches + metrics
  -> profile projection
  -> better next context
```

### 用户反馈闭环

反馈入口：

- 显式反馈：点赞、点踩、文字纠正、确认记忆、归档记忆、重生成。
- 训练反馈：RPE、疼痛、心情、备注。
- 行为反馈：打开、忽略、点击、重试通知、查看详情。
- 结果反馈：比赛结果、目标完成情况、训练执行情况。

反馈处理：

```text
feedback event
  -> classify intent
  -> update review feedback metrics
  -> extract correction / memory candidate
  -> update memory_events
  -> refresh friend_profile
  -> adjust future context ranking
```

### 数据飞轮阶段

1. 冷启动：只用 Strava 活动事实、基础目标和少量手动偏好，输出克制复盘。
2. 习惯学习：通过多次活动和 RPE 建立训练习惯、配速偏好和恢复模式。
3. 伙伴成型：active memory、老友日记和会话摘要稳定进入上下文，输出开始有连续性。
4. 目标闭环：比赛目标、训练执行、周总结和结果反馈形成完整周期。
5. 个性化优化：指标驱动 prompt、RAG、记忆阈值和通知策略持续调整。

### 防止负飞轮

- 候选记忆不能直接变长期画像。
- 用户纠错优先级高于模型推断。
- 多模态 observation 默认低置信度，必须多证据或用户确认才能 active。
- 低质量 RAG chunk 不能因为被多次检索就升权。
- 推送被长期忽略时自动降低主动触达频率。

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
  run_id text,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  activity_id text,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'generated',
  features_json text NOT NULL,
  context_json text,
  content text NOT NULL,
  model text NOT NULL,
  provider text,
  input_hash text NOT NULL,
  builder_version text NOT NULL,
  prompt_version text NOT NULL,
  superseded_by text,
  is_current integer NOT NULL DEFAULT 1,
  error_message text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  updated_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL,
  FOREIGN KEY (superseded_by) REFERENCES activity_reviews(id) ON DELETE SET NULL
);

CREATE INDEX idx_activity_reviews_activity_id
  ON activity_reviews(activity_id);

CREATE INDEX idx_activity_reviews_kind_created_at
  ON activity_reviews(kind, created_at);

CREATE UNIQUE INDEX idx_activity_reviews_idempotency
  ON activity_reviews(kind, subject_type, subject_id, input_hash);

CREATE UNIQUE INDEX idx_activity_reviews_current_subject
  ON activity_reviews(kind, subject_type, subject_id)
  WHERE is_current = 1;
```

`kind` 取值：

- `pr_activity_review`
- `pr_weekly_review`
- `pr_race_goal_review`
- `pr_recovery_review`
- `pr_life_observation`

`subject_type` / `subject_id` 统一表达 review 归属：

- 活动复盘：`subject_type='activity'`，`subject_id=activity_id`。
- 周总结：`subject_type='week'`，`subject_id=YYYY-WW`。
- 比赛目标复盘：`subject_type='race_goal'`，`subject_id=race_goal_id`。
- 恢复复盘：`subject_type='recovery_day'`，`subject_id=YYYY-MM-DD`。
- 生活观察：`subject_type='life_event'`，`subject_id=life_event_id`。

生成规则：

- 同一个 `(kind, subject_type, subject_id, input_hash)` 只能生成一条 review。
- 重生成时 append-only 写新 review，并将旧 review `is_current=0`、`superseded_by=<new_id>`。
- Dashboard 默认只读 `is_current=1` 的 review；历史版本用于审计、回放和对比。

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
  recipient text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  payload_json text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  provider_message_id text,
  error_code text,
  last_error text,
  next_retry_at integer,
  locked_by text,
  locked_until integer,
  sent_at integer,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  updated_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (review_id) REFERENCES activity_reviews(id) ON DELETE SET NULL
);

CREATE INDEX idx_notification_deliveries_status_created_at
  ON notification_deliveries(status, created_at);

CREATE INDEX idx_notification_deliveries_review_id
  ON notification_deliveries(review_id);

CREATE UNIQUE INDEX idx_notification_deliveries_unique_target
  ON notification_deliveries(review_id, channel, recipient);
```

`channel` 固定为：

- `wechat_test_account`

微信测试号发送流程：

```text
activity_reviews insert
  -> notification_deliveries pending
  -> notification_dispatcher claim pending by locked_until
  -> get WeChat access_token
  -> send template/customer message
  -> mark sent / failed
```

发送规则：

- 发送前必须先 claim：将 `locked_by` 和 `locked_until` 写入，避免多个 worker 重复发送。
- 只有 `review_id/channel/recipient` 唯一键插入成功后才允许进入发送队列。
- 失败时写 `error_code`、`last_error`、`next_retry_at`；重试只处理锁过期且到达 `next_retry_at` 的记录。
- 微信返回消息 ID 时写入 `provider_message_id`，用于排查第三方投递状态。

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

原子记忆表：

```sql
CREATE TABLE memory_items (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  content text NOT NULL,
  evidence_json text NOT NULL,
  confidence real NOT NULL DEFAULT 0,
  source text NOT NULL,
  first_seen_at integer DEFAULT (unixepoch()) NOT NULL,
  last_seen_at integer DEFAULT (unixepoch()) NOT NULL,
  expires_at integer,
  version integer NOT NULL DEFAULT 1,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  updated_at integer DEFAULT (unixepoch()) NOT NULL
);

CREATE INDEX idx_memory_items_type_status
  ON memory_items(type, status);

CREATE INDEX idx_memory_items_last_seen_at
  ON memory_items(last_seen_at);
```

记忆事件表：

```sql
CREATE TABLE memory_events (
  id text PRIMARY KEY NOT NULL,
  memory_id text,
  run_id text,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'applied',
  patch_json text NOT NULL,
  actor text NOT NULL,
  expected_version integer,
  resulting_version integer,
  reason text,
  conflict_reason text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE SET NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_memory_events_memory_id_created_at
  ON memory_events(memory_id, created_at);

CREATE UNIQUE INDEX idx_memory_events_idempotency
  ON memory_events(idempotency_key);
```

`memory_events.status` 取值：

- `applied`
- `needs_review`
- `conflict`
- `rejected`

记忆写入规则：

- 每个 memory patch 必须带 `idempotency_key`，避免同一 Agent run 重试时重复写事件。
- 更新已有 memory 时必须带 `expected_version`；数据库当前 `version` 不一致时写 `status='conflict'`，不得静默覆盖。
- AI 产生的新长期记忆默认写入 `needs_review` 或 `candidate`，用户确认后才能进入 `active`。
- 用户纠正的事件优先级最高，允许直接 archive 旧记忆并写入 `do_not_assume_json` 的投影输入。

当前画像表：

```sql
CREATE TABLE friend_profile (
  id text PRIMARY KEY NOT NULL,
  display_name text,
  companion_style_json text,
  active_goals_json text,
  training_preferences_json text,
  injury_watchlist_json text,
  recent_state_json text,
  do_not_assume_json text,
  projection_version integer NOT NULL DEFAULT 1,
  source_diary_id text,
  updated_at integer DEFAULT (unixepoch()) NOT NULL
);
```

周期日记表：

```sql
CREATE TABLE friend_diary_entries (
  id text PRIMARY KEY NOT NULL,
  period_start integer NOT NULL,
  period_end integer NOT NULL,
  content text NOT NULL,
  observations_json text,
  memory_patches_json text,
  model text NOT NULL,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);
```

`friend_profile` 只保存当前投影，长期事实以 `memory_items` 为准。任何 profile 字段更新都必须能追溯到 `memory_events` 或 `friend_diary_entries.memory_patches_json`。

### Agent 运行状态表

```sql
CREATE TABLE agent_runs (
  id text PRIMARY KEY NOT NULL,
  idempotency_key text NOT NULL,
  trigger text NOT NULL,
  subject_type text,
  subject_id text,
  status text NOT NULL DEFAULT 'pending',
  input_hash text,
  builder_version text NOT NULL,
  model text,
  attempts integer NOT NULL DEFAULT 0,
  last_step text,
  locked_by text,
  locked_until integer,
  next_retry_at integer,
  error_code text,
  error_message text,
  started_at integer,
  completed_at integer,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  updated_at integer DEFAULT (unixepoch()) NOT NULL
);

CREATE INDEX idx_agent_runs_trigger_status_created_at
  ON agent_runs(trigger, status, created_at);

CREATE INDEX idx_agent_runs_subject
  ON agent_runs(subject_type, subject_id);

CREATE UNIQUE INDEX idx_agent_runs_idempotency
  ON agent_runs(idempotency_key);
```

```sql
CREATE TABLE agent_state_snapshots (
  id text PRIMARY KEY NOT NULL,
  run_id text NOT NULL,
  step text NOT NULL,
  state_json text NOT NULL,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE cascade
);

CREATE INDEX idx_agent_state_snapshots_run_id_created_at
  ON agent_state_snapshots(run_id, created_at);
```

`agent_state_snapshots` 保存每个关键步骤的输入和输出摘要：context、features、retrieved knowledge、memory patches、draft、final。失败重试时从最近成功 step 恢复，而不是重新猜测状态。

Agent run 规则：

- `idempotency_key` 推荐格式：`${trigger}:${subject_type}:${subject_id}:${input_hash}`。
- worker 执行前必须 claim run：写入 `locked_by/locked_until`，锁过期后才允许其他 worker 接管。
- 每个 step 成功后更新 `last_step` 并写 `agent_state_snapshots`。
- `attempts`、`next_retry_at`、`error_code` 用于控制重试；不可重试错误直接进入 `failed`。
- 合法状态流：`pending -> running -> succeeded`，`pending/running -> failed`，`failed -> pending` 仅允许 retry API 或 scheduler 重试策略触发，`pending/running -> cancelled` 用于用户或系统取消。

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
  event_time integer NOT NULL,
  payload_hash text NOT NULL,
  idempotency_key text NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at integer,
  locked_by text,
  locked_until integer,
  error_code text,
  last_error text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  processed_at integer
);

CREATE UNIQUE INDEX idx_strava_events_unique
  ON strava_events(idempotency_key);

CREATE INDEX idx_strava_events_status_retry
  ON strava_events(status, next_retry_at, created_at);
```

Strava webhook 幂等规则：

- `idempotency_key` 推荐格式：`${owner_id}:${aspect_type}:${object_type}:${object_id}:${event_time}:${payload_hash}`。
- 不再使用 `created_at` 参与去重；`created_at` 只表示本系统接收时间。
- `event_time` 使用 Strava payload 的事件时间；没有事件时间时用 payload hash + object/action 兜底。
- drain worker 必须 claim pending event，写 `locked_by/locked_until` 后再处理。
- create/update/delete 事件都先落 `strava_events`，drain 阶段再决定是否触发 targeted sync 或忽略。

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
CREATE TABLE conversation_threads (
  id text PRIMARY KEY NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'active',
  summary text,
  summary_memory_refs_json text,
  last_message_at integer,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  updated_at integer DEFAULT (unixepoch()) NOT NULL
);
```

```sql
CREATE TABLE conversation_messages (
  id text PRIMARY KEY NOT NULL,
  thread_id text NOT NULL,
  run_id text,
  role text NOT NULL,
  content text NOT NULL,
  memory_refs_json text,
  context_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE cascade,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_conversation_messages_thread_id_created_at
  ON conversation_messages(thread_id, created_at);
```

`conversation_threads.summary` 是可压缩的短期会话状态，`memory_refs_json` 记录本轮回答引用过的长期记忆。聊天产生的新长期事实仍必须进入 `memory_items`，不能只留在 message 文本里。

### 指标与反馈闭环表

```sql
CREATE TABLE pr_feedback_events (
  id text PRIMARY KEY NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  event_type text NOT NULL,
  value text,
  note text,
  metadata_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);

CREATE INDEX idx_pr_feedback_events_target
  ON pr_feedback_events(target_type, target_id, created_at);
```

`event_type` 取值：

- `thumbs_up`
- `thumbs_down`
- `correction`
- `regenerate`
- `memory_confirm`
- `memory_archive`
- `notification_open`
- `notification_ignore`

```sql
CREATE TABLE pr_metric_events (
  id text PRIMARY KEY NOT NULL,
  run_id text,
  metric_name text NOT NULL,
  metric_value real NOT NULL,
  dimensions_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_pr_metric_events_name_created_at
  ON pr_metric_events(metric_name, created_at);
```

### RAG 检索与评估表

```sql
CREATE TABLE rag_retrieval_logs (
  id text PRIMARY KEY NOT NULL,
  run_id text,
  query text NOT NULL,
  query_plan_json text,
  result_chunk_ids_json text NOT NULL,
  scores_json text,
  selected_chunk_ids_json text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_rag_retrieval_logs_run_id
  ON rag_retrieval_logs(run_id);
```

```sql
CREATE TABLE rag_eval_cases (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  query text NOT NULL,
  expected_topics_json text,
  expected_chunk_ids_json text,
  notes text,
  created_at integer DEFAULT (unixepoch()) NOT NULL
);
```

这些表不参与核心同步链路。写入失败时只记录 warning，不阻断活动同步、review 入库或微信发送。

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
- 读取相关原子记忆、老友日记和 profile 投影。
- 读取当前 Agent 运行状态和最近会话摘要。
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
  memoryItems?: MemoryItemContext[]
  memoryEvidence?: MemoryEvidenceContext[]
  conversationState?: ConversationStateContext
  lifeEvents?: LifeEventContext[]
  retrievedKnowledge?: KnowledgeContext[]
  stateSnapshot: {
    builderVersion: string
    inputHash: string
    memoryVersion: number
    generatedAt: string
  }
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
- 优先承接用户当前状态，再给训练判断。
- 可以引用长期记忆，但要自然，不能像展示数据库字段。
- 遇到候选记忆只能用试探表达，不能说成确定事实。
- 用户纠正过的内容必须避开，并在必要时显式承认修正。
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
src/app/dashboard/components/MemoryPanel.tsx
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
- 记忆查看、确认、纠正、归档。
- 当前 PR 状态查看：最近一次运行、失败步骤、使用过的记忆证据。
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

### 记忆与老友状态模块

文件：

```text
src/lib/pr/memory.ts
src/lib/pr/profile.ts
src/lib/pr/diary.ts
src/lib/pr/state.ts
```

职责：

- 从活动、反馈、聊天、life events、health metrics、race goals 中提取 `memory_candidates`。
- 将候选记忆写入 `memory_items(status='candidate')`，保存证据和置信度。
- 根据重复证据、用户确认、用户纠正，将记忆推进到 `confirmed/active/decayed/archived`。
- 所有记忆变更先写 `memory_events`，再更新 `memory_items`。
- 从 active memory + 最近 diary 投影 `friend_profile`。
- 生成 `friend_diary_entries`，沉淀一段时间内的训练与生活脉络。
- 写入和读取 `agent_runs`、`agent_state_snapshots`，支持失败恢复和状态审计。

记忆更新流程：

```text
new facts / feedback / chat
  -> extractMemoryCandidates
  -> validate MemoryPatch schema
  -> conflict detection
  -> memory_events insert
  -> memory_items update
  -> projectFriendProfile
  -> agent_state_snapshots
```

冲突处理：

- 新候选与 active 记忆冲突时，不直接覆盖，生成 `correction` 或等待用户确认。
- 用户明确纠正优先级最高，旧记忆进入 `archived` 或写入 `do_not_assume_json`。
- AI 只能建议 patch，不能直接任意更新 profile。

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
src/lib/pr/rag-ingestion.ts
src/lib/pr/rag-eval.ts
scripts/ingest-knowledge.ts
```

职责：

- 导入训练理论文档。
- 按标题、语义边界和 token budget 切块。
- 生成 embedding。
- 维护 chunk metadata 和 eval cases。
- 执行 lexical + vector + metadata filter + rerank。
- 输出带来源、分数和压缩摘要的知识上下文。
- 记录 `rag_retrieval_logs`。

RAG 进入场景：

- PR 解释训练建议原因。
- PR 生成周总结。
- PR 围绕比赛目标给训练方向。
- 用户在 Dashboard 或聊天入口询问训练理论。

RAG 不进入场景：

- 活动事实判断。
- 用户长期偏好判断。
- 医学诊断。
- 没有明确训练建议需求的轻量陪伴回复。

### 多 Agent / 状态机编排

建议 Agent：

- `FactLoader`：事实读取和幂等校验。
- `FeatureBuilder`：运动特征、恢复特征、目标进度。
- `MemoryRetriever`：记忆召回、纠错记忆强制注入。
- `Analyst`：运动数据与 streams 特征提取。
- `RecoveryAnalyst`：睡眠、HRV、RHR、疲劳信号。
- `LifeObserver`：照片和生活输入观察。
- `MemoryCurator`：老友日记和 profile 更新。
- `RacePlanner`：比赛目标和周期语境。
- `KnowledgeRetriever`：RAG 检索。
- `FriendPersona`：统一 PR 口吻输出。
- `Evaluator`：事实引用、语气、风险、可行动性检查。

编排状态：

```ts
export interface PrAgentState {
  runId: string
  trigger: 'activity_synced' | 'webhook_event' | 'manual_review' | 'weekly_review' | 'life_event' | 'user_question'
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  step:
    | 'load_facts'
    | 'build_features'
    | 'build_context'
    | 'retrieve_knowledge'
    | 'draft_response'
    | 'curate_memory'
    | 'persist_output'
    | 'enqueue_notification'
  activityId?: string
  lifeEventId?: string
  conversationId?: string
  context: PrContext
  features?: ActivityReviewFeatures
  retrievedKnowledge?: KnowledgeContext[]
  memoryPatches?: MemoryPatch[]
  draft?: string
  final?: string
  outputIds?: {
    reviewId?: string
    diaryId?: string
    notificationId?: string
  }
  error?: string
}
```

每个 step 完成后写入 `agent_state_snapshots`。`persist_output` 成功后才允许进入 `enqueue_notification`，避免用户收到没有落库证据的消息。

### 指标与数据飞轮模块

文件：

```text
src/lib/pr/metrics.ts
src/lib/pr/feedback-loop.ts
src/lib/pr/flywheel.ts
```

职责：

- 写入 `pr_metric_events` 和 `pr_feedback_events`。
- 汇总同步、生成、通知、记忆、RAG、用户反馈指标。
- 将用户纠正转换为 memory patch 或 prompt/evaluator 问题。
- 将行为反馈用于调整通知频率和上下文排序。
- 生成 Dashboard 指标面板和飞轮健康度。

飞轮健康度输出：

```ts
export interface FlywheelHealth {
  period: { start: string; end: string }
  factGrowth: number
  feedbackRate: number
  memoryConfirmationRate: number
  memoryCorrectionRate: number
  contextHitRate: number
  ragUsefulRate: number
  notificationEngagementRate: number
  reviewRegenerationRate: number
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

GET  /api/pr/memories
POST /api/pr/memories/:id/confirm
PATCH /api/pr/memories/:id
POST /api/pr/memories/:id/archive
GET  /api/pr/agent-runs
GET  /api/pr/agent-runs/:id
GET  /api/pr/context/:runId
POST /api/pr/feedback
GET  /api/pr/metrics
GET  /api/pr/flywheel

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
  -> memory candidate extraction
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
  -> extract correction / memory candidates
  -> memory_events + memory_items update
  -> projectFriendProfile
  -> regenerate review
  -> context_json records feedback ids
```

### 生活照片输入

```text
POST /api/life-events
  -> media stored
  -> multimodal observation
  -> life_events insert
  -> candidate memory extraction
  -> context update with candidate-only memory
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
  -> memory_items active/candidate
  -> friend_diary_entries
  -> memory_events
  -> friend_profile projection refresh
```

### 用户纠正 PR 记忆

```text
PATCH /api/pr/memories/:id
  -> memory_events(action='update', actor='user')
  -> old memory version archived or updated
  -> do_not_assume_json refresh if needed
  -> projectFriendProfile
  -> future buildPrContext uses corrected memory version
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
PR_MEMORY_ENABLED
PR_MEMORY_MIN_CONFIDENCE
PR_MEMORY_DECAY_DAYS
PR_AGENT_STATE_RETENTION_DAYS

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
RAG_TOP_K
RAG_MIN_SCORE
RAG_RERANK_ENABLED

PR_EVAL_ENABLED
PR_METRICS_ENABLED
PR_FEEDBACK_LOOP_ENABLED
PR_NOTIFICATION_QUIET_THRESHOLD
```

## 验收标准

- 同步新活动后自动生成 PR 复盘。
- PR 复盘能引用距离、配速、心率、天气、爬升和具体 moments。
- 每次 PR 复盘都能查看 context snapshot，包含事实、记忆、RAG chunk 和被丢弃上下文摘要。
- 微信测试号能收到异步推送。
- 微信发送失败会写入 `notification_deliveries.last_error`，可重试。
- Dashboard 能展示 review、批注、通知状态、反馈、目标、日记、恢复数据。
- 用户填写 RPE 和备注后，重新生成的复盘能体现主观状态。
- 设置比赛目标后，PR 输出能结合倒计时和备赛周期位置。
- 导入睡眠/HRV/RHR 后，PR 能结合恢复状态。
- 上传早起/饮食/装备/伤痛照片后，系统能生成结构化观察并纳入上下文。
- 老友日记能总结长期偏好、风险和训练习惯，并生成可审核的 memory patches。
- PR 能在复盘中自然引用 active 记忆，并在 `context_json` 中保存 memory ids。
- 用户纠正一条记忆后，后续复盘不再使用旧判断。
- Agent 运行失败时能在 `agent_runs` 看到失败 step，并能从最近 state snapshot 重试。
- RAG 能为训练建议提供知识依据，并在 `rag_retrieval_logs` 中记录 query、chunk 和分数。
- 多 Agent 编排失败时能记录错误，并保留单 Agent 复盘可用。
- Evaluator 能拦截缺少事实引用、语气不匹配、医学风险过高的输出。
- 指标面板能展示 Agent 成功率、通知送达率、记忆确认/纠正率、RAG 命中质量。
- 数据飞轮能闭环记录：同步 -> review -> 推送 -> 用户反馈 -> 记忆更新 -> 下次上下文命中。
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
