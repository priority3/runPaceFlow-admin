# 数据库审计 + 清理方案(只审计,未改动任何库)

> 方法:现网 heyun 容器内实测(`@libsql/client` 枚举表+行数)+ 源码核对。日期 2026-07-23。**本文档不执行任何变更**,仅给现状与清理选项。

## TL;DR

现网 PR/admin 的数据散落在 **3 个物理库**,且代码里已承认一处**数据分裂**:

1. **`admin.db`(本地)** — admin 自己的配置 + 访问分析,7 表。
2. **`shared.db`(本地)** — PR agent 全部数据 + PR 用的 activities,29 表。**名叫 "shared" 但已不再与主站共享**。
3. **Turso(远程,`settings.DATABASE_URL`)** — 主站前台用的库 + `ai.ts` 写的 activity_insights。**与本地 shared.db 是两份不同的 activities 数据**。

核心病灶:**"哪个库才是 activities 真相源"没有唯一答案** —— PR agent 写本地 shared.db(55 活动),主站/ai.ts 用远程 Turso(另一份)。`ai.ts:328` 注释原话:`ACTIVITIES_DATABASE_URL … 与主站实际使用的库(settings.DATABASE_URL)已经分裂`。

---

## 1. 三个物理库 · 实测清单

### ① admin.db — `file:/app/data/admin.db`(本地,167KB)
入口:`src/lib/db.ts`(`CONFIG_DATABASE_URL || DATABASE_URL || file:./data/admin.db`)。
| 表 | 行 | 归类 |
|---|---|---|
| app_settings | 19 | 配置(admin 唯一真相) |
| app_setting_audit_logs | 60 | 配置审计 |
| scheduler_jobs | 10 | 定时任务 |
| page_views | 125 | 访问分析 |
| click_events | 274 | 访问分析 |
| error_events | 1 | 访问分析 |
| ab_test_configs | 0 | 访问分析(空) |

→ 职责单一清晰(配置 + 访问分析),**这个库不乱**。

### ② shared.db — `file:/app/shared/shared.db`(本地,10.5MB)
入口:`src/lib/db/activities-client.ts`(`process.env.ACTIVITIES_DATABASE_URL` 优先 = 本地文件)。29 表(28 业务 + `__drizzle_migrations`)。
| 活跃表 | 行 | | 空/死表 | 行 |
|---|---|---|---|---|
| agent_state_snapshots | **812** | | activity_insights | 0 |
| splits | 263 | | knowledge_documents | 0 |
| agent_runs | 168 | | knowledge_chunks | 0 |
| sync_logs | 152 | | knowledge_embeddings | 0 |
| rag_retrieval_logs | 149 | | life_events | 0 |
| conversation_messages | 68 | | race_goals | 0 |
| activity_reviews | 66 | | subjective_feedback | 0 |
| memory_events | 66 | | rag_eval_cases | 0 |
| notification_deliveries | 66 | | strava_events | 0 |
| activities | 55 | | __drizzle_migrations | 0 |
| pr_metric_events | 50 | | | |
| memory_items | 13 | | | |
| health_daily_metrics | 9 | | | |
| friend_diary_entries | 4 | | | |
| pr_feedback_events | 6 | | | |
| review_annotations | 2 | | | |
| conversation_threads | 1 | | | |
| friend_profile | 1 | | | |
| user_profile | 1 | | | |

### ③ Turso 远程库 — `settings.DATABASE_URL`(app_settings 里,libsql 远程)
入口:`src/lib/ai.ts:334`(`const url = settings.DATABASE_URL` → 自建 client)。主站前台"回源拉配置"也取这条。装:主站实际 activities + `ai.ts` 的 activity_insights。**未在本次容器内枚举**(远程,且属主站),但代码证据充分。

---

## 2. 问题清单(按严重度)

| # | 问题 | 证据 | 严重度 |
|---|---|---|---|
| P1 | **activities 真相源分裂**:PR agent 写本地 shared.db(55 活动),主站/ai.ts 用远程 Turso(另一份)。同步新跑步进本地,主站看不到;ai.ts 洞察进 Turso,本地 0 行 | `ai.ts:328,334` 注释+代码;本地 activity_insights=0 | 🔴 高 |
| P2 | **`DATABASE_URL` 三义**:①admin 库兜底(db.ts)②activities 库兜底(activities-client)③远程 Turso(ai.ts/主站)。同一个键名在三处含义不同 | env + `ai.ts:334` + `db.ts:10` | 🔴 高(极易误配) |
| P3 | **3 个 DB client 入口**:`db.ts`/`activities-client.ts`/`ai.ts` 自建,连库逻辑各写一套、优先级不一致(env-first vs settings-first) | grep createClient ×3 | 🟡 中 |
| P4 | **僵尸空库** `/app/data/shared.db`(0 字节)——兜底逻辑生成,纯干扰 | `ls` 实测 | 🟢 低 |
| P5 | **shared.db 职责混装**:平台表(activities/splits/sync_logs/user_profile/strava_events)+ PR agent 表 28 张混在一起,无命名空间/前缀区分 | schema 实测 | 🟡 中 |
| P6 | **无迁移体系**:`__drizzle_migrations` 空;schema 靠 `activities-client.ts` inline `CREATE TABLE` + 5 处运行时 `ALTER ADD COLUMN`(`:471,481,484,493,503`)漂移演进 | 实测 + 源码 | 🟡 中 |
| P7 | **9 张 0 行死表** 常驻:activity_insights、knowledge_*(RAG 未启用)、life_events、race_goals、subjective_feedback、rag_eval_cases、strava_events。功能未上线/已弃 | 实测 | 🟢 低 |
| P8 | **agent_state_snapshots 膨胀**(812 行,占比最大):每个 agent step 落一条,无保留策略上限 | 实测 | 🟢 低(会持续涨) |

---

## 3. 目标干净态(建议)

原则:**一个应用 = 一个明确的库;每个库职责单一;真相源唯一;schema 版本化。**

- **配置/运维库**(admin 私有):`app_settings` + 审计 + scheduler + 访问分析 → 维持 `admin.db`,职责已清晰,只需明确用 `CONFIG_DATABASE_URL`(不再共用 `DATABASE_URL` 兜底)。
- **业务数据库**(activities/health/PR):**定唯一真相源**。二选一:
  - **方案甲(推荐,配合抽离)**:PR agent 用**自有本地库**(standalone 的 `pr.db`),activities 由它自己摄入(见抽离 design);主站 Turso 归主站,两者经明确的**摄入契约**流转,不再靠"共享同一文件"这种隐式耦合。
  - **方案乙(维持现状语义)**:让 admin 的 activities-client 也指向 Turso(与主站真正共享一份),废掉本地 shared.db。风险高(迁移本地 55 活动 + PR 数据上 Turso,对账)。
- **键名去歧义**:`CONFIG_DATABASE_URL`(admin)、`ACTIVITIES_DATABASE_URL`(业务)各自独立必填,**禁用 `DATABASE_URL` 万能兜底**。
- **client 归一**:一个库一个 client 工厂;`ai.ts` 不再自建,复用业务库 client(或随 activity_insights 一起决定去留)。
- **schema 版本化**:启用真正的 drizzle 迁移(`__drizzle_migrations` 落实),把 5 处运行时 ALTER 收敛进迁移。
- **死表**:9 张 0 行表——功能确认不做的删(strava_events/rag_eval_cases/activity_insights),暂缓的(knowledge_* RAG、race_goals、life_events、subjective_feedback)留但标注。
- **保留策略**:agent_state_snapshots 加 TTL/上限清理。

---

## 4. 清理动作 · 按风险分级(供你选择,本文档不执行)

**A 级 · 零/低风险(不碰生产数据)**
- A1 删僵尸 `/app/data/shared.db`(0 字节,确认无引用后)。
- A2 键名去歧义:配置显式用 `CONFIG_DATABASE_URL`/`ACTIVITIES_DATABASE_URL`,不再依赖 `DATABASE_URL` 兜底(改 env/compose,不动数据)。
- A3 文档化三库拓扑 + 分裂现状(本文件即是)。

**B 级 · 中风险(改代码/配置,重启,不迁移数据)**
- B1 client 归一:统一 DB 连接工厂,`ai.ts` 停止自建 client。
- B2 启用 drizzle 迁移,收敛运行时 ALTER。
- B3 死表处置(删确认废弃的;膨胀表加保留策略)。

**C 级 · 高风险(碰生产数据/两边库)**
- C1 **解决 P1 分裂**:定 activities 唯一真相源 → 若统一到 Turso,需迁本地 shared.db(55 活动 + 全部 PR 表)上远程并对账;若统一到本地,需把主站切回。**必须先双向备份 + 停写窗口 + 可回滚**。
- C2 admin↔主站的 activities 流转改为显式契约(而非共享文件/共享库)。

**建议顺序**:A(先做,零风险立即降噪)→ 决定真相源(甲/乙)→ 若走抽离(方案甲),C 类大部分转化为"新项目自有库 + 摄入契约",现网维持不动,风险最低。

---

## 5. 与抽离任务的关系

- 本审计证实:**PR agent 的数据全在本地 shared.db**(Turso 是主站的事)→ 抽离时"自有一个本地 `pr.db`"直接拿本地 shared.db 的 PR 表子集即可,**零 Turso 牵连**(已回写 design)。
- P1 分裂**不阻塞抽离**:standalone 自带摄入、自持数据,天然绕开"共享库"这套隐式耦合——**抽离本身就是对 P1/P2/P5 最干净的解**(方案甲)。
- 现网若不想大动,A 级三条即可显著降噪;C 级留到"是否真要统一主站/admin 数据"有结论时再单独立项。

## 6. 决定与执行记录(2026-07-23)

- **activities 真相源 = 方案甲(不合并)**:主站继续用 Turso;PR agent 抽离后自持本地库。P1 由抽离化解,**现网零迁移、C 级不做**。
- **A 级已执行**(commit `4dfcf84`,分支 `chore/db-cleanup-level-a`,行为对现网不变、未部署):
  - A1 现网删僵尸 `/app/data/shared.db`(已生效)。
  - A2 `activities-client` 去掉 `settings.DATABASE_URL` 危险兜底 + `db.ts` 键注释 + `.env.example`/compose 三角色显式化。
  - A3 本审计文档。
- **B 级**(client 归一 / 启用 drizzle 迁移 / 死表处置)→ 并入抽离(standalone 天然单 client + 迁移体系),现网不单独做。
- ⚠️ **数据备份缺口**:`admin.db` 有 `.bak`,但 `shared.db`(健康/活动/PR 真数据)**无独立备份**——抽离导数据前先拉一份。
