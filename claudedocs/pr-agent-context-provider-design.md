# PR Agent 上下文装配的可扩展架构(设计,不含实现)

> 2026-07-20 · 回应的问题:「后续每加一个功能,都要这样不停往 build_context 里手工构造上下文吗?会不会太麻烦?」
> 配套文档:`pr-agent-environment-context-design.md`(环境感知改造,建议作为本架构的第一个落地试点)

## 一、直接回答

**不用,也不该。** 但解法不是"少注入上下文",而是三件事:

1. **先分流**:很多"新信息"根本不需要新管道——系统里已经有三个**通用容器**(长期记忆 / 知识库 RAG / life_events),大量未来需求应该落进它们,零代码。
2. **要新管道的,把"加一路"从改三处核心代码变成"注册一个 Provider"**:一次性把装配处收敛成注册表,之后每个新能力只是一个自包含的新文件。
3. **push(快照)和 pull(工具)有明确的分派规则**,长尾能力优先做成工具——加工具本来就不用动装配和模板。

## 二、先问是不是:新需求的分流规则

来一个新功能需求,按顺序过这张表,**大多数停在前三行,不产生任何管道代码**:

| 问题 | 归宿 | 成本 |
|---|---|---|
| 是关于用户的持久事实?(偏好/习惯/伤病/目标) | 长期记忆(MemoryCurator 已自动蒸馏入库) | 零代码 |
| 是领域知识/文档?(训练方法、装备知识) | 知识库 RAG(加文档即可) | 零代码 |
| 是偶发的生活事件?(照片、随手记) | life_events(已有表和入口) | 零代码 |
| 是结构化实时数据,**几乎每轮相关、值得主动提起**?(健康、环境) | **push:Context Provider 快照** | 一个新文件 |
| 是**长尾、按需、量大**的查询?(更早记录、跨天预报) | **pull:只读工具** | 一个新文件 |
| 又要主动感知、又要深查? | Provider + 工具**双出口**(健康/活动/环境都是这个形态) | 一个新文件 |

push/pull 的判断标准就一条:**这个信号需要 PR 在用户没问时主动说出来吗?**
- 需要(「今天有雨想跑赶早」)→ 必须 push,不能赌模型想起来调工具;
- 不需要(「去年 3 月跑了多少」)→ pull,别占每轮 token。

## 三、为什么不干脆全走工具(纯 agentic pull)

看起来最省事——加能力只加工具,装配层永远不动。但对这个产品不成立:

1. **伙伴产品靠主动性**。快照在眼前,模型才会顺嘴带出"AQI 爆表别外跑";全靠 pull,等于把"想不想得起来查"押在模型身上。
2. **现网关模型不可靠**:eval 里模型只调了 `query_health_daily` 一个工具就收工(见 l2-run-today);mimo 是 thinking 模型,每多一轮工具往返多一次 thinking 开销,p50 5.9s 会明显恶化。
3. 本仓自己的哲学已经是折中态:「快照只是就近快照,不够就用工具查」——问题只在快照装配处不可扩展,不在 push 本身。

## 四、核心设计:ContextProvider 注册表

### 4.1 接口(示意)

```ts
// src/lib/pr/providers/types.ts
export interface ChatContextInput {
  message: string
  threadId: string
  today: string      // 「2026-07-20(星期一,Asia/Shanghai)」
  hasImage: boolean
}

export interface ContextBlock {
  key: string            // 'environment'
  title: string          // '# 现在的环境(实况与预报)'
  lines: string[]        // 渲染行;空数组 = 整块省略
  priority: number       // 渲染顺序(小在前)
  forSnapshot?: unknown  // 写入 build_context 快照的观测摘要(替代现在手拼的字段)
}

export interface ContextProvider {
  key: string
  /** 省略 = 每轮装配;给出 = 启发式命中才装配(如关键词) */
  relevant?: (input: ChatContextInput) => boolean
  load: (input: ChatContextInput) => Promise<ContextBlock | null>
  /** 该能力自带的深查工具,自动并入 PR_CHAT_TOOLS */
  tools?: PrChatToolSpec[]
  executeTool?: (name: string, input: unknown) => Promise<string>
  /** 软预算:超长截断保护 */
  maxChars?: number
}
```

### 4.2 装配处收敛后的样子

```ts
// chat.ts build_context 从「8 路手写 Promise.all + 手拼行」变成:
const blocks = (
  await Promise.all(
    PROVIDERS.filter(p => p.relevant?.(input) ?? true).map(p =>
      withTimeout(p.load(input), 5000).catch(err => {
        logDiscarded(p.key, err)   // 统一接管现有 discardedContext 语义
        return null
      }),
    ),
  )
).filter(Boolean).sort((a, b) => a.priority - b.priority)
```

- `buildChatContextTurn` 参数从 8 个具名字段变成 `blocks: ContextBlock[]`,模板做通用渲染;system prompt 不再随数据源增减而改。
- `PR_CHAT_TOOLS = PROVIDERS.flatMap(p => p.tools ?? [])`,dispatcher 按 name 路由到对应 provider 的 `executeTool` —— tools.ts 不再是第二个要手改的清单。
- **不属于 provider 的保持原样**:`today` 日期行、priorToolCalls、imageNote 是编排层的固定头尾,不塞进注册表硬凑通用性。
- evaluator 的 `evalCtx`(hasHealth / doNotAssume 等)从 blocks 按 key 读取,耦合点集中且显式。

### 4.3 加一个新能力的成本对比

| | 现状 | 注册表后 |
|---|---|---|
| 新增快照数据源 | 改 chat.ts(装配+快照字段)+ prompts.ts(模板)+ 可能改 system prompt | **新建 1 个 provider 文件 + 注册表加 1 行** |
| 新增工具 | 改 tools.ts 两处(spec + dispatcher) | 写在同一个 provider 文件里 |
| 快照+工具双出口 | 3~4 个文件 | 仍是 1 个文件(如 `providers/environment.ts`) |
| 失败降级/超时/记录 | 每处手写 `.catch(() => [])` | 注册表统一处理,provider 只管 load |

顺带修掉一个既有违规:chat.ts 现在 596 行,已超你自己定的 500 行红线;把装配逻辑抽出去正好拆回去。

### 4.4 迁移与试点

- 存量 8 路 loader 每个 20–40 行,机械迁移成 `providers/*.ts`(memory / profile / knowledge / health / activities / goals…),一次 PR 可完成;`listRelevantContextMemories(message, 6)` 说明"按 query 相关性装配"的形态已存在,`relevant`/`load(input)` 正是它的泛化。
- **建议环境快照(P0)作为第一个 provider 通过新缝落地**:反正要动 build_context,一次改造两得;存量迁移可同 PR 或紧随其后。
- daily / activity review / diary 各有自己的手拼 context,**本期不动**;它们复用 provider 是后续可选项(按 surface 选子集),别一次铺开。

## 五、明确不做的(防过度设计)

- **不做**动态发现、配置驱动加载、DI 框架——注册表就是一个文件里的普通数组。
- **不做**意图分类器做 relevance 路由——`relevant` 先全部省略(始终装配),等 token 压力真出现再按 provider 加关键词启发式。
- **不做**每 provider 独立 LLM 预处理。
- MCP 一句话:未来若外部能力显著变多(日历/地图/音乐),工具这一侧就是 MCP 接入的天然缝,本架构不挡路,也不提前建。

## 六、代价与权衡(诚实版)

- **间接层成本**:排查"某块为什么没出现"要多看一层 filter/timeout;用统一的 per-provider 结果日志(继承 discardedContext 进 snapshot)对冲,可观测性反而比现在的散落 `.catch(() => [])` 好。
- **抽象时机**:8 路、单人项目,纯看当下做注册表偏早;但你已明确"后续会持续加功能",且环境改造本来就要动装配处——边际成本最低的时机就是现在。若后续两年只加环境这一路,这层抽象就是白付的 ~1 天;按你的路线图判断,不像。
- **模板通用化的表达力损失**:具名参数变 blocks 后,模板不能再针对单块写特殊措辞;需要特殊措辞的内容放进 block 自己的 lines 里生成,责任下沉到 provider,是可接受的置换。
