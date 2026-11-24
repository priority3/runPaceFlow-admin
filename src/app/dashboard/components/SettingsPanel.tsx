'use client'

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  BarChart3,
  Brain,
  Clipboard,
  Cloud,
  Database,
  Eye,
  EyeOff,
  FileInput,
  MapIcon,
  Target,
  Upload,
} from 'lucide-react'

import { exportEnvAction, importEnvAction, saveSettingsAction } from '@/app/actions'
import { CATEGORY_META, SETTING_DEFINITIONS, type SettingCategory } from '@/lib/settings'
import type { StoredSetting } from '@/lib/store'
import { cn, maskValue } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

import { PanelHeader } from './shared'
import { PrGatewayCard } from './PrGatewayCard'
import { SetupDiagnostic } from './SetupDiagnostic'
import { SyncSourceProbe } from './SyncSourceProbe'

const CATEGORY_ICONS: Record<SettingCategory, React.ComponentType<{ className?: string }>> = {
  database: Database,
  sync: Cloud,
  ai: Brain,
  map: MapIcon,
  goals: Target,
  analytics: BarChart3,
}

const CATEGORY_ORDER: SettingCategory[] = ['database', 'sync', 'ai', 'map', 'goals', 'analytics']

export function SettingsPanel({ settings }: { settings: StoredSetting[] }) {
  const { success, error: toastError } = useToast()
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

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <PanelHeader
        title="配置管理"
        description={`${stats.configured}/${stats.total} 已配置 · ${stats.secrets} 个密钥`}
        action={
          <button
            type="button"
            onClick={() => { const f = document.getElementById('settings-form') as HTMLFormElement | null; f?.requestSubmit() }}
            disabled={saving}
            className="pr-btn pr-btn-primary"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        }
      />

      <SetupDiagnostic />

      <PrGatewayCard />

      {/* 分类是一级导航,当前项用字重 + 下划线,不做成一排实心按钮 */}
      <div className="flex gap-5 overflow-x-auto border-b pb-3" style={{ borderColor: 'var(--pr-line)' }}>
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
              aria-current={activeCategory === cat ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap text-xs transition-colors',
                activeCategory === cat
                  ? 'font-medium text-foreground underline underline-offset-4'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
              <span className="opacity-70">{configured}/{catSettings.length}</span>
            </button>
          )
        })}
      </div>

      <p className="text-muted-foreground text-sm">{activeMeta.description}</p>

      {activeCategory === 'sync' && <SyncSourceProbe />}

      <form id="settings-form" action={saveAction} className="bg-card rounded-lg border shadow-sm overflow-hidden">
        {activeDefinitions.map(def => {
          const setting = settingsByKey.get(def.key)
          // Reason: 未配置键的库层 value 已改为空串,UI 回显默认值需显式回落 defaultValue
          const value = setting?.exists ? setting.value : (def.defaultValue ?? '')
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
                    className="pr-field h-10 w-full px-3 text-sm outline-none">
                    {def.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={def.key} name={`setting:${def.key}`} type={inputType}
                    inputMode={def.kind === 'number' ? 'numeric' : undefined}
                    defaultValue={value}
                    placeholder={def.kind === 'password' && value && !visible ? maskValue(value) : def.placeholder}
                    className={cn('pr-field h-10 w-full px-3 text-sm outline-none', def.kind === 'password' && 'pr-11')} />
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
          <h3 className="pr-title mb-3 flex items-center gap-2"><FileInput className="h-3.5 w-3.5" />导入 .env</h3>
          <form action={importAction} className="space-y-3">
            <textarea name="envText" rows={4} placeholder="DATABASE_URL=libsql://..."
              className="pr-field pr-scroll w-full resize-none p-3 font-mono text-xs outline-none" />
            <button type="submit" disabled={importing}
              className="pr-btn pr-btn-primary w-full">
              <Upload className="h-3.5 w-3.5" />{importing ? '导入中...' : '导入'}
            </button>
          </form>
        </div>

        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="pr-title flex items-center gap-2"><Clipboard className="h-3.5 w-3.5" />导出 .env</h3>
            <button type="button" onClick={handleExport} disabled={exporting}
              className="pr-btn h-8 text-xs">
              {exporting ? '生成中...' : '生成'}
            </button>
          </div>
          <textarea value={exportText} readOnly rows={4} placeholder="点击生成后显示"
            className="pr-field pr-scroll w-full resize-none p-3 font-mono text-xs outline-none" />
        </div>
      </div>
    </div>
  )
}
