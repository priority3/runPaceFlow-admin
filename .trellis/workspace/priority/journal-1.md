# Journal - priority (Part 1)

> AI development session journal
> Started: 2026-07-20

---



## Session 1: PR 知识库 RAG 混合检索改造落地

**Date**: 2026-07-21
**Task**: PR 知识库 RAG 混合检索改造落地
**Branch**: `feat/pr-boundary-weather`

### Summary

重写 retrieveKnowledge 为混合检索:中文2-gram BM25 词法层(rag-lexical.ts)+ 可选 OpenAI 兼容向量路(embeddings.ts, PR_EMBEDDING_* 三键)+ RRF(k=60) 融合;删 200 条召回上限;ingest 自动生成向量+幂等回填脚本(退出码 0/1/2);评测新增 kn/retrieval 维度 3 条(词法档×2+语义档 requiresEmbedding 自动 skip,判定与应用层 getEmbeddingConfig 同源)。工作流实现+4视角对抗验证(BM25 手算 1e-9 对照/降级矩阵实测/E2E 冒烟 37 断言/规范核查),按发现修复 TOCTOU、cosine 维度截断、缓存键碰撞、skip 同源、回填退出码。向量路待 SiliconFlow 凭据:admin 配三键→跑回填即点亮。spec 新增 backend/pr-rag-retrieval.md。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `4acda25` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: admin 配置管理瘦身落地

**Date**: 2026-07-22
**Task**: admin 配置管理瘦身落地
**Branch**: `main`

### Summary

42→38 键:预设整块移除(占位符覆盖真实 DATABASE_URL 的危险按钮)、5 个 env-only/假旋钮键摘除、微信测试号 5 键连路由 sender 全套退役、6 个幽灵键转正入新 pr 分类、全部保留键描述重写(凭据附获取方式)。机制修复:defaultValue 不再冒充已配置值经 export 覆盖主站 env;ai.ts/scheduler/cron 12 处 env 直读统一 getRuntimeSettings;无鉴权死端点 /api/settings/public 退役;新增孤儿行清理脚本(dry-run 默认)。审计 5 视角+实现 6 agent,tsc/lint 绿,门禁隔离库实测通过。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `e456ccc` | (see git log) |
| `ca11854` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Trellis 任务簿记清账:三个 PR 任务证据核证后归档

**Date**: 2026-07-22
**Task**: Trellis 任务簿记清账:三个 PR 任务证据核证后归档
**Branch**: `main`

### Summary

对 4 个挂账 in_progress 任务做证据审计(4 个并行核查 agent,程序化核验 results.json/commit 祖先链/代码态):07-20-pr-eval-cases-expansion(A1-A5 回填,104 条交付@491ff64,等效 104/104)、07-21-pr-boundary-weather-fixes(A1-A3 回填,v9 边界段@f5d1511 + place 城市@cdf24fc,定点 12/12 全绿)、07-21-pr-proactive-recall(注释与产物一致,4973acd..473fc60 均在 main)三者验收框按实据回填后归档。00-bootstrap-guidelines 核证为真未完成(frontend spec 6 文件仍是 init 脚手架,30 处 To be filled,仅 20e4c54 一个提交),保持打开不归档。无代码改动,零 src/ 变更。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
