# 执行计划:PR 知识库 RAG 混合检索

前置阅读顺序:prd.md → design.md → src/lib/pr/rag.ts → src/lib/pr/model.ts(settings/OpenAI 客户端模式)→ src/lib/settings.ts:160-200(键注册模式)。

## 步骤清单(按序)

### 1. settings 键 + embeddings 客户端
- [ ] `src/lib/settings.ts`:注册 `PR_EMBEDDING_API_KEY` / `PR_EMBEDDING_BASE_URL` / `PR_EMBEDDING_MODEL`(照抄 OPENAI_API_KEY 组的结构与描述风格,secret 标记对齐 OPENAI_API_KEY)。
- [ ] 新建 `src/lib/pr/embeddings.ts`:`isEmbeddingConfigured()`、`embedTexts(texts: string[]): Promise<number[][]>`(批 ≤32、timeout 4000、maxRetries 0)、`cosineSimilarity(a, b)`。复用 `openai` 包与 `getRuntimeSettings()`。
- 验证:`bun run type-check`。

### 2. 词法层重写
- [ ] 新建 `src/lib/pr/rag-lexical.ts`:`tokenizeMixed`(CJK 2-gram + 拉丁词,语料侧带词频/查询侧去重)、BM25 索引构建与打分、`count:maxCreatedAt` 缓存。
- [ ] `rag.ts`:检索改为全量加载 chunks(删 200 limit)→ 词法 top-20。
- 验证:`bun run type-check && bun run lint`;手工用隔离库 seed 后调 `retrieveKnowledge` 冒烟(中文短语查询能命中且排序合理)。

### 3. 向量路 + RRF + 日志
- [ ] `rag.ts`:embedding 配置时并行走向量路(按 model 过滤向量行、余弦 top-20),RRF(k=60)融合;失败降级词法。
- [ ] 日志:queryPlanJson 增 mode/embeddingModel/双路候选数;scoresJson 记 {id, lexical, vector, rrf}。
- 验证:无凭据路径 mode=lexical 日志正确;type-check + lint。

### 4. 写入侧
- [ ] `ingestKnowledgeDocument`:落库后 best-effort 生成向量(失败 warn 不阻塞),返回值加 `embedded`。
- [ ] 新建 `scripts/backfill-knowledge-embeddings.ts`(幂等:跳过当前模型已有向量的 chunk;结束打印统计)。
- 验证:无凭据时 ingest 行为与现状一致(仅多一个 embedded:0)。

### 5. 评测联动
- [ ] `scripts/eval/seed.ts`:KNOWLEDGE_DOCS 增补 2–3 篇口语+术语双表述文档(膝关节损伤防护/乳酸阈与心率/长距离补给)。
- [ ] 用例:词法档知识命中用例(无凭据必须过);语义档标 `requiresEmbedding`,无 `PR_EMBEDDING_API_KEY` 自动 skip 且报告标注(run.ts/report.ts 相应小改)。
- 验证:`bun run type-check && bun run lint`;有模型凭据时跑一轮 eval 确认词法档绿、语义档 skip。

### 6. 收尾
- [ ] 全量 `bun run lint && bun run type-check`。
- [ ] 检查各文件 <500 行(rag.ts 拆分后应远低于)。
- [ ] 若拿到 SiliconFlow key:配置 → 回填 → 手工冒烟 hybrid 模式(日志 mode=hybrid、语义查询命中),否则在总结中明确标注「向量路未实测,凭据到位后按 README 步骤启用」。

## 回滚点

- 每步一个 commit;任一步出问题 revert 该步即可。
- 步骤 2 是行为变更核心(检索结果会变);若线上点评/聊天出现知识命中异常,优先回滚步骤 2/3 的 commit。

## review gate

- 步骤 3 完成后(检索管线成型)自查一次 design 对齐;步骤 5 完成后跑 trellis-check 全量核查。
