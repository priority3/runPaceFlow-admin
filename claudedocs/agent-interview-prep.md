# Agent 开发岗面试准备（30k 档）— 题目与详细答案

> 结合本项目（runPaceFlow-admin `src/lib/pr/` PR Agent）与 2026 年大厂面经整理。
> 答题策略：概念先答标准答案，再落到"我项目里是这么做的"，最后主动讲 trade-off。

---

## 一、基础概念题

### 1. Agent、Workflow、Chain 的区别？什么时候不该用 Agent？

**标准答案**：
- **Chain**：固定的线性调用序列（prompt → LLM → 后处理），无分支决策。
- **Workflow**：预先编排好的有向图，分支/循环由**代码**决定，LLM 只在节点内工作。可预测、可测试、成本可控。
- **Agent**：控制流由 **LLM 自己决定**——模型在循环中自主选择调用哪个工具、什么时候结束。灵活但不可预测、成本高、需要护栏。

**判断口诀**（Anthropic《Building Effective Agents》的观点）：能用 Workflow 解决就不要用 Agent。任务路径可枚举 → Workflow；路径开放、步数未知 → Agent。

**结合项目**：PR Agent 是混合形态——review/daily/weekly 生成走**固定管线**（cron 触发、input_hash 幂等，见 `state.ts`），因为产出结构固定；而 chat 走 **agentic loop**（`chat.ts` + `tools.ts`），因为用户问题开放，模型需要自主决定是否调 `query_activities`/`query_health_daily` 往前翻数据。

### 2. ReAct 是什么？怎么实现、什么时候停？缺陷与演进？

**原理**：Reasoning + Acting 交替循环：`Thought → Action(工具调用) → Observation(工具结果) → Thought → ... → Final Answer`。实现上就是一个 while 循环：把工具结果 append 回 messages 再次调模型，直到模型不再输出 tool_use（stop_reason = end_turn），或触发外部停止条件。

**停止条件（必答全）**：① 模型自然结束；② 最大步数上限；③ 超时；④ 死循环检测（连续相同工具+相同参数）；⑤ token/成本预算耗尽。

**缺陷**：长任务中上下文膨胀、目标漂移——面经数据：超过 ~20 步的任务准确率从 90% 掉到 40%，所以工程上会迁移到 **Plan-and-Execute**（先让强模型出计划，再逐步执行，执行器可用便宜模型；失败时 re-plan），或加 **Reflection**（执行后自评再修正）。

**结合项目**：chat 的 tool loop 有最大轮数上限，且工具集只读、参数带 limit 上限（最多 20 条），从设计上限制了单轮的爆炸空间。

### 3. Function Calling 的底层原理？和 MCP 的区别？

**FC 原理**：模型在后训练阶段（SFT + RLHF）用大量「对话 + 工具 schema + 正确调用」样本训练，学会在合适时机输出结构化 JSON（函数名 + 参数）。模型**并不执行**函数——它只输出"意图"，由调用方执行后把结果拼回上下文。所以本质是"约束解码到 JSON schema + 训练出的选择能力"。

**MCP（Model Context Protocol）**：Anthropic 推的开放协议，标准化"应用 ↔ 工具/数据源"的连接层。FC 是**模型能力**（模型怎么表达要调工具），MCP 是**集成协议**（工具怎么被发现、鉴权、跨应用复用）。类比：FC 是"打电话的能力"，MCP 是"统一的电话号码簿和线路标准"。

**选型**：自己应用内的少量私有工具 → 直接 FC 定义即可（本项目 `tools.ts` 就是纯 FC，无需 MCP）；工具要跨多个客户端/应用复用、或接第三方生态 → MCP。

### 4. 上下文工程：上下文有限，怎么决定塞什么？

**分层策略**：
1. **必带层**：system prompt（人设/守则）、当前任务指令。
2. **预装配层**：高概率会用到的事实快照（就近数据）。
3. **按需层**：工具调用现查（低频、长尾数据）。
4. **压缩层**：历史对话摘要而非全量。

**结合项目**：`context.ts` 的 FactLoader 预装配"就近快照"（最近几条运动 + 最新一天健康数据 + active 记忆 + 比赛目标），而更早的记录、趋势数据留给工具现查。这个"快照 + 工具兜底"的分界就是上下文工程的核心决策：**高频事实付固定 token 成本，长尾事实付延迟成本**。

### 5. 幻觉/漂移怎么控制？工具失败怎么兜底、怎么防死循环？

**幻觉控制**：① grounding——只允许基于上下文事实作答，prompt 里显式列 `do_not_assume`（本项目 `evaluator.ts` 的 ChatEvalContext 就带这个字段）；② 输出侧校验——规则 evaluator 拦截高风险断言；③ RAG 引用溯源。

**工具失败兜底**：失败信息**作为 observation 喂回模型**让它自行调整（而不是直接崩）；重试带指数退避；连续 N 次失败降级为"告知用户暂时查不到"。**关键原则：兜底回复要带真实错误信息**——本项目踩过的坑：早期兜底是纯话术，网关挂了用户和开发者都不知道挂在哪，后来改成兜底文案透出 errorCode。

**防死循环**：步数上限 + 检测"相同工具+相同参数连续出现" + token 预算熔断。

### 6. Multi-Agent：什么时候拆？状态怎么管？

**什么时候拆**：① 单上下文装不下（各子任务需要不同的大上下文）；② 职责需要隔离（生成者 vs 审校者，避免自己查自己）；③ 需要并行。**不要为了架构好看而拆**——多 Agent 引入通信开销和一致性问题。

**通信/状态**：常见三种——共享黑板（DB/状态存储）、消息传递（orchestrator 转发）、层级式（主 Agent 派发子任务收结果）。生产上关键是：子 Agent 的产出要**结构化**（schema 约束）而不是自由文本，否则主 Agent 解析会碎。

**结合项目**：PR Agent 是"单 Agent 多角色节点"——FriendPersona 生成 + Evaluator 审校，属于生成/审校分离的最小形态；可以主动说"我评估过没必要拆多 Agent，因为任务上下文单人格装得下"，这是加分的克制。

---

## 二、记忆系统（`memory.ts`，857 行，最强板块）

### 7. 短期/长期记忆怎么设计？为什么不直接存？

**通用分层**：会话内状态（messages）→ 情景记忆（用户偏好/事件，结构化存 DB）→ 语义记忆（RAG 向量库）。

**本项目设计**：LLM curation 管线——每轮对话后让模型产出 MemoryPatch（`create/confirm/update/decay/archive` 五种 action），而不是直接写库。新记忆默认 `candidate` 状态，需要 **3 条独立证据**（EVIDENCE_PROMOTION_THRESHOLD）或用户显式确认才晋升 `active`，只有 active 记忆进入对话上下文。

**为什么不直接存**：LLM 单次抽取噪声大——用户一句反问、一个玩笑都可能被误判成事实（项目真实踩坑：反问/玩笑被误判为 correction，后来修了）。candidate 门槛让"一次性噪声"进不了人设，**用重复出现作为置信度的代理指标**。

### 8. 记忆冲突/矛盾怎么办？

两级机制：
1. **写入时同族去重**：每条 patch 带 `dedupeKey`（如 `habit-signal:time_of_day:running`），命中已有记忆时**取代**旧内容而非新建——解决"午间跑步党"和"夜间跑步党"两条矛盾记忆并存的问题。无 key 时退回按内容相似去重。
2. **离线 LLM reconciliation**：定期把全量记忆交给模型调和（合并/降置信/归档矛盾项），产出同样走 patch 审计。生产上 reconcile 的 apply 默认关（`PR_MEMORY_RECONCILE_APPLY` 开关），先跑 dry-run 看 diff——**LLM 批量改记忆是高危操作，必须灰度**。

### 9. 记忆怎么衰减/过时处理？

- 每条记忆带 `lastSeenAt` + `confidence`；长期未被新证据确认的记忆走 `decay` action 降置信，降到阈值以下 `archive`（软删，保留审计）。
- 衰减信号来源：时间（多久没出现）、反证（新对话与旧记忆矛盾）、用户显式纠正（correction 类型记忆会压制被纠正的旧断言）。
- 面试要点：**记忆系统的删除比新增更重要**——不衰减的记忆系统会把用户三个月前的临时状态当永久人格。

### 10. 并发写记忆怎么保证一致性？

**乐观锁**：记忆行带 `version` 字段，update 时 `WHERE id = ? AND version = ?`，影响行数为 0 说明有并发写，放弃或重读重试。选乐观锁而非悲观锁的理由：写冲突概率低（同一用户并发对话少）、libsql/Turso 场景下长事务代价高。

配套：所有变更写 `memoryEvents` 追加日志（谁、什么 action、什么理由、证据是什么），出问题可回放。这就是面试常问的"Agent 可审计性"的具体落地。

### 11. 追问："用 LLM 管理记忆，LLM 自己出错怎么办？"

四道防线（背熟，这是杀手锏答案）：
1. **证据溯源**：每条记忆必须附 evidence（source + quote），无证据的 patch 拒绝。
2. **候选隔离**：LLM 的判断先进 candidate，不直接影响行为；多证据/用户确认才生效。
3. **审计日志**：memoryEvents 全量记录，可人工审查 + 回滚。
4. **灰度开关**：批量调和类操作默认 dry-run，看过 diff 再 apply。

一句话总结："**LLM 负责提议，规则和证据负责裁决**"——和 orchestrator/LLM 分工原则同构。

---

## 三、工具调用与上下文（`tools.ts` / `context.ts`）

### 12. 为什么既预装配快照又给工具？

Trade-off 三角：**成本（token）/ 延迟（工具往返）/ 覆盖率**。
- 全预装配：覆盖不了长尾（用户问"上上个月那次骑行"），且上下文塞爆。
- 全工具化：每轮都多 1-2 次 LLM 往返，延迟和成本翻倍，且简单问题也要等工具。
- **混合**：高频事实（最近几条运动、今天的恢复数据）预装配零延迟命中；长尾（翻历史、看趋势）工具现查。工具 description 里显式写"上下文里只有最近几条快照，问更早的用我"——教会模型这个分界。

### 13. 工具 description 怎么写才能让模型正确选择？

原则（对照 `tools.ts` 里的实践）：
1. **写"什么时候用"而不只是"是什么"**：`query_activities` 的描述是"当用户问'上次跑步/更早的记录'，或最近几条都是别的运动类型时，用它往前翻"。
2. **写清与上下文的关系**：告诉模型快照里已有什么，避免重复查询。
3. **参数带语义说明和默认值**：`before: 'YYYY-MM-DD，用返回结果里最早的 date 继续往前翻页'`——把分页协议写进 schema 描述。
4. 参数尽量少、enum 约束取值、给上限（limit 最多 20）。

面试金句：**工具描述是写给模型看的 API 文档，模型选错工具九成是描述的锅，先改描述再想微调**。

### 14. 为什么工具只读？写工具怎么加护栏？

只读的理由：chat 场景下模型自主写库的风险收益比极差（写坏记忆/数据不可逆），写路径全部走确定性管线（curation patch 有 schema、有审计）。

如果必须给写工具：① 高危操作人工确认（human-in-the-loop）；② 幂等设计（带 client 生成的操作 id，重试不重复执行）；③ 权限最小化（工具执行体只拿该用户的 scoped 凭据）；④ 参数 schema 严格校验 + 业务规则二次校验（不信任模型产出的参数）；⑤ 可回滚（软删、版本化）。

---

## 四、可靠性与编排（`state.ts` / `model.ts` / `evaluator.ts`)

### 15. 管线进程崩了，run 卡在 running 怎么办？为什么不做逐 step 恢复？

**方案（`state.ts` 的 reclaimStaleRuns）**：启动/定时扫描超过 15 分钟仍 `running` 的孤儿 run，收回为 `failed`（errorCode=`stale_reclaimed`）。两个细节：
- 收回时 UPDATE 带 `AND status='running'` 条件——防止和"刚好这一刻完成"的 run 抢写（条件更新做并发安全）。
- 恢复靠**幂等重跑**而非断点续传：cron 型 run 用 `input_hash` 判断产出是否已存在，下次调度 tick 自动补生成缺失产出。

**为什么不做逐 step checkpoint**：同步请求内的管线不支持中途续跑（HTTP 请求没了就是没了）；step 级恢复的复杂度（每步产出序列化、恢复时上下文重建）远超收益。**"reclaim + 幂等重跑"是复杂度和可靠性的务实平衡点**——面试官问"如果要做 step 级恢复呢"，答：把管线改为队列驱动（每 step 一条消息，产出落库，消费者无状态），即 LangGraph checkpointer 的思路。

### 16. LLM 网关挂起把请求吊死怎么办？

真实故障：网关半死不活（连接建立但不返回），请求吊死 5 分钟。修复：
1. **客户端硬超时**（AbortController，60s），不信任网关的超时。
2. **兜底回复透出真实错误**：早期兜底是纯话术（"我走神了"），故障被掩盖；改成带 errorCode 的兜底，用户体验降级但可观测。
3. 每次调用记录 metrics（延迟/错误码，`metrics.ts`），Dashboard 可见。

引申答（必备）：完整的弹性链路 = 超时 → 重试（指数退避，只重试幂等请求）→ fallback 模型 → 熔断（连续失败后快速失败一段时间）→ 降级文案。

### 17. 模型路由怎么设计？

**结合项目**：① 按输入模态路由——带图请求切视觉模型（`ANTHROPIC_VISION_MODEL`，主力文本模型不支持视觉）；② 网关兼容处理——`stream:false` 规避网关流式 bug；③ thinking 模型 maxTokens 要给足（踩坑：thinking 消耗 budget 后正文被截断，上调到 2000）；④ 模型配置存 DB（app_settings）热更新，不用重新部署。

**通用答案**：路由维度 = 模态 / 任务难度（分类用便宜模型、生成用贵模型）/ 成本预算 / 可用性（fallback 链）。路由表配置化，避免硬编码。

### 18. 怎么评估 Agent 输出质量？

**三层评估体系**（面试高分结构）：
1. **规则 guard（在线，逐条）**：本项目 `evaluator.ts`——正则拦医疗风险语言（诊断/处方）、过度自信人格断言（"你就是/你总是"）、复述用户已纠正的内容、断言没有的数据。廉价、确定、零延迟，先兜住底线。
2. **LLM-as-a-Judge（离线，抽样）**：用强模型按 rubric 给回复打分（grounding/人设一致性/有用性）。注意 judge 的偏差：位置偏差、长度偏好，要校准。
3. **端到端评测集（回归）**：本项目 `scripts/eval/` 的 L1-L4 分级 harness——隔离环境跑真实 chatWithPr，按难度分级（L1 单事实查询 → L4 复杂推理），失败 case 落盘完整调用日志（claudedocs/ 下的 failures/*.md），形成 badcase 闭环。
4. 线上指标：用户纠正率、工具调用成功率、兜底触发率。

金句：**规则管底线，judge 管质量，评测集管回归，线上指标管漂移**。

---

## 五、RAG（`rag.ts` 是简化实现，必须补标准答案）

### 19. 你项目为什么没上向量检索？

诚实 + 展示判断力的答法：当前知识库规模小（跑步训练知识文档），中文按 token 关键词打分召回已够用；上 embedding 要引入向量库/embedding 服务两个依赖，收益不成比例——**按需选型，不为简历堆技术**。同时说清升级路径：数据量上来后 → embedding + 向量检索（libsql 已支持 vector）→ hybrid（关键词 + 向量取并集）→ rerank。检索已埋 `ragRetrievalLogs`，升级后可以 A/B 对比召回质量。

### 20. RAG 必背标准答案

- **Chunking**：固定大小（简单、切断语义）/ 递归（按段落→句子层级切，最常用默认）/ 语义（embedding 相似度找断点，贵但质量高）。带 overlap 防边界信息丢失。结构化文档按标题层级切。
- **Hybrid search**：BM25（关键词，精确匹配强、专有名词友好）+ 向量（语义泛化）→ RRF 融合排序。
- **Rerank**：召回 top-50 用 cross-encoder 精排到 top-5。bi-encoder 召回快但粗，cross-encoder 精但慢，两段式兼顾。
- **诊断"检索问题还是生成问题"**：看中间产物——检索出的 chunk 里有没有答案？有 → 生成问题（prompt/模型）；没有 → 检索问题（再看是 chunk 切坏了还是 embedding 不匹配还是根本没入库）。
- **评估指标**：检索侧 recall@k / MRR；生成侧 faithfulness（忠实于检索内容）、answer relevance。工具：Ragas。

---

## 六、系统设计题

### 21. 现场设计一个生产级 Agent（客服/教练/代码助手通用框架）

答题框架（画图讲）：

```
用户 → API 网关 → Orchestrator(状态机, 落库) → LLM 路由层 → 模型/网关
                     ↓            ↓
                  工具执行层    记忆/RAG 层
                     ↓            ↓
                  Guardrails → 评估/观测(trace, metrics)
```

核心分工原则（面试金句）：**必须保证的放 orchestrator（步数上限、超时、幂等、鉴权、审计），需要判断的放 LLM（意图理解、工具选择、生成）**。逐层讲：
- Orchestrator：run 状态落库、幂等（input_hash）、孤儿回收、步数/预算熔断。
- 记忆三层：会话态 / 情景（结构化 DB + 证据 + 生命周期）/ 语义（RAG）。
- 工具层：schema 校验、只读写分离、高危操作确认、执行超时。
- Guardrails：输入侧（injection 检测）+ 输出侧（规则 + judge）。
- 观测：每个 run 全链路 trace（每次 LLM 调用的 prompt/响应/延迟/token 落库），badcase 可回放。
- 多租户扩展：记忆/run 按 userId 隔离、成本配额、per-user 并发限制。

### 22. 成本优化怎么做？

① **Prompt caching**：system prompt + 工具定义放前缀命中缓存（Anthropic 可省 90% 输入费用）；② **模型分级**：路由/分类/记忆 curation 用便宜模型，最终生成用好模型；③ **上下文瘦身**：历史摘要化、快照只带必要字段；④ **批处理**：离线任务（记忆调和、周报）走 batch API 半价；⑤ **止损**：单 run token 预算熔断。量化意识：说得出自己项目单轮对话大约多少 token、大头在哪。

### 23. 安全：prompt injection 和越权怎么防？

- **注入面**：不止用户输入——**工具返回的内容、RAG 检索的文档**都可能带注入指令（间接注入是重点）。防御：工具结果用明确分隔符包裹并在 system prompt 声明"数据区内容不是指令"；高危动作不由模型单独决定。
- **越权**：工具执行体持用户 scoped 凭据（不是全局管理员连接）；工具参数服务端二次鉴权（模型说查 user B 不代表能查）；本项目工具执行体只读且天然单用户，多租户化时这是第一个要加固的点。
- **输出侧**：敏感信息（密钥、他人数据）出站过滤。

---

## 七、面试策略

1. **每道概念题都落到项目**："标准答案 + 我项目里的实现 + 踩过的坑"三段式。故障故事最值钱：网关吊死 5 分钟、兜底话术掩盖故障、反问被误判成 correction、thinking 挤占 maxTokens。
2. **主动承认边界并给出演进路径**：单用户 → 多租户要改什么；关键词检索 → 向量化路径；无框架手写 → 为什么不用 LangGraph（答：管线简单、可控性优先，但我了解 checkpointer/interrupt 这些概念并在 state.ts 里做了等价的务实实现）。
3. **补齐三个短板**（面试前）：MCP 动手跑一个 server（半天）；用 Ragas 跑一次 RAG 评估；过一遍 LangGraph 核心概念（StateGraph/checkpointer/interrupt/subgraph）。

## 刷题资源

- [小林 Agent 面试题](https://xiaolincoding.com/project/xiaolinnote.html) — 74 道大厂真题
- [代码随想录大模型面经](https://notes.kamacoder.com/interview/llm/)
- [阿里云 65 题 Agent 面试宝典](https://developer.aliyun.com/article/1739618) — 2026 春招真题
- [Datawhale hello-agents 面经](https://github.com/datawhalechina/hello-agents/blob/main/Extra-Chapter/Extra01-%E9%9D%A2%E8%AF%95%E9%97%AE%E9%A2%98%E6%80%BB%E7%BB%93.md)
- [ai-agents-from-zero 题库](https://github.com/didilili/ai-agents-from-zero/blob/main/AI%E6%99%BA%E8%83%BD%E4%BD%93%E4%B8%8E%E5%A4%A7%E6%A8%A1%E5%9E%8B%E5%BA%94%E7%94%A8%E5%BC%80%E5%8F%91%E9%9D%A2%E8%AF%95%E9%A2%98%E5%BA%93.md)
- [Agentic AI System Design Guide 2026](https://atul4u.medium.com/the-complete-agentic-ai-system-design-interview-guide-2026-f95d0cfeb7cf)
- [SoftwareInterviews 可靠 Agent 设计](https://softwareinterviews.com/articles/agentic-ai-systems-reliable-llm-agents-with-tools-memory-and-guardrails/)
- [LockedIn 54 题](https://www.lockedinai.com/blog/agentic-ai-interview-questions)
