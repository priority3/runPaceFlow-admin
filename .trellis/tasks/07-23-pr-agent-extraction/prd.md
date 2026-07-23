# PR agent 抽离为独立自部署项目

## Goal

把 RunPaceFlow admin 里的 **PR companion agent** 抽成一个**单用户、可自部署**(`docker compose up` 即起)的独立开源项目,拥有自己的数据面,不再依赖也不再耦合主站 admin。

## Background / 为什么

- 现状:PR agent(`src/lib/pr` ~6844 行 + `src/lib/ai.ts` + `/api/pr`·`/api/health` 22 路由 + H5 `/pr` + 3 个 dashboard 面板)嵌在 admin 应用里,数据走与主站共享的 `shared.db`(activities/health),配置走 admin 的 `app_settings`。
- 诉求(用户已确认):**复用/产品化 + 开源/作品集**方向,但**当前阶段先只做"单用户自部署"**,多租户暂不做。
- 关键事实(已核实):代码单用户假设根深蒂固(`friend_profile` 是 `.limit(1)` 单例),数据层耦合集中在 `activities-client`(19)/`activities-schema`(18)。去掉多租户后,最大成本(逐表 `tenant_id` 改造)消失。

## Scope

### In-scope(本任务)
- 产出**抽离蓝图**(本 prd + `design.md` + `implement.md`):目标 repo 结构、自有库表清单、数据摄入契约、可插拔边界、密钥/业务剥离清单、分阶段迁移计划。
- 目标交付物形态定义:一个自包含 Next.js app + 自有 SQLite/libsql 库 + Dockerfile/compose + `.env.example` + README。
- **保持单用户假设不变**(不引入租户维度)。

### Out-of-scope(本任务不做)
- 多租户 / 多用户 / 鉴权体系改造。
- 主站 runPaceFlow 前台的任何改动。
- 实际的开源发布动作(licensing/公开仓库)——蓝图里给清单,发布另立任务。

## Requirements

### 功能需求
- **R1 数据面独立**:独立 app 用自有库(SQLite/libsql 文件),装 PR agent 自有表子集;不再读写主站 `shared.db`。
- **R2 数据摄入契约**:定义活动/健康数据进入独立 app 的标准入口。保留 `POST /api/health/daily`(Apple 健康快捷指令,通用)作为默认摄入;活动数据经"可插拔数据源适配器"或导入接口进入。
- **R3 数据源可插拔**:Keep(手机号+密码,业务特定)、Strava 等降级为**可选适配器**,默认关闭;缺失时 app 仍可仅靠健康摄入 + 手动导入运行。
- **R4 网关/服务可插拔且 config 驱动**:LLM 网关(ANTHROPIC_*/OPENAI_*,已 config 驱动)、通知渠道(pushplus→接口)、embedding provider(PR_EMBEDDING_*)全部经 env/设置注入,无硬编码。
- **R5 功能保真**:抽离后**每日反思 / 复盘 / 对话(含主动查证工具循环、多模态、记忆) / RAG 知识库**行为与现网一致(以现有 eval harness 与 e2e 为基准)。
- **R6 密钥/业务剥离**:代码内不含任何私有 URL/token/手机号/个人数据;全部外置到 `.env.example` + 文档。

### 非功能需求
- **N1 自部署**:干净环境 `git clone` → 配 `.env` → `docker compose up` 即可起,含库迁移/初始化。
- **N2 单文件库可携带**:数据落在一个可备份的 SQLite 文件(或 libsql)。
- **N3 可观测可选**:Phoenix/OTel 依赖缺失时零开销降级,不阻断启动。
- **N4 迁移可回滚、分阶段**:不影响现网 admin 运行;每阶段可独立验证。

## Constraints
- 保留单用户假设(`friend_profile` 单例语义不变)。
- Anthropic 协议为主链路(工具/图片/缓存都在 Claude 分支);沿用现有 `callPrModel` 及刚上线的 `tool_choice:none` 硬停修复。
- 迁移期间现网 admin 的 PR 功能不得中断。

## Acceptance Criteria(本规划任务)
- [ ] `design.md`:给出目标 repo 目录结构、自有库**逐表清单**(owned vs 需迁移的 shared 子集 + 跨界 FK 处理)、数据摄入契约(端点/schema/auth)、可插拔适配器接口(数据源/LLM/通知/embedding)、与主站的数据关系定论。
- [ ] `design.md`:密钥/业务**剥离清单**(逐 file:line)+ `.env.example` 键全集。
- [ ] `implement.md`:**分阶段迁移计划**(① 本仓抽包定边界 → ② 独立 repo + 自有库 + 摄入口 → ③ 自部署打包跑通 → ④ 可选开源清洗),每阶段有验证命令与回滚点。
- [ ] 蓝图经用户 review 通过(1.4 review gate),再 `task.py start` 进入执行。

## Open Questions / 待定
- **Q1 数据边界**:全自包含(自有库 + 摄入,推荐)vs 薄抽离(仍连主站 DB)。倾向全自包含,design 阶段定论。
- **Q2 活动数据默认来源**:自部署用户没有 Keep 时,靠什么把跑步数据喂进来?(通用导入 / Apple 健康扩展 / Strava OAuth)——design 阶段定默认路径。
- **Q3 dashboard 管理面**:3 个面板是内置 mini-admin 还是纯 API 供宿主嵌?
- **Q4 目标技术栈**:沿用 Next.js 全栈单体(H5 + API 同仓,最省事)vs 拆前后端。倾向沿用。
