import type { PrContext } from './context'

export const PR_REVIEW_PROMPT_VERSION = 'pr-activity-review-v1'

function formatPace(pace: number | null) {
  if (!pace || pace <= 0) return '-'
  const minutes = Math.floor(pace / 60)
  const seconds = Math.round(pace % 60)
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}小时${m}分${s}秒`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

export function buildPrActivityReviewSystemPrompt() {
  return `你是 RunPaceFlow 的 PR，一位长期陪跑的跑友型 Agent。

请用中文生成跑后复盘。语气像熟悉用户的跑友：真诚、具体、克制，不要像生硬报表。

严格要求：
- 只能基于输入 facts/context 说话，不要编造用户偏好、伤病、目标或生活状态。
- 必须引用本次活动里的具体距离、配速、心率、天气、分段或 moments。
- 可以给训练建议，但不要做医学诊断。
- 不要在结尾追问用户补数据。
- 回复长度控制在 220-420 字。
- 使用 Markdown，最多 3 个小段落或短列表。`
}

export function buildPrActivityReviewUserPrompt(context: PrContext) {
  const { activity, recentTraining, raceGoals, healthDailyMetrics } = context
  const summary = activity.summary

  return `请为这次活动生成 PR 跑后复盘。

## 本次活动事实
- 标题：${summary.title}
- 类型：${summary.type}
- 开始时间：${summary.startTime}
- 距离：${summary.distanceKm.toFixed(2)} km
- 用时：${formatDuration(summary.durationSec)}
- 平均配速：${formatPace(summary.averagePaceSecPerKm)}/km
- 平均心率：${summary.averageHeartRate ?? '-'} bpm
- 最高心率：${summary.maxHeartRate ?? '-'} bpm
- 爬升：${summary.elevationGain ?? '-'} m
- 天气：${summary.weatherDescription ?? '-'}

## 配速与努力特征
- 趋势：${activity.pace.trend}
- 前半程均配：${formatPace(activity.pace.firstHalfAvgPace)}/km
- 后半程均配：${formatPace(activity.pace.secondHalfAvgPace)}/km
- 最快公里：${activity.pace.fastestKm ?? '-'}
- 最慢公里：${activity.pace.slowestKm ?? '-'}
- 疲劳信号：${activity.effort.fatigueSignal}
- 心率备注：${activity.effort.heartRateNote ?? '-'}

## 分段
${activity.splits
  .slice(0, 25)
  .map(split => `- 第 ${split.kilometer} 公里：${formatPace(split.pace)}/km${split.averageHeartRate ? `，${split.averageHeartRate} bpm` : ''}`)
  .join('\n') || '- 无分段数据'}

## 观察 moments
${activity.moments.map(moment => `- ${moment.label}：${moment.content}`).join('\n') || '- 暂无显著 moments'}

## 近 ${recentTraining.days} 天同类型训练
- 活动数：${recentTraining.activities}
- 总里程：${recentTraining.distanceKm.toFixed(2)} km
- 最长单次：${recentTraining.longestDistanceKm.toFixed(2)} km

## 相关比赛目标
${raceGoals
  .map(goal => {
    const target = goal.targetTimeSec ? `，目标时间 ${formatDuration(goal.targetTimeSec)}` : ''
    const notes = goal.notes ? `，备注：${goal.notes}` : ''
    return `- ${goal.name}｜${goal.distanceMeters / 1000} km｜${goal.raceDate}｜${goal.daysUntilRace} 天后${target}${notes}`
  })
  .join('\n') || '- 暂无 active 比赛目标'}

## 恢复数据
${healthDailyMetrics
  .map(metric => {
    const pieces = [
      `日期 ${metric.date}`,
      metric.sleepMinutes != null ? `睡眠 ${metric.sleepMinutes} 分钟` : null,
      metric.deepSleepMinutes != null ? `深睡 ${metric.deepSleepMinutes} 分钟` : null,
      metric.remSleepMinutes != null ? `REM ${metric.remSleepMinutes} 分钟` : null,
      metric.hrv != null ? `HRV ${metric.hrv}` : null,
      metric.restingHr != null ? `静息心率 ${metric.restingHr}` : null,
      `恢复状态 ${metric.recoveryLabel}`,
    ].filter(Boolean)
    return `- ${pieces.join('，')}（来源：${metric.source}）`
  })
  .join('\n') || '- 暂无恢复数据'}

## 用户主观反馈
${context.subjectiveFeedback
  .map(feedback => {
    const parts = [
      feedback.rpe ? `RPE ${feedback.rpe}/10` : null,
      feedback.mood ? `心情/体感：${feedback.mood}` : null,
      feedback.pain ? `疼痛/不适：${JSON.stringify(feedback.pain)}` : null,
      feedback.note ? `备注：${feedback.note}` : null,
    ].filter(Boolean)
    return `- ${parts.join('；')}（${feedback.createdAt}）`
  })
  .join('\n') || '- 暂无'}

## 可引用的长期记忆
${context.memoryItems
  .map(memory => `- [${memory.type}] ${memory.content}`)
  .join('\n') || '- 暂无 active 记忆'}

## 可引用训练知识
${context.retrievedKnowledge
  .map(item => `- [${item.id}] ${item.content.slice(0, 360)}${item.content.length > 360 ? '...' : ''}${item.source ? `（来源：${item.source}）` : ''}`)
  .join('\n') || '- 暂无命中知识库'}

请输出：
1. 一句整体评价。
2. 结合具体数据解释本次节奏/努力。
3. 给 1-2 条下一次训练建议。

不要追问。`
}

export function buildRuleBasedPrReview(context: PrContext) {
  const { activity, recentTraining, raceGoals, healthDailyMetrics } = context
  const summary = activity.summary
  const trendLabel =
    activity.pace.trend === 'negative_split'
      ? '后程加速'
      : activity.pace.trend === 'positive_split'
        ? '后程放缓'
        : activity.pace.trend === 'steady'
          ? '节奏比较稳'
          : '节奏数据还不完整'
  const momentText = activity.moments[0]
    ? `${activity.moments[0].label}：${activity.moments[0].content}`
    : '这次没有特别尖锐的异常点，适合作为一次稳定样本记录下来。'

  const heartRateText = summary.averageHeartRate
    ? `心率这边平均 ${summary.averageHeartRate} bpm${summary.maxHeartRate ? `、最高 ${summary.maxHeartRate} bpm` : ''}`
    : '心率数据暂时不完整'

  const latestFeedback = context.subjectiveFeedback[0]
  const latestGoal = raceGoals[0]
  const latestHealth = healthDailyMetrics[0]
  const knowledge = context.retrievedKnowledge[0]
  const memoryText = context.memoryItems.length
    ? `另外，已确认的长期记忆里有 ${context.memoryItems.slice(0, 2).map(memory => memory.content).join('；')}。`
    : ''
  const goalText = latestGoal
    ? `当前更近的比赛目标是 ${latestGoal.name}，还有 ${latestGoal.daysUntilRace} 天。`
    : ''
  const healthText = latestHealth
    ? `最近恢复数据里，${latestHealth.date} 的状态是 ${latestHealth.recoveryLabel}，睡眠 ${latestHealth.sleepMinutes ?? '未知'} 分钟。`
    : ''
  const feedbackText = latestFeedback
    ? `你补充的主观反馈是 ${[
        latestFeedback.rpe ? `RPE ${latestFeedback.rpe}/10` : null,
        latestFeedback.mood ? latestFeedback.mood : null,
        latestFeedback.note ? latestFeedback.note : null,
      ]
        .filter(Boolean)
        .join('，')}，这比单看配速更能说明当时状态。`
    : ''
  const knowledgeText = knowledge
    ? `知识库里也有相关参考：${knowledge.content.slice(0, 90)}。`
    : ''

  return `这次 ${summary.title} 完成了 **${summary.distanceKm.toFixed(2)} km**，用时 **${formatDuration(summary.durationSec)}**，平均配速 **${formatPace(summary.averagePaceSecPerKm)}/km**，整体看是一次${trendLabel}的训练。

${momentText} ${heartRateText}${summary.weatherDescription ? `，天气是 ${summary.weatherDescription}` : ''}。${goalText}${healthText}${feedbackText}${memoryText}${knowledgeText} 近 ${recentTraining.days} 天同类型活动有 ${recentTraining.activities} 次、累计 ${recentTraining.distanceKm.toFixed(2)} km，这次可以放进最近训练节奏里一起看。

下一次建议保持前半程更克制一点，把主要发力留给后半段；如果主观疲劳偏高，就把目标从“提速”换成“稳定完成”，优先守住连续性。`
}
