'use client'

import { useCallback, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, PlugZap } from 'lucide-react'

/**
 * 同步源配置自检:用当前保存的凭据真跑一次登录 + 拉最近几条活动(干跑,不写库)。
 *
 * Reason: 同步凭据填错时,此前唯一的反馈是「每小时定时任务静默失败」——要么翻容器
 * 日志,要么等一天发现没数据。这里复用 /api/sync/keep 的 probe 模式(它本就是为
 * 「校验单位/轨迹是否完整」而写的干跑通路),把结果直接摊在配置页上。
 *
 * 交互刻意做成「测当前输入框的值」:点测试时从同一表单里读 KEEP_MOBILE/KEEP_PASSWORD
 * 的**草稿值**随请求带上 —— 正确的顺序是「填 → 测通 → 再保存」,而不是把可能错的
 * 凭据先写进库、错了还要改一遍。输入框为空时后端回落已保存的配置。
 */

interface ProbeActivity {
  id: string
  title: string
  startTime: string
  durationSec: number
  distanceM: number
  avgHr: number | null
  hasGpx: boolean
  gpxPoints: number
}

interface ProbeResult {
  count: number
  activities: ProbeActivity[]
}

function fmtDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export function SyncSourceProbe() {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const test = useCallback(async () => {
    setTesting(true)
    setError(null)
    setResult(null)
    try {
      // Reason: 配置项输入框是非受控的(defaultValue + name),直接按 id 读当前草稿值;
      // 读不到(比如切了分类没渲染)就不带,由后端回落已保存配置。
      const readDraft = (key: string) =>
        (document.getElementById(key) as HTMLInputElement | null)?.value?.trim() || undefined
      const res = await fetch('/api/sync/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          probe: true,
          limit: 3,
          mobile: readDraft('KEEP_MOBILE'),
          password: readDraft('KEEP_PASSWORD'),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setResult(json as ProbeResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : '测试失败')
    }
    setTesting(false)
  }, [])

  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <PlugZap className="h-4 w-4 text-sky-600" />
            同步源自检(Keep)
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            用<strong>下方输入框里的凭据</strong>真跑一次登录并拉最近 3 条活动 ·
            干跑不写库、不必先保存 · 测通了再点右上「保存配置」
          </p>
        </div>
        <button
          type="button"
          onClick={test}
          disabled={testing}
          className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          {testing ? '测试中…' : '测试连接'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </p>
          <ul className="mt-1.5 ml-5 list-disc space-y-0.5 text-red-800">
            <li>「都要填」→ 下方 Keep 手机号与密码两栏都填上再测</li>
            <li>「登录失败」→ 手机号/密码有误,或 Keep 侧要求验证码(换个网络再试)</li>
            <li>其他错误 → 多为出网受限;这台机需经本地代理访问外网</li>
          </ul>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            登录成功 · 拉到 {result.count} 条最近活动(未写库)
          </p>
          {result.activities.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 text-left font-normal">活动</th>
                  <th className="py-1 text-right font-normal">距离</th>
                  <th className="py-1 text-right font-normal">时长</th>
                  <th className="py-1 text-right font-normal">心率</th>
                  <th className="py-1 text-right font-normal">轨迹点</th>
                </tr>
              </thead>
              <tbody>
                {result.activities.map(a => (
                  <tr key={a.id} className="border-b last:border-b-0">
                    <td className="py-1">
                      {a.title || '(无标题)'}
                      <span className="text-muted-foreground ml-1">
                        {new Date(a.startTime).toLocaleDateString('zh-CN')}
                      </span>
                    </td>
                    <td className="py-1 text-right font-mono">{fmtDistance(a.distanceM)}</td>
                    <td className="py-1 text-right font-mono">{fmtDuration(a.durationSec)}</td>
                    <td className="py-1 text-right font-mono">{a.avgHr ?? '—'}</td>
                    <td className="py-1 text-right font-mono">
                      {a.hasGpx ? a.gpxPoints : <span className="text-amber-700">无</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-muted-foreground mt-1.5 text-xs">
            字段与轨迹点正常即可点右上「保存配置」落库;「轨迹点=无」多为跑步机等室内活动。
          </p>
        </div>
      )}
    </div>
  )
}
