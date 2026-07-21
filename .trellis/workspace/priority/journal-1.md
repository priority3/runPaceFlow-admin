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
