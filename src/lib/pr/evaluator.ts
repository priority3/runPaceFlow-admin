import type { PrContext } from './context'

export interface EvaluationResult {
  passed: boolean
  warnings: string[]
}

export function evaluateActivityReview(content: string, context: PrContext): EvaluationResult {
  const warnings: string[] = []
  const summary = context.activity.summary
  const concreteSignals = [
    summary.distanceKm.toFixed(2),
    summary.averageHeartRate == null ? null : String(summary.averageHeartRate),
    summary.maxHeartRate == null ? null : String(summary.maxHeartRate),
    context.activity.pace.fastestKm == null ? null : `第 ${context.activity.pace.fastestKm}`,
    context.activity.moments[0]?.label ?? null,
  ].filter(Boolean) as string[]

  if (!concreteSignals.some(signal => content.includes(signal))) {
    warnings.push('missing_activity_fact_reference')
  }

  if (/(诊断|处方|必须吃药|停止所有运动|严重疾病)/.test(content)) {
    warnings.push('medical_risk_language')
  }

  if (/(你就是|你一直|你总是|性格|天生|肯定是)/.test(content)) {
    warnings.push('overconfident_personality_claim')
  }

  for (const correction of context.companionProfile.doNotAssume) {
    const tokens = correction
      .replace(/[，。！？,.!?]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 3)
      .slice(0, 4)
    if (tokens.length > 0 && tokens.every(token => content.includes(token))) {
      warnings.push('violates_user_correction')
      break
    }
  }

  if (context.healthDailyMetrics.length === 0 && /(睡眠|HRV|静息心率|恢复状态)/.test(content)) {
    warnings.push('unsupported_recovery_claim')
  }

  if (context.memoryItems.length === 0 && context.trainingHabitSignals.length === 0 && /(你习惯|你喜欢|你通常|你经常|老习惯)/.test(content)) {
    warnings.push('unsupported_habit_claim')
  }

  if (content.length < 120) {
    warnings.push('too_short')
  }

  return {
    passed: warnings.length === 0,
    warnings,
  }
}
