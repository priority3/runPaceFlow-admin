# PRD:PR 知识库 RAG 混合检索改造

## 背景与问题

当前 `retrieveKnowledge`(src/lib/pr/rag.ts)是纯词法占位实现,对运动/训练类中文查询效果差:

1. **分词无效**:按非字母数字切分,中文整句成一个 token,靠 `includes` 子串兜底;
2. **打分朴素**:token 命中 +1,无词频/文档长度归一(非 BM25);
3. **召回受限**:只扫「最近 200 个 chunk」,知识库变大后旧文档永久失联;
4. **无语义能力**:「膝盖疼」查不到「膝关节损伤防护」;
5. `knowledge_embeddings` 表已建但闲置。

消费方两处(共享同一 `retrieveKnowledge`):跑后点评 `buildPrContext`(活动信号拼 query)、PR 聊天 `knowledgeProvider`(用户消息原文做 query)。

## 目标

- 中文运动语义查询召回质量显著提升(近义/同义改写能命中)。
- 词法层零外部依赖,任何环境(评测隔离库、无 embedding 凭据部署)可用。
- 配置 embedding 凭据后自动升级为混合检索,不改任何消费方代码。

## 方案决策(已与用户确认)

- **混合检索**:中文 2-gram + BM25 作为基线;配置了 embedding 凭据时叠加向量召回,RRF 融合。
- **embedding 凭据**:用户自行申请 OpenAI 兼容服务(SiliconFlow bge-m3 或同类);本任务把 settings 键、表写入、降级逻辑全部就位,拿到 key 填 admin 配置即启用。

## 范围

**做:**
- 重写 `retrieveKnowledge` 检索管线(词法 BM25 + 可选向量 + RRF);去掉 200 条上限。
- 新增 embedding 客户端模块 + settings 键(沿用 OPENAI_* 注册模式)。
- ingest 时自动生成 embedding(失败不阻塞入库);存量 chunk 回填脚本。
- `rag_retrieval_logs` 记录检索模式(lexical/hybrid)与双路分数。
- 评测:seed 补充近义改写知识文档,新增检索命中用例;无凭据评测必须全部走词法且可通过。

**不做(后续可选):**
- rerank 模型、query 改写(LLM);
- 知识管理 UI;
- chunk 策略大改(保留现有段落切分);
- libsql F32_BLOB 原生向量索引(量级小,JSON 向量 + 应用层余弦足够)。

## 验收标准

1. 中文近义查询命中:评测新增用例(如「跑完膝盖有点疼」→ 命中「膝关节损伤防护」文档)通过;
2. 无 embedding 配置时:行为为纯词法 BM25,评测全绿,日志 mode=lexical;
3. 配置 embedding 后:ingest 自动写 `knowledge_embeddings`;检索日志 mode=hybrid 且含双路分数;embedding API 失败/超时自动降级词法,不抛错;
4. 全库检索:超过 200 chunks 的旧文档可被召回;
5. `retrieveKnowledge` 签名与 `KnowledgeContext` 返回结构不变,`providers/knowledge.ts`、`context.ts` 零改动;
6. lint + tsc 通过;单文件不超 500 行。
