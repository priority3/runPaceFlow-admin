'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageSquareText, RefreshCw } from 'lucide-react'

import { formatDateTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

import { EmptyState, LoadingState } from './shared'

interface ReviewSummary {
  id: string
  kind: string
  subjectId: string
  activityId: string | null
  content: string
  model: string
  provider: string | null
  createdAt: string
}

const KIND_LABEL: Record<string, string> = {
  pr_recovery_review: '晨间反思',
  pr_activity_review: '跑后复盘',
  pr_weekly_review: '周总结',
}

/**
 * PR 说过的话是全站唯一一处复盘视图（原先「运动数据」页还有一份带写操作的副本）。
 * 重生成与 RPE 反馈随那份副本一起搬到这里，避免同一份 review 出现两个入口。
 */
export function PrReviewsPanel() {
  const { success, error: toastError } = useToast()
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, { rpe: string; note: string }>>({})
  const [savingFeedbackId, setSavingFeedbackId] = useState<string | null>(null)

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/activities/reviews?limit=20', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setReviews(data.reviews ?? [])
        setLoadError(null)
      } else {
        setLoadError(`加载反思失败 (HTTP ${res.status})`)
      }
    } catch (e) {
      setLoadError(`加载反思失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(fetchReviews)
    // 生成周总结会新增一条 review，由 PrOpsPanel 广播刷新
    const onRefresh = () => void fetchReviews()
    window.addEventListener('pr:reviews-refresh', onRefresh)
    return () => window.removeEventListener('pr:reviews-refresh', onRefresh)
  }, [fetchReviews])

  const regenerateReview = async (activityId: string) => {
    setRegeneratingId(activityId)
    try {
      const res = await fetch('/api/activities/reviews/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId }),
      })
      if (res.ok) success('已重新生成复盘')
      else toastError('重生成失败，请稍后再试')
      await fetchReviews()
    } catch {
      toastError('重生成失败，请检查网络')
    } finally {
      setRegeneratingId(null)
    }
  }

  const submitFeedback = async (activityId: string) => {
    const draft = feedbackDrafts[activityId]
    if (!draft?.rpe && !draft?.note) return
    setSavingFeedbackId(activityId)
    try {
      const res = await fetch('/api/activities/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          rpe: draft.rpe ? Number(draft.rpe) : null,
          note: draft.note,
        }),
      })
      if (res.ok) {
        success('体感反馈已记下')
        setFeedbackDrafts(prev => ({ ...prev, [activityId]: { rpe: '', note: '' } }))
        await fetchReviews()
      } else {
        toastError('反馈保存失败')
      }
    } catch {
      toastError('反馈保存失败，请检查网络')
    } finally {
      setSavingFeedbackId(null)
    }
  }

  if (loading) return <LoadingState />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="pr-title flex items-center gap-2"><MessageSquareText className="h-4 w-4" /> PR 最近的话</h3>
        <button type="button" onClick={fetchReviews} className="pr-btn h-8 text-xs">
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>

      {loadError && <p className="pr-meta">{loadError}</p>}

      {reviews.length ? (
        <div>
          {reviews.map(review => (
            <div key={review.id} className="pr-row py-4">
              <div className="pr-row-main">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="pr-tag">{KIND_LABEL[review.kind] ?? review.kind}</span>
                  <span className="pr-meta">{review.subjectId}</span>
                  <span className="pr-meta">{review.provider === 'local-rule' ? '规则兜底' : review.model}</span>
                  <span className="pr-meta ml-auto">{formatDateTime(review.createdAt)}</span>
                  {review.activityId && (
                    <button
                      type="button"
                      onClick={() => regenerateReview(review.activityId as string)}
                      disabled={regeneratingId === review.activityId}
                      className="pr-btn h-7 px-2 text-xs"
                      title="重生成复盘"
                    >
                      <RefreshCw className={regeneratingId === review.activityId ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                      重生成
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{review.content}</p>

                {review.activityId && (
                  <div className="mt-4 grid gap-2 border-t pt-3 sm:grid-cols-[96px_1fr_auto]" style={{ borderColor: 'var(--pr-line)' }}>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={feedbackDrafts[review.activityId]?.rpe ?? ''}
                      onChange={(e) => setFeedbackDrafts(prev => ({
                        ...prev,
                        [review.activityId as string]: { rpe: e.target.value, note: prev[review.activityId as string]?.note ?? '' },
                      }))}
                      placeholder="RPE"
                      className="pr-field h-9 px-3 text-sm outline-none"
                    />
                    <input
                      type="text"
                      value={feedbackDrafts[review.activityId]?.note ?? ''}
                      onChange={(e) => setFeedbackDrafts(prev => ({
                        ...prev,
                        [review.activityId as string]: { rpe: prev[review.activityId as string]?.rpe ?? '', note: e.target.value },
                      }))}
                      placeholder="补充体感、疼痛、备注"
                      className="pr-field h-9 px-3 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => submitFeedback(review.activityId as string)}
                      disabled={savingFeedbackId === review.activityId}
                      className="pr-btn pr-btn-primary h-9"
                    >
                      {savingFeedbackId === review.activityId ? '保存中' : '保存反馈'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState line="还没有反思。每天健康数据上报后，PR 会写一条晨间反思。" />
      )}
    </div>
  )
}
