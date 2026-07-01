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

  if (content.length < 120) {
    warnings.push('too_short')
  }

  return {
    passed: warnings.length === 0,
    warnings,
  }
}
