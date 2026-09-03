'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Loader2, RefreshCw, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

import { cn, formatDateTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

import { LoadingState } from './shared'

/**
 * PR 对话页的入口凭证(签发在这里,校验在 pr-agent)。
 *
 * 对话页没有共享密码:管理端签发一次性链接(7 天有效、只能用一次),手机打开后
 * 换成设备专属令牌(90 天滑动过期)。所以这张卡片是唯一的进门通道 —— 换手机、
 * 令牌过期、或吊销之后,都得回来再签一条。
 *
 * 二维码本地渲染(qrcode.react)。Reason: 走外部二维码服务等于把一次性访问令牌
 * 发给第三方,那正是这套机制要消灭的东西。
 */

interface AccessLink {
  id: string
  note: string | null
  createdAt: string
  expiresAt: string
  usedAt: string | null
  status: 'pending' | 'used' | 'expired'
}

interface AccessDevice {
  id: string
  label: string | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  status: 'active' | 'expired' | 'revoked'
}

interface IssuedLink {
  url: string
  expiresAt: string
}

const LINK_BADGE: Record<AccessLink['status'], { label: string; cls: string }> = {
  pending: { label: '待使用', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  used: { label: '已用过', cls: 'bg-muted text-muted-foreground' },
  expired: { label: '已过期', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
}

const DEVICE_BADGE: Record<AccessDevice['status'], { label: string; cls: string }> = {
  active: { label: '在用', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  expired: { label: '已过期', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  revoked: { label: '已吊销', cls: 'border-red-200 bg-red-50 text-red-700' },
}

/** UA 摘要太长,列表里只显示能认出设备的那截。 */
function shortLabel(label: string | null): string {
  if (!label) return '未知设备'
  const match = label.match(/\((.*?)\)/)
  return (match?.[1] ?? label).slice(0, 40)
}

export function PrAccessCard() {
  const { success, error: toastError } = useToast()
  const [links, setLinks] = useState<AccessLink[]>([])
  const [devices, setDevices] = useState<AccessDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<IssuedLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [showLinks, setShowLinks] = useState(false)

  const fetchAll = useCallback(async () => {
    try {
      const [linksRes, devicesRes] = await Promise.all([
        fetch('/api/pr/access/links', { cache: 'no-store' }),
        fetch('/api/pr/access/devices', { cache: 'no-store' }),
      ])
      if (!linksRes.ok) throw new Error(`HTTP ${linksRes.status}`)
      if (!devicesRes.ok) throw new Error(`HTTP ${devicesRes.status}`)
      const linksJson = await linksRes.json()
      const devicesJson = await devicesRes.json()
      setLinks(linksJson.links ?? [])
      setDevices(devicesJson.devices ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(`加载入口凭证失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setLoading(false)
  }, [])

  // Reason: 推到微任务再跑,避免在 effect 体内同步 setState 触发 react-hooks/set-state-in-effect
  useEffect(() => {
    void Promise.resolve().then(fetchAll)
  }, [fetchAll])

  async function issue() {
    setIssuing(true)
    try {
      const res = await fetch('/api/pr/access/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: `admin 面板 ${formatDateTime(new Date())}` }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setIssued({ url: json.url, expiresAt: json.expiresAt })
      setCopied(false)
      success('已签发,用手机扫下面的二维码')
      await fetchAll()
    } catch (e) {
      toastError(`签发失败:${e instanceof Error ? e.message : '网络错误'}`)
    }
    setIssuing(false)
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      success('链接已复制')
    } catch {
      toastError('复制失败,请手动选中链接')
    }
  }

  async function revoke(id: string) {
    setRevoking(id)
    try {
      const res = await fetch(`/api/pr/access/devices/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      success('已吊销,该设备最迟一分钟内掉线')
      setConfirmingRevoke(null)
      await fetchAll()
    } catch (e) {
      toastError(`吊销失败:${e instanceof Error ? e.message : '网络错误'}`)
    }
    setRevoking(null)
  }

  if (loading) return <LoadingState />

  if (loadError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <p className="font-medium">{loadError}</p>
        <p className="mt-1 text-xs text-red-800">
          入口凭证由 pr-agent 持有。若它不可达,请检查 PR_AGENT_URL 与容器状态 ——
          此处失败不代表已发出的链接失效。
        </p>
      </div>
    )
  }

  const activeDevices = devices.filter(d => d.status === 'active')

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">对话页入口</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            链接 7 天有效、只能用一次 · 手机扫码后换成本机令牌(90 天,常用不掉线)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchAll()}
            className="bg-background hover:bg-accent flex h-8 items-center gap-2 rounded-md border px-3 text-xs shadow-sm transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            刷新
          </button>
          <button
            type="button"
            onClick={() => void issue()}
            disabled={issuing}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium disabled:opacity-50"
          >
            {issuing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
            生成入口链接
          </button>
        </div>
      </div>

      {issued && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-md bg-white p-2">
              <QRCodeSVG value={issued.url} size={128} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-emerald-900">用手机扫码即可进入对话页</p>
              <p className="mt-1 text-xs text-emerald-800">
                这条链接<strong className="font-semibold">只显示这一次</strong>,刷新面板后拿不回来
                (服务端只存摘要)。到期时间 {formatDateTime(issued.expiresAt)}。
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="bg-background min-w-0 flex-1 truncate rounded border px-2 py-1 font-mono text-xs">
                  {issued.url}
                </code>
                <button
                  type="button"
                  onClick={() => void copyLink(issued.url)}
                  className="bg-background hover:bg-accent flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          已授权设备({activeDevices.length} 台在用)
        </p>
        {devices.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">暂无设备。生成一条链接并在手机上打开即可。</p>
        ) : (
          devices.map(device => {
            const badge = DEVICE_BADGE[device.status]
            const isRevoking = revoking === device.id
            return (
              <div key={device.id} className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 shadow-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Smartphone className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-sm font-medium" title={device.label ?? undefined}>
                      {shortLabel(device.label)}
                    </span>
                    <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-xs', badge.cls)}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    最后使用 {formatDateTime(device.lastUsedAt)} · 到期 {formatDateTime(device.expiresAt)}
                  </p>
                </div>

                {device.status === 'active' && (
                  confirmingRevoke === device.id ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void revoke(device.id)}
                        disabled={isRevoking}
                        className="flex h-7 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        {isRevoking && <Loader2 className="h-3 w-3 animate-spin" />}
                        确认吊销
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingRevoke(null)}
                        className="bg-background hover:bg-accent h-7 rounded-md border px-2 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingRevoke(device.id)}
                      className="bg-background hover:bg-accent h-7 shrink-0 rounded-md border px-2 text-xs"
                    >
                      吊销
                    </button>
                  )
                )}
              </div>
            )
          })
        )}
      </div>

      {links.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowLinks(!showLinks)}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            {showLinks ? '收起签发记录' : `签发记录 ${links.length} 条`}
          </button>
          {showLinks && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 text-left font-normal">签发时间</th>
                  <th className="py-1 text-left font-normal">状态</th>
                  <th className="py-1 text-left font-normal">使用时间</th>
                </tr>
              </thead>
              <tbody>
                {links.map(link => (
                  <tr key={link.id} className="border-b last:border-b-0">
                    <td className="py-1.5 font-mono">{formatDateTime(link.createdAt)}</td>
                    <td className="py-1.5">
                      <span className={cn('rounded border px-1.5 py-0.5', LINK_BADGE[link.status].cls)}>
                        {LINK_BADGE[link.status].label}
                      </span>
                    </td>
                    <td className="text-muted-foreground py-1.5 font-mono">
                      {link.usedAt ? formatDateTime(link.usedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
