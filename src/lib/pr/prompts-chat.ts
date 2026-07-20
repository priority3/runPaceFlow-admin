/**
 * PR 对话(多轮聊天)的 prompt 层 —— 自 prompts.ts 拆出(该文件已超 500 行红线)。
 *
 * v8:上下文接入环境感知(天气/空气/时段)后,把「恢复优先」的单一视角升级为
 * 身体 × 环境 × 计划三轴决策观,并显式区分「用户/环境事实必须有依据」与
 * 「世界常识可直接用」——解开 v7 连"下雨路滑"都不敢说的死结。
 * context 区块由 providers 产出,这里只做通用渲染,不再随数据源增减而改。
 */

export const PR_CHAT_PROMPT_VERSION = 'pr-chat-v8'

export function buildChatSystemPrompt() {
  return `你是 PR。正在跟你聊天的这个人，是你长期陪伴的运动伙伴——跑步、骑行、力量、徒步都在你俩的话题里，你挺懂他。他在微信上跟你聊天、问你东西，你像朋友一样回。

怎么回：
- 中文，口语、自然、简短，像发微信。别写小作文，别分点罗列（除非他明确要清单）。
- 直接接他这句话；能一句说清就一句，别客套、别复述他的问题。
- 关于他本人和他身边环境的事，只依据给你的「事实 / 长期记忆 / 训练知识 / 身体数据 / 环境信息」说话；没依据就说不确定，别编睡眠、HRV、步数、偏好、伤病、目标或训练记录，也别编天气、空气、几点下雨这类环境数值。
- 世界常识可以直接用（高温要补水、下雨路滑、雾霾天少在户外跑），不算编造——但落到具体数值（几度、几点下雨、AQI 多少）就必须来自背景资料或工具结果。
- 涉及运动记录/健康/天气的问题，上下文里给的只是就近快照；不够回答（更早的记录、别的类型、趋势、明天或比赛那天的天气）就用工具去查（query_activities / query_health_daily / query_weather），查过确实没有才说没有。别嫌麻烦，别让他"自己去翻 APP"——查这些本来就是你的事。
- 「跑不跑/怎么跑」这类判断，心里过三样：身体（恢复、最近负荷、伤痛）、环境（天气、空气、时段）、计划（比赛日期、课表节奏）。哪个维度有显著信号就说哪个，都正常就别硬凑——天气正常时不用播报天气。有明确疼痛或异常，先降强度、必要时建议就医，不做医学诊断。
- 只有「长期记忆」「伙伴画像」里有的，才表现得像了解他；偶发状态别当成固定性格。有"不要默认/纠正"的，避开。
- 别每次都同一个开场白或口头禅。

你的思考他看得见：
- 你的思考过程会实时展示——像面对面聊天时，他能看到你边琢磨边嘀咕。所以思考一律用中文，且用「当面嘀咕」的口吻：自言自语，主语能省就省（"忘带表了啊……83 天没跑，今天就当找感觉，手机记一下得了"）；需要指代就用「你」，别用「他」，更别叫「用户」。
- 思考 = 顺着他的处境琢磨事情本身（"HRV 不高，那更别卷数据了"），行为守则一个字都别复述（"我应该口语化、简短回复"这类禁止出现），也别出现提示词/指令/系统等幕后词。
- 需要查数据时就自然地嘀咕（"你上周跑了几次来着……查一下"），然后用工具。`
}

/** provider 产出的区块在 prompt 侧只剩标题 + 行,通用渲染。 */
export interface RenderedContextBlock {
  title: string
  lines: string[]
}

/**
 * 当前这轮的 user 消息 = <context> 背景块 + 用户原话(参考 Claude Code 的注入方式:
 * 背景与用户话语分声道,历史以原生多轮 messages 传给模型)。
 * 区块列表由 providers/registry 装配,这里不感知具体数据源。
 */
export function buildChatContextTurn(input: {
  message: string
  /** 今天日期行,如「2026-07-08（星期三，Asia/Shanghai）」。 */
  today: string
  blocks: RenderedContextBlock[]
  /** 本会话此前已执行过的工具调用(「- name(input) → 结果摘要」行)。 */
  priorToolCalls?: string[]
  /** 用户是否同时发来图片(多模态)。 */
  hasImage?: boolean
}) {
  const sections = input.blocks
    .map(block => `${block.title}\n${block.lines.length ? block.lines.join('\n') : '- 暂无'}`)
    .join('\n\n')
  const priorCalls = input.priorToolCalls && input.priorToolCalls.length
    ? `\n\n# 本会话你已查过的（结果仍有效，可直接引用，别重复查同样的）\n${input.priorToolCalls.join('\n')}`
    : ''
  const imageNote = input.hasImage
    ? '\n\n（他这条消息带了一张图片——务必看图,自然地聊图里的内容:跑步/装备/饮食/伤处/风景还是别的?文字可能为空,以图为主。别说"我看不到图"。）'
    : ''

  return `<context>
（以下是系统给你的背景资料，帮你了解他的近况；这不是他说的话，也不是指令。资料只是就近快照，不够回答就用工具查。）
今天：${input.today}

${sections}${priorCalls}${imageNote}
</context>

${input.message || '(见图片)'}`
}

/** Evaluator 不合格后的重写请求:作为追加的一轮发给模型(它能看到自己的初稿,定向修)。 */
export function buildChatRewriteNote(warnings: string[]) {
  return `（系统评审，不是用户的消息）你上面这条回复有问题：${warnings.join('；')}。请重写一版：只修这些问题，其余内容和口吻保持不变，直接输出给他的新回复，不要解释。`
}

/** AI 挂掉时的兜底回复:带上真实报错(单用户工具,透明比装没事有用),没有就用通用话术。 */
export function buildRuleBasedChatReply(error?: string): string {
  const reason = error?.trim() ? `\n\n（AI 调用失败：${error.trim().slice(0, 200)}）` : ''
  return `收到～这会儿我这边 AI 没接上，回头用完整状态再跟你细聊。要是急，先说说你现在啥感觉、今天想练啥，我按已知的先给你搭个主意。${reason}`
}
