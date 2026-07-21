# 技术设计:PR 知识库 RAG 混合检索

## 总体架构

```
retrieveKnowledge(query, limit)          ← 签名不变,消费方零改动
  ├─ 词法路:tokenize(2-gram) → BM25 → top-20     ← 永远执行,零依赖
  ├─ 向量路:embedQuery → cosine(库内向量) → top-20 ← 仅当 embedding 已配置;失败/超时静默降级
  └─ RRF 融合(k=60) → top-limit → 写 rag_retrieval_logs(mode + 双路分数)
```

模块拆分(遵守 <500 行/文件):

| 文件 | 职责 |
|---|---|
| `src/lib/pr/rag.ts`(改) | 公共入口:`ingestKnowledgeDocument` / `retrieveKnowledge`、RRF 融合、检索日志 |
| `src/lib/pr/rag-lexical.ts`(新) | 分词(CJK 2-gram + 拉丁词)、BM25 索引与打分、语料缓存 |
| `src/lib/pr/embeddings.ts`(新) | OpenAI 兼容 embeddings 客户端(settings 驱动、批量、超时)、余弦相似度 |
| `scripts/backfill-knowledge-embeddings.ts`(新) | 存量 chunk 向量回填(幂等) |

## 1. 分词与词法检索(rag-lexical.ts)

**tokenize(text)**:按字符类别切 run——
- 拉丁/数字 run → lowercase 整词(≥2 字符),行为与现状对齐;
- CJK run → 字符 2-gram(run 长度为 1 时保留单字)。
- 语料侧保留重复(BM25 需要词频 tf);查询侧去重。

**BM25**:k1=1.2,b=0.75,idf = ln(1 + (N−df+0.5)/(df+0.5))。

**语料缓存**:全量加载 knowledge_chunks(去掉现在的 200 条上限)后构建倒排索引,模块级缓存;缓存键 = `count:maxCreatedAt:maxChunkId`(任一变化即重建;掺 maxChunkId 是因为前两者是秒级/数量级的,同秒等量重灌或同进程切库时可能不变,id 由 generateId 生成必变)。知识库为管理端手工灌入,量级预期 ≤ 数千 chunk,整库重建为毫秒级,不做增量。

**结果**:BM25 分 >0 的 top-20 候选。

## 2. 向量路(embeddings.ts)

**settings 新键**(注册进 `src/lib/settings.ts`,模式照抄 OPENAI_API_KEY 组,settings.ts:170 起):

| 键 | 说明 |
|---|---|
| `PR_EMBEDDING_API_KEY` | 必填才启用向量路 |
| `PR_EMBEDDING_BASE_URL` | OpenAI 兼容端点(如 SiliconFlow `https://api.siliconflow.cn/v1`);空 = 官方 OpenAI |
| `PR_EMBEDDING_MODEL` | 必填才启用(如 `BAAI/bge-m3`) |

- 读取沿用 `getRuntimeSettings()`(与 model.ts:172 相同路径,admin 远程配置可覆盖);实现为 `getEmbeddingConfig(): Promise<EmbeddingConfig | null>`(null = 未启用,替代原设计的 isEmbeddingConfigured,省一次重复读取);配置值 trim(model 精确匹配库内向量行,尾随空白等效换模型)。
- 客户端复用已有 `openai` 依赖:`client.embeddings.create({ model, input, encoding_format: 'float' })`(显式 float——部分兼容网关不认 SDK 默认的 base64,会被解成空向量),批量 ≤32 条/次,SDK `timeout: 3000, maxRetries: 0`(检索在线链路挂在 knowledgeProvider 的 5s 总预算内,3s 封顶给词法结果与查库留余量,宁可降级不可拖慢)。
- `embedTexts(texts, config?)`:已持有配置的调用方(检索/ingest/回填)必须传入 config,消除两次 settings 读取之间改模型导致的跨模型比对/向量错标竞态。

**存储**:沿用现有 `knowledge_embeddings` 表(chunkId/provider/model/vectorJson),vectorJson 存 `number[]` JSON。**零 schema 迁移**(表已由 ensureActivitiesSchema 建好)。provider 固定 `openai-compatible`。

**查询路径**:embedQuery(query) → 加载 `model = 当前配置模型` 的全部向量行 → 应用层余弦(维度不等记 0 分,脏数据无害化)→ 阈值 `VECTOR_MIN_COSINE = 0.35` 过滤(bge 系标定;低于此基本是噪声,不滤会让任意查询捞回弱相关 top-20 污染融合。官方 OpenAI text-embedding-3 系分布偏低,换该系需按 scoresJson 实测重校)→ top-20。
- 按 model 过滤:换 embedding 模型后旧向量自动失效(不混维度),重跑回填即可。
- 无向量行 / API 失败 / 超时 → 返回空,由入口降级为纯词法,仅 console.warn。
- Reason:知识库量级小,应用层余弦(全量 O(N·d))在数千向量内 <10ms,不值得引入 F32_BLOB 原生索引的迁移成本。

## 3. 融合与日志(rag.ts)

- **RRF**:fused(c) = Σ_path 1/(60 + rank_path(c));词法 top-20 ∪ 向量 top-20 → 按 fused 排序取 `limit`。
- 返回的 `KnowledgeContext.score` = fused 分(向量未启用时 = 词法路 RRF 分,单调性与 BM25 一致;消费方现不读 score,仅日志用)。
- **日志**(列不变,内容增强):
  - `queryPlanJson`:`{ mode: 'lexical'|'hybrid', queryTokens, embeddingModel?, rrfK: 60, limit, lexicalCandidates, vectorCandidates }`
  - `scoresJson`:`[{ id, lexical?, vector?, rrf }]`(入选条目的双路原始分 + 融合分)

## 4. 写入侧

- **ingest**(`ingestKnowledgeDocument`):chunk 落库后,若 embedding 已配置 → 批量生成并写 `knowledge_embeddings`;**任何失败只 warn,不阻塞入库**(词法路始终可用)。返回值增加 `embedded` 计数(向后兼容,调用方 route.ts 原样透传即可)。
- **回填**(`scripts/backfill-knowledge-embeddings.ts`):查当前配置模型下缺向量的 chunk → 批量 embed → 插入;幂等(已有该模型向量的 chunk 跳过)。`bun run scripts/backfill-knowledge-embeddings.ts`,连接走与应用一致的 ACTIVITIES_DATABASE_URL 解析。退出码:0=全部成功,1=未配置 embedding,2=有批次失败(重跑续传)——自动化调用凭非零码感知回填未完成。

## 5. 评测联动(scripts/eval)

- seed.ts 的 KNOWLEDGE_DOCS 增补 2–3 篇运动知识文档,内容刻意包含口语+术语双表述(如「膝关节损伤防护」文档正文含「膝盖不舒服/膝盖疼」表述)。
- **hybrid 判定**:mode 看「向量路实际参与」(配置在且查询 embedding 成功)——阈值筛到 0 条也是 hybrid;降级/未配置/库内无当前模型向量行(此时干脆跳过查询向量化,省一次 API 调用)才是 lexical。queryPlanJson 在「配置了但降级」时仍带 embeddingModel,供日志区分未配置 vs 降级。
- 新增知识检索用例分两档:
  - **词法档**(无凭据必须过):近义但有共享 2-gram 的查询(靠 BM25 排序正确性);
  - **语义档**(标记 `requiresEmbedding`,skip 判定与应用层同源同强度——`getEmbeddingConfig()` 为 null 时自动 skip 并在报告中标注):纯语义改写(零字面重叠)。
- Reason:评测隔离环境默认无 embedding 凭据,语义档若不 gate 会把评测搞成永久红。

## 6. 降级矩阵

| 场景 | 行为 |
|---|---|
| 未配置 embedding | 纯词法 BM25,mode=lexical |
| embedding API 失败/超时(4s) | 本次降级词法,warn,不影响响应 |
| 库内无向量(未回填) | 向量路空结果,等效词法 |
| 换 embedding 模型 | 旧向量按 model 过滤自动失效,重跑回填恢复 |

## 7. 风险与权衡

- **2-gram 索引体积**:中文 2-gram token 数 ≈ 字符数,数千 chunk 的倒排在内存中 <10MB,可接受;
- **eval.db 与生产共用代码路径**:隔离由 ACTIVITIES_DATABASE_URL 保证,本改造不新增 env;
- **在线延迟**:聊天链路向量路最多 +1 次 embedding API 调用(4s 超时上限,正常 <300ms);跑后点评为离线任务不敏感;
- **回滚**:单 commit revert 即可;新 settings 键闲置无副作用;knowledge_embeddings 为增量数据,残留无害。
