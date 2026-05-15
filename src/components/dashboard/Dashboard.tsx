'use client'

import {
  Activity,
  Brain,
  CheckCircle2,
  CircleAlert,
  Clipboard,
  Cloud,
  Database,
  Eye,
  EyeOff,
  FileInput,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapIcon,
  Save,
  ServerCog,
  ShieldCheck,
  Target,
  Upload,
} from 'lucide-react'
import { useActionState, useMemo, useState, useTransition } from 'react'

import { exportEnvAction, importEnvAction, logoutAction, saveSettingsAction } from '@/app/actions'
import { CATEGORY_META, SETTING_DEFINITIONS, type SettingCategory } from '@/lib/settings'
import type { StoredSetting } from '@/lib/store'
import { cn, formatDateTime, maskValue } from '@/lib/utils'

const CATEGORY_ICONS: Record<SettingCategory, React.ComponentType<{ className?: string }>> = {
  database: Database,
  sync: Cloud,
  ai: Brain,
  map: MapIcon,
  goals: Target,
  runtime: ServerCog,
}

const CATEGORY_ORDER: SettingCategory[] = ['database', 'sync', 'ai', 'map', 'goals', 'runtime']

interface DashboardProps {
  settings: StoredSetting[]
}

export function Dashboard({ settings }: DashboardProps) {
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('database')
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})
  const [exportText, setExportText] = useState('')
  const [importState, importAction, importing] = useActionState(importEnvAction, null)
  const [saving, startSaveTransition] = useTransition()
  const [exporting, startExportTransition] = useTransition()

  const settingsByKey = useMemo(
    () => new Map(settings.map((setting) => [setting.key, setting])),
    [settings],
  )

  const stats = useMemo(() => {
    const configured = settings.filter((setting) => setting.exists && setting.value !== '').length
    const secrets = settings.filter(
      (setting) => setting.exists && setting.isSensitive && setting.value !== '',
    ).length
    const tursoReady = Boolean(settingsByKey.get('DATABASE_URL')?.value.startsWith('libsql://'))

    return { configured, secrets, total: settings.length, tursoReady }
  }, [settings, settingsByKey])

  const activeDefinitions = SETTING_DEFINITIONS.filter(
    (definition) => definition.category === activeCategory,
  )

  const activeMeta = CATEGORY_META[activeCategory]
  const TursoStatusIcon = stats.tursoReady ? CheckCircle2 : CircleAlert

  function handleExport() {
    startExportTransition(async () => {
      setExportText(await exportEnvAction())
    })
  }

  return (
    <div className="bg-muted/40 text-foreground min-h-dvh min-[520px]:pl-60">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border border-b min-[520px]:fixed min-[520px]:inset-y-0 min-[520px]:left-0 min-[520px]:z-40 min-[520px]:flex min-[520px]:w-60 min-[520px]:flex-col min-[520px]:border-r min-[520px]:border-b-0">
        <div className="border-sidebar-border flex h-16 items-center gap-3 border-b px-4">
          <span className="bg-primary text-primary-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">RunPaceFlow Admin</h1>
            <p className="text-muted-foreground truncate text-xs">配置中心控制台</p>
          </div>
        </div>

        <div className="scrollbar-subtle min-[520px]:flex-1 min-[520px]:overflow-y-auto">
          <div className="border-sidebar-border border-b p-4">
            <dl className="border-border bg-card grid grid-cols-2 divide-x overflow-hidden rounded-lg border">
              <Metric label="已配置" value={`${stats.configured}/${stats.total}`} />
              <Metric label="密钥项" value={stats.secrets} />
            </dl>
            <div
              className={cn(
                'mt-3 flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm',
                stats.tursoReady
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900',
              )}
            >
              <TursoStatusIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">
                {stats.tursoReady ? 'Turso/libSQL 已就绪' : '数据库未指向 Turso'}
              </span>
            </div>
          </div>

          <nav className="space-y-1 p-3">
            {CATEGORY_ORDER.map((category) => {
              const Icon = CATEGORY_ICONS[category]
              const meta = CATEGORY_META[category]
              const categorySettings = settings.filter(
                (setting) =>
                  SETTING_DEFINITIONS.find((definition) => definition.key === setting.key)
                    ?.category === category,
              )
              const configured = categorySettings.filter(
                (setting) => setting.exists && setting.value !== '',
              ).length

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={cn(
                    'flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm transition-colors',
                    activeCategory === category
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {configured}/{categorySettings.length}
                  </span>
                </button>
              )
            })}
          </nav>
        </div>

        <div className="border-sidebar-border border-t p-3">
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="flex min-h-16 flex-col justify-center gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">{activeCategory}</p>
            <h2 className="truncate text-xl font-semibold">{activeMeta.label}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge icon={ShieldCheck} label={`${stats.secrets} 个密钥`} />
            <StatusBadge icon={ServerCog} label={`${stats.configured}/${stats.total} 已配置`} />
            <button
              type="button"
              onClick={() => {
                const form = document.getElementById('settings-form') as HTMLFormElement | null
                if (!form) return
                startSaveTransition(() => {
                  form.requestSubmit()
                })
              }}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </header>

      <main className="grid gap-6 px-4 py-6 sm:px-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-muted-foreground text-sm">{activeMeta.description}</p>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <KeyRound className="h-4 w-4" />
              <span>{activeDefinitions.length} 个配置项</span>
            </div>
          </div>

          <form
            id="settings-form"
            action={saveSettingsAction}
            className="bg-card text-card-foreground overflow-hidden rounded-lg border shadow-sm"
          >
            <div className="bg-muted/50 text-muted-foreground hidden border-b px-4 py-2 text-xs md:grid md:grid-cols-[minmax(210px,0.85fr)_minmax(260px,1fr)_150px] md:gap-4">
              <span>配置项</span>
              <span>当前值</span>
              <span className="text-right">状态</span>
            </div>

            {activeDefinitions.map((definition) => {
              const setting = settingsByKey.get(definition.key)
              const value = setting?.value ?? definition.defaultValue ?? ''
              const visible = visibleSecrets[definition.key]
              const inputType =
                definition.kind === 'password' && !visible
                  ? 'password'
                  : definition.kind === 'number'
                    ? 'number'
                    : 'text'

              return (
                <div
                  key={definition.key}
                  className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[minmax(210px,0.85fr)_minmax(260px,1fr)_150px] md:items-center md:gap-4"
                >
                  <div className="min-w-0">
                    <label htmlFor={definition.key} className="text-sm font-medium">
                      {definition.label}
                    </label>
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      {definition.description}
                    </p>
                    <code className="text-muted-foreground mt-2 block truncate font-mono text-xs">
                      {definition.key}
                    </code>
                  </div>

                  <div className="relative min-w-0">
                    {definition.kind === 'select' ? (
                      <select
                        id={definition.key}
                        name={`setting:${definition.key}`}
                        defaultValue={value}
                        className="border-input bg-background focus:border-ring focus:ring-ring/20 h-10 w-full rounded-md border px-3 text-sm shadow-sm outline-none transition-colors focus:ring-[3px]"
                      >
                        {definition.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={definition.key}
                        name={`setting:${definition.key}`}
                        type={inputType}
                        inputMode={definition.kind === 'number' ? 'numeric' : undefined}
                        defaultValue={value}
                        placeholder={
                          definition.kind === 'password' && value && !visible
                            ? maskValue(value)
                            : definition.placeholder
                        }
                        className={cn(
                          'border-input bg-background placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20 h-10 w-full rounded-md border px-3 text-sm shadow-sm outline-none transition-colors focus:ring-[3px]',
                          definition.kind === 'password' && 'pr-11',
                        )}
                      />
                    )}

                    {definition.kind === 'password' && (
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleSecrets((prev) => ({
                            ...prev,
                            [definition.key]: !prev[definition.key],
                          }))
                        }
                        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                        aria-label={visible ? '隐藏密钥' : '显示密钥'}
                      >
                        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs md:block md:text-right">
                    <span className="md:hidden">状态</span>
                    <span>{setting?.updatedAt ? formatDateTime(setting.updatedAt) : '默认值'}</span>
                  </div>
                </div>
              )
            })}
          </form>
        </section>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="bg-card text-card-foreground rounded-lg border p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileInput className="h-4 w-4" />
              导入 .env
            </h3>
            <form action={importAction} className="space-y-3">
              <textarea
                name="envText"
                rows={6}
                placeholder="DATABASE_URL=libsql://..."
                className="border-input bg-background placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20 scrollbar-subtle w-full resize-none rounded-md border p-3 font-mono text-xs shadow-sm outline-none transition-colors focus:ring-[3px]"
              />
              {importState?.message && (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  {importState.message}
                </p>
              )}
              <button
                type="submit"
                disabled={importing}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 w-full items-center justify-center gap-2 rounded-md text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {importing ? '导入中...' : '导入'}
              </button>
            </form>
          </section>

          <section className="bg-card text-card-foreground rounded-lg border p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Clipboard className="h-4 w-4" />
                导出 .env
              </h3>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="bg-background hover:bg-accent hover:text-accent-foreground flex h-8 items-center gap-2 rounded-md border px-3 text-xs shadow-sm transition-colors disabled:opacity-50"
              >
                <Clipboard className="h-4 w-4" />
                {exporting ? '生成中...' : '生成'}
              </button>
            </div>
            <textarea
              value={exportText}
              readOnly
              rows={8}
              placeholder="点击生成后显示 .env 内容"
              className="border-input bg-background placeholder:text-muted-foreground scrollbar-subtle w-full resize-none rounded-md border p-3 font-mono text-xs shadow-sm outline-none"
            />
          </section>

          <section className="bg-card text-card-foreground rounded-lg border p-4 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" />
              部署接入
            </h3>
            <div className="text-muted-foreground mt-3 space-y-3 text-sm">
              <p>
                通过
                <code className="bg-muted text-foreground mx-1 rounded px-1 py-0.5">
                  /api/settings/export
                </code>
                生成主应用环境文件。
              </p>
              <pre className="bg-muted/50 text-foreground scrollbar-subtle max-w-full overflow-x-auto rounded-md border p-3 text-xs">
{`curl -fsSL \\
  -H "Authorization: Bearer $CONFIG_EXPORT_TOKEN" \\
  https://admin.example.com/api/settings/export \\
  > .env.production`}
              </pre>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function StatusBadge({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <span className="bg-background text-muted-foreground hidden h-9 items-center gap-2 rounded-md border px-3 text-xs shadow-sm sm:flex">
      <Icon className="h-4 w-4" />
      {label}
    </span>
  )
}
