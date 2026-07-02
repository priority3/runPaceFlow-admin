# PR Agent 落地方案

> 配套文档:`docs/pr-agent-technical-roadmap.md`(完整愿景)。本文件是**基于当前代码真实状态**的分阶段落地计划。
> 目标:让 PR 成为一个**能持续学习用户习惯的亲密跑友**,而不是模板播报器。

## 1. 现状盘点(2026-07 实测,非文档理论)

飞轮:`事实 → 解读 → 陪伴回应 → 反馈/纠正 → 记忆 → 画像 → 下次更好的上下文`。逐环状态:

| 环节 | 状态 | 依据 / 文件 |
|---|---|---|
| 事实层 · 健康 | ✅ 通 | `health_daily_metrics` 每日入库(睡眠分段/深睡/REM/步数/环境音量/HRV/RHR),服务端夜间隔离+午睡拆分。`src/lib/pr/health.ts`、`health-derive.ts` |
| 事实层 · 运动 | ❌ 断 | Strava 应用 **Inactive(403)**,`activities` 无新数据 |
| 解读 · 活动复盘 | ⚠️ 有 AI 无数据 | `review.ts` 用 Claude(haiku)写复盘,但无活动 → 不触发 |
| 陪伴 · 周总结/日记/聊天 | ❌ 规则模板 | `weekly.ts`/`chat.ts`/`diary` **均不调 AI**(`provider: local-rule`)→ PR "没有嘴" |
| 上下文装配 | 🟡 有底子但只对活动 | `buildPrContext(activityId)` **要求活动**;已会装配 记忆/反馈/健康/RAG。`context.ts:49` |
| 反馈 → 记忆 | 🟡 半通 | `extractMemoryPatchesFromFeedback` + `applyMemoryPatch` 已接 `POST /api/activities/feedback`;但**只在提交主观反馈时触发**,且无 UI、无活动 → `memory_items` = 0 |
| 人在环 · 确认/纠正记忆 | ❌ 缺 UI | 路由已存在(`/api/pr/memories/:id/confirm|archive|PATCH`),但 **Dashboard 没有任何 PR/记忆/日记/健康面板** |
| 画像投影 | ✅ 通(空源) | `projectFriendProfile()` 会刷新 `friend_profile`,但记忆为空 |
| 投递 · 微信 | ✅ 通 | 客服文本消息优先、模板回退。`dispatcher.ts`、`wechat-test-account.ts` |
| 调度 | 🟡 部分 | 已注册 `weekly_review`(周日20:00)、`notification_dispatch`(每10min)、`daily_report`(21:00,旧的分析日报,非 PR) |

**结论:数据在流,但"会思考的嘴 + 会记的脑 + 能被你纠正的手"都没接上。** 学习环闭合度约 30%。

### 关键约束
- **AI 只有 haiku 可用**:配置的代理 `a-ocnfniawgw...fcapp.run` 上 opus/sonnet 均 503,仅 `claude-haiku-4-5` 稳定。prompt 需精简。
- **运动数据暂缺**:Strava 停用前,学习环先建在"健康/恢复/作息"上(健康数据每日在流,足够)。
- **微信文本消息**受 48h 客服窗口限制,窗口关闭自动回退模板卡片。
- 部署:heyun `/opt/runPaceFlow-admin`,rsync + `docker build --network=host` + `up -d --no-build`(见 [[health-reporting-deploy]] 记忆)。

## 2. 设计原则:闭合"最小学习环",再滚大

不照搬文档一次性建多 Agent 编排 / RAG / Evaluator。**每个阶段闭合一个肉眼可见"它在学我"的回路,可独立上线、可验证。**

## 3. 阶段落地

### 阶段 1 —— 给 PR 一张嘴:AI 每日反思(健康驱动)+ 记忆种子

**目标**:每天基于健康数据,PR 用 haiku 写一段有跑友口吻的当日反思,经微信发出;并吐 0–3 条候选记忆。

**要做**:
1. `src/lib/pr/model.ts`(新):从 `review.ts` 抽出共享 `callPrModel(system, user, opts)`,统一 Claude/OpenAI 兼容调用 + 规则回退。供 review/daily/weekly/chat 复用。
2. `src/lib/pr/context.ts`:新增 `buildDailyContext(date)` —— **不依赖活动**,装配:当日健康 + 近14天健康趋势 + active/correction 记忆 + `friend_profile` + 近期反馈 + 比赛目标。(现有 `buildPrContext` 保留给活动复盘。)
3. `src/lib/pr/daily.ts`(新):`generateDailyReview({date, force, enqueueNotification})` —— 建上下文 → `callPrModel` 写反思 → 写 `activity_reviews(kind='pr_recovery_review', subject_type='recovery_day', subject_id=YYYY-MM-DD)` → 入队微信通知 → 调 MemoryCurator(下条)。
4. `src/lib/pr/memory.ts`:新增 `extractMemoryCandidatesFromReflection(context, draft)` —— 让 AI 从反思中提炼 0–3 条 patch(habit/preference/risk_pattern),`applyMemoryPatch` 写入 `memory_items(status='candidate')`。
5. 触发:新增调度 `daily_review`(约 09:30,健康数据上报后)→ 生成+入队;`notification_dispatch` 每10min发出。并加 `POST /api/pr/daily-review` + cron action `daily-review` 供手动触发。

**验收**:微信收到 AI 写的当日反思(引用今日睡眠/恢复/步数、近期趋势);`memory_items` 出现候选记忆;`activity_reviews` 有 `pr_recovery_review` 记录且带 `context_json`。

**影响文件**:`model.ts`(新)、`daily.ts`(新)、`context.ts`、`memory.ts`、`scheduler.ts`/`scheduler-config.ts`、`api/pr/daily-review/route.ts`(新)、`api/cron/route.ts`。

### 阶段 2 —— 接上"脑"与"手":记忆面板 + 反馈入口(闭合学习环)

**目标**:你能看到 PR 的候选记忆并**确认/纠正**,纠正后 PR 不再犯同样的错。这是"学习"的关键闭环。

**要做**:
1. `src/app/dashboard/components/MemoryPanel.tsx`(新):列出候选/active 记忆 → 确认(→active)/纠正(→archived + 写 `do_not_assume`)/编辑。调现有 `GET /api/pr/memories`、`confirm|archive|PATCH`。
2. `src/app/dashboard/components/HealthRecoveryPanel.tsx`(新):睡眠/深睡/REM/步数/环境音量趋势(`GET /api/health/daily?limit=14`)。
3. `src/app/dashboard/components/PrReviewsPanel.tsx`(新):最近反思/复盘列表 + 手动重发微信(`POST /api/activities/reviews/notify` 或每日重触发)。
4. 反馈入口:心情/RPE/备注 → `POST /api/activities/feedback`(已接 `extractMemoryPatchesFromFeedback`)。
5. `DashboardView.tsx`:新增 "PR" 标签页挂上述面板。

**验收**:确认一条候选 → `friend_profile` 更新 → 次日反思能自然引用;纠正一条 → 写入 `do_not_assume` → 后续反思避开。

### 阶段 3 —— 能对话的伙伴

**要做**:`chat.ts` 换 AI(`callPrModel` + `buildDailyContext` + 会话摘要);`POST /api/pr/chat` 返回 AI 回复;`ChatPanel.tsx`。聊天中再抽记忆候选。
**验收**:与 PR 对话,回复引用你的记忆/数据;新事实进入候选记忆。

### 阶段 4 —— 加宽与加固

RAG 训练知识(`rag.ts` + 导入脚本)、Evaluator 事实/语气/医学风险护栏(`evaluator.ts`,复盘发出前校验)、重新激活 Strava 引回运动数据、指标/飞轮面板(`metrics.ts`/`flywheel.ts` + UI)、`agent_runs`/`agent_state_snapshots` 全链路可观测。

## 4. 里程碑

- **M1(阶段1)**:PR 每天用 AI 说话 + 开始记忆 → "活了"。
- **M2(阶段2)**:你能教它、纠正它 → **学习环闭合**(核心目标达成)。
- **M3(阶段3)**:能对话。
- **M4(阶段4)**:有深度(知识/护栏/运动数据/可观测)。

## 5. 风险与对策

- **AI 幻觉/泛化**:prompt 强制引用 `context_json` 的具体数据;阶段4 加 Evaluator。
- **haiku 能力上限**:反思/记忆提炼够用;若需更强需换可用的 opus/sonnet 源。
- **记忆污染**:候选默认不进强结论;必须用户确认或多次证据才 active;纠正优先级最高。
- **数据单薄(无运动)**:阶段1–3 全部可在"仅健康数据"下成立;运动数据作为阶段4增量。
- **每次改动都需重建镜像**(host-network 构建绕 DNS);保持小步、每阶段可回滚。
