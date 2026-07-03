'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, Send, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

type StepStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip'

interface StepResult {
  name: string
  status: StepStatus
  message: string
  details?: string
}

const INITIAL_STEPS: StepResult[] = [
  { name: 'Admin API 可达', status: 'pending', message: '检测 Admin API 是否正常运行' },
  { name: '前端运行时配置', status: 'pending', message: '检测 Admin → 前端 runtime-config' },
  { name: 'Admin URL 回源配置', status: 'pending', message: '检测前端运行时是否配置了 Admin URL' },
  { name: '发送测试信标', status: 'pending', message: '发送一条测试数据并验证接收' },
]

export function SetupDiagnostic() {
  const [steps, setSteps] = useState<StepResult[]>(INITIAL_STEPS)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState(false)

  function updateStep(index: number, update: Partial<StepResult>) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...update } : s))
  }

  async function runDiagnostics() {
    setRunning(true)
    setSteps(INITIAL_STEPS)
    setExpanded(true)

    // Step 1: Check Admin API
    updateStep(0, { status: 'running' })
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (res.ok) {
        updateStep(0, { status: 'pass', message: 'Admin API 正常运行' })
      } else {
        updateStep(0, { status: 'fail', message: `Admin API 返回 ${res.status}` })
        setRunning(false)
        return
      }
    } catch (e) {
      updateStep(0, { status: 'fail', message: `无法访问 Admin API: ${e instanceof Error ? e.message : String(e)}` })
      setRunning(false)
      return
    }

    // Step 2: Frontend connectivity
    updateStep(1, { status: 'running' })
    try {
      const res = await fetch('/api/health/connectivity', { cache: 'no-store' })
      const data = await res.json()
      if (data.frontendReachable) {
        updateStep(1, {
          status: 'pass',
          message: `前端 runtime-config 正常 (${data.connectivity.frontend_runtime_config?.latencyMs ?? data.connectivity.frontend_root?.latencyMs}ms)`,
          details: [
            `RUNPACEFLOW_FRONTEND_URL=${data.frontendUrl}`,
            `runtime-config=${data.connectivity.frontend_runtime_config?.url ?? `${data.frontendUrl}/api/runtime-config`}`,
          ].join('\n'),
        })
      } else {
        const failures = Object.entries(data.connectivity)
          .filter(([, v]: [string, any]) => !v.ok)
          .map(([k, v]: [string, any]) => `${k}: ${v.error || `HTTP ${v.status || 'failed'}`}`)
          .join('; ')
        updateStep(1, {
          status: 'fail',
          message: `前端运行时配置不可达: ${failures}`,
          details: [
            `RUNPACEFLOW_FRONTEND_URL=${data.frontendUrl}`,
            `runtime-config=${data.connectivity.frontend_runtime_config?.url ?? `${data.frontendUrl}/api/runtime-config`}`,
          ].join('\n'),
        })
      }
    } catch (e) {
      updateStep(1, { status: 'skip', message: `无法检测: ${e instanceof Error ? e.message : String(e)}` })
    }

    // Step 3: Check frontend runtime Admin URL config
    updateStep(2, { status: 'running' })
    try {
      const res = await fetch('/api/health/connectivity', { cache: 'no-store' })
      const data = await res.json()
      if (data.adminUrlConfigured) {
        updateStep(2, {
          status: 'pass',
          message: `已配置: ${data.adminUrl}`,
          details: '来源: 前端 /api/runtime-config 的 adminUrl',
        })
      } else {
        updateStep(2, {
          status: 'fail',
          message: '前端 runtime-config 未返回 adminUrl',
          details: '在前端配置 RUNPACEFLOW_ADMIN_URL，并确保 CONFIG_EXPORT_TOKEN 可从 Admin 拉取配置',
        })
      }
    } catch {
      updateStep(2, { status: 'skip', message: '无法检测' })
    }

    // Step 4: Send test beacon
    updateStep(3, { status: 'running' })
    try {
      const testPath = `/diagnostic-test-${Date.now()}`
      const beaconData = {
        path: testPath,
        visitorId: `diag_${Date.now().toString(36)}`,
        sessionId: `diag_session_${Date.now().toString(36)}`,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }

      const res = await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(beaconData),
      })

      if (res.ok) {
        // Verify it was stored
        await new Promise(r => setTimeout(r, 500))
        const statsRes = await fetch('/api/analytics/health', { cache: 'no-store' })
        const stats = await statsRes.json()
        updateStep(3, {
          status: 'pass',
          message: `测试信标已发送并接收 (${stats.beacons.last5min} 条/5min)`,
        })
      } else {
        updateStep(3, { status: 'fail', message: `信标发送失败: HTTP ${res.status}` })
      }
    } catch (e) {
      updateStep(3, { status: 'fail', message: `信标发送异常: ${e instanceof Error ? e.message : String(e)}` })
    }

    setRunning(false)
  }

  const passCount = steps.filter(s => s.status === 'pass').length
  const failCount = steps.filter(s => s.status === 'fail').length

  return (
    <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🔍</span>
          <span>连接诊断</span>
          {steps.some(s => s.status !== 'pending') && (
            <span className={cn(
              'text-xs font-normal px-2 py-0.5 rounded-full',
              failCount > 0 ? 'bg-red-50 text-red-700' : passCount > 0 ? 'bg-emerald-50 text-emerald-700' : '',
            )}>
              {passCount}/{steps.length} 通过
            </span>
          )}
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-3">
          <p className="text-muted-foreground text-xs">
            自动检测 Admin ↔ 前端的数据流连通性，帮助定位「无数据」问题。
          </p>

          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <div className="mt-0.5 shrink-0">
                  {step.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />}
                  {step.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {step.status === 'pass' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {step.status === 'fail' && <XCircle className="h-4 w-4 text-red-500" />}
                  {step.status === 'skip' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{step.name}</div>
                  <div className={cn('text-xs', step.status === 'fail' ? 'text-red-600' : 'text-muted-foreground')}>
                    {step.message}
                  </div>
                  {step.details && (
                    <pre className="mt-1 text-xs text-muted-foreground bg-muted rounded p-2 overflow-x-auto">{step.details}</pre>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={runDiagnostics}
            disabled={running}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
          >
            {running ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> 检测中...</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> 运行诊断</>
            )}
          </button>

          {failCount > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-1">
              <p className="font-medium">修复建议：</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>确保前端 <code>RUNPACEFLOW_ADMIN_URL</code> 指向 Admin 的公网地址</li>
                <li>确保前端 <code>CONFIG_EXPORT_TOKEN</code> 能从 Admin 拉取运行时配置</li>
                <li>确保 Admin 的 <code>RUNPACEFLOW_FRONTEND_URL</code> 设置为前端的 Docker 内部地址</li>
                <li>检查 Docker 网络和防火墙配置</li>
                <li>访问 <code>/api/health/connectivity</code> 查看详细连通性报告</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
