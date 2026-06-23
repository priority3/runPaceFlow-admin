'use client'

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  BarChart3,
  Bell,
  Brain,
  Clipboard,
  Cloud,
  Database,
  Eye,
  EyeOff,
  FileInput,
  MapIcon,
  ServerCog,
  Target,
  Upload,
  Zap,
} from 'lucide-react'

import { exportEnvAction, importEnvAction, saveSettingsAction } from '@/app/actions'
import { CATEGORY_META, SETTING_DEFINITIONS, type SettingCategory } from '@/lib/settings'
import type { StoredSetting } from '@/lib/store'
import { cn, maskValue } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

import { SetupDiagnostic } from './SetupDiagnostic'

const CATEGORY_ICONS: Record<SettingCategory, React.ComponentType<{ className?: string }>> = {
  database: Database,
  sync: Cloud,
  ai: Brain,
  map: MapIcon,
  goals: Target,
  notification: Bell,
  runtime: ServerCog,
  analytics: BarChart3,
}

const CATEGORY_ORDER: SettingCategory[] = ['database', 'sync', 'ai', 'map', 'goals', 'notification', 'analytics', 'runtime']

export function SettingsPanel({ settings }: { settings: StoredSetting[] }) {
  const { success, error: toastError, info } = useToast()
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('database')
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})
  const [exportText, setExportText] = useState('')
  const [importState, importAction, importing] = useActionState(importEnvAction, null)
  // Reason: 用 useActionState 接住 saveSettingsAction 的返回值，才能展示保存成功/失败反馈
  const [saveState, saveAction, saving] = useActionState(saveSettingsAction, null)
  const [exporting, startExportTransition] = useTransition()

  // Reason: saveState 变化时弹一次 toast；用 savedAt 去重，避免重渲染重复触发
  const lastSavedAtRef = useRef<number>(0)
  useEffect(() => {
    if (!saveState || saveState.savedAt === lastSavedAtRef.current) return
    lastSavedAtRef.current = saveState.savedAt
    if (saveState.ok) {
      success(saveState.message)
    } else {
      toastError(saveState.message)
    }
  }, [saveState, success, toastError])

  // 导入成功后弹 toast
  const lastImportRef = useRef<string | null>(null)
  useEffect(() => {
    if (!importState?.message || importState.message === lastImportRef.current) return
    lastImportRef.current = importState.message
    success(importState.message)
  }, [importState, success])

  const settingsByKey = useMemo(() => new Map(settings.map(s => [s.key, s])), [settings])

  const stats = useMemo(() => {
    const configured = settings.filter(s => s.exists && s.value !== '').length
    const secrets = settings.filter(s => s.exists && s.isSensitive && s.value !== '').length
    return { configured, secrets, total: settings.length }
  }, [settings])

  const activeDefinitions = SETTING_DEFINITIONS.filter(d => d.category === activeCategory)
  const activeMeta = CATEGORY_META[activeCategory]

  function handleExport() {
    startExportTransition(async () => {
      setExportText(await exportEnvAction())
    })
  }

  async function applyPreset(preset: Record<string, string | undefined>) {
    const form = document.getElementById('settings-form') as HTMLFormElement | null
    if (!form) return

    for (const [key, value] of Object.entries(preset)) {
      if (!value) continue
      const input = form.querySelector(`[name="setting:${key}"]`) as HTMLInputElement | HTMLSelectElement | null
      if (input) {
        input.value = value
      }
    }

    // Reason: 表单 action 已绑定 saveAction，requestSubmit 会自动触发保存并弹出成功 toast
    form.requestSubmit()
    info('预设已填入并保存，请检查并补充敏感信息（如 API Key）')
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">配置管理</h2>
          <p className="text-muted-foreground text-xs mt-1">{stats.configured}/{stats.total} 已配置 · {stats.secrets} 个密钥</p>
        </div>
        <button
          type="button"
          onClick={() => { const f = document.getElementById('settings-form') as HTMLFormElement | null; f?.requestSubmit() }}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
      </header>

      {/* Quick Setup Presets */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Zap className="h-4 w-4" />
          快速配置预设
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              name: '开发环境',
              desc: '本地 SQLite + 基础配置',
              icon: '🔧',
              values: {
                DATABASE_URL: 'file:./data/activities.db',
                NEXT_PUBLIC_MAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
                PORT: '3000',
              },
            },
            {
              name: '腾讯云生产',
              desc: 'Turso + PushPlus + AI',
              icon: '☁️',
              values: {
                DATABASE_URL: 'libsql://your-turso-db.turso.io',
                NEXT_PUBLIC_MAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
                NEXT_PUBLIC_WEEKLY_RUNNING_DISTANCE_GOAL: '10000',
                NEXT_PUBLIC_MONTHLY_RUNNING_DISTANCE_GOAL: '50000',
                NEXT_PUBLIC_WEEKLY_CYCLING_DISTANCE_GOAL: '40000',
                NEXT_PUBLIC_MONTHLY_CYCLING_DISTANCE_GOAL: '160000',
                PORT: '3000',
              },
            },
            {
              name: 'Nike 用户',
              desc: 'Nike Run Club 同步配置',
              icon: '🏃',
              values: {
                DATABASE_URL: 'libsql://your-turso-db.turso.io',
                NEXT_PUBLIC_MAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
              },
            },
            {
              name: 'Strava 用户',
              desc: 'Strava 同步配置',
              icon: '🚴',
              values: {
                DATABASE_URL: 'libsql://your-turso-db.turso.io',
                NEXT_PUBLIC_MAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
              },
            },
            {
              name: 'AI 增强',
              desc: '启用 Claude + OpenAI 分析',
              icon: '🤖',
              values: {
                DATABASE_URL: 'libsql://your-turso-db.turso.io',
                NEXT_PUBLIC_MAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
                OPENAI_MODEL: 'gpt-4o',
                OPENAI_API_FORMAT: 'chat',
              },
            },
            {
              name: '通知推送',
              desc: 'PushPlus 微信通知',
              icon: '🔔',
              values: {
                DATABASE_URL: 'libsql://your-turso-db.turso.io',
                NEXT_PUBLIC_MAP_STYLE: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
              },
            },
          ].map(preset => (
            <div key={preset.name} className="bg-card rounded-lg border p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{preset.icon}</span>
                <span className="text-sm font-medium">{preset.name}</span>
              </div>
              <p className="text-muted-foreground text-xs mb-3">{preset.desc}</p>
              <button
                type="button"
                onClick={() => applyPreset(preset.values)}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 items-center gap-1 rounded-md px-3 text-xs font-medium shadow-sm transition-colors disabled:opacity-50"
              >
                <Zap className="h-3 w-3" />
                应用预设
              </button>
            </div>
          ))}
        </div>
      </section>

      <SetupDiagnostic />

      <div className="flex gap-2 overflow-x-auto pb-2">
        {CATEGORY_ORDER.map(cat => {
          const Icon = CATEGORY_ICONS[cat]
          const meta = CATEGORY_META[cat]
          const catSettings = settings.filter(s => SETTING_DEFINITIONS.find(d => d.key === s.key)?.category === cat)
          const configured = catSettings.filter(s => s.exists && s.value !== '').length
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
                activeCategory === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border hover:bg-accent',
              )}
            >
              <Icon className="h-4 w-4" />
              {meta.label}
              <span className="text-xs opacity-70">{configured}/{catSettings.length}</span>
            </button>
          )
        })}
      </div>

      <p className="text-muted-foreground text-sm">{activeMeta.description}</p>

      <form id="settings-form" action={saveAction} className="bg-card rounded-lg border shadow-sm overflow-hidden">
        {activeDefinitions.map(def => {
          const setting = settingsByKey.get(def.key)
          const value = setting?.value ?? def.defaultValue ?? ''
          const visible = visibleSecrets[def.key]
          const inputType = def.kind === 'password' && !visible ? 'password' : def.kind === 'number' ? 'number' : 'text'

          return (
            <div key={def.key} className="flex flex-col gap-2 border-b p-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex-1 min-w-0">
                <label htmlFor={def.key} className="text-sm font-medium">{def.label}</label>
                <p className="text-muted-foreground text-xs mt-0.5">{def.description}</p>
                <code className="text-muted-foreground font-mono text-xs">{def.key}</code>
              </div>
              <div className="relative w-full sm:w-80">
                {def.kind === 'select' ? (
                  <select id={def.key} name={`setting:${def.key}`} defaultValue={value}
                    className="border-input bg-background focus:border-ring h-10 w-full rounded-md border px-3 text-sm shadow-sm outline-none focus:ring-[3px]">
                    {def.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={def.key} name={`setting:${def.key}`} type={inputType}
                    inputMode={def.kind === 'number' ? 'numeric' : undefined}
                    defaultValue={value}
                    placeholder={def.kind === 'password' && value && !visible ? maskValue(value) : def.placeholder}
                    className={cn('border-input bg-background placeholder:text-muted-foreground focus:border-ring h-10 w-full rounded-md border px-3 text-sm shadow-sm outline-none focus:ring-[3px]', def.kind === 'password' && 'pr-11')} />
                )}
                {def.kind === 'password' && (
                  <button type="button" onClick={() => setVisibleSecrets(p => ({ ...p, [def.key]: !p[def.key] }))}
                    className="text-muted-foreground hover:bg-accent absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-md">
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileInput className="h-4 w-4" />导入 .env</h3>
          <form action={importAction} className="space-y-3">
            <textarea name="envText" rows={4} placeholder="DATABASE_URL=libsql://..."
              className="border-input bg-background placeholder:text-muted-foreground focus:border-ring scrollbar-subtle w-full resize-none rounded-md border p-3 font-mono text-xs shadow-sm outline-none focus:ring-[3px]" />
            <button type="submit" disabled={importing}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 w-full items-center justify-center gap-2 rounded-md text-sm font-medium shadow-sm disabled:opacity-50">
              <Upload className="h-4 w-4" />{importing ? '导入中...' : '导入'}
            </button>
          </form>
        </div>

        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Clipboard className="h-4 w-4" />导出 .env</h3>
            <button type="button" onClick={handleExport} disabled={exporting}
              className="bg-background hover:bg-accent flex h-8 items-center gap-2 rounded-md border px-3 text-xs shadow-sm disabled:opacity-50">
              {exporting ? '生成中...' : '生成'}
            </button>
          </div>
          <textarea value={exportText} readOnly rows={4} placeholder="点击生成后显示"
            className="border-input bg-background scrollbar-subtle w-full resize-none rounded-md border p-3 font-mono text-xs shadow-sm outline-none" />
        </div>
      </div>
    </div>
  )
}
