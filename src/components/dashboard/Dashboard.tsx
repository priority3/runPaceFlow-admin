'use client'

import {
  Activity,
  Brain,
  CheckCircle2,
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

  function handleExport() {
    startExportTransition(async () => {
      setExportText(await exportEnvAction())
    })
  }

  return (
    <div className="min-h-dvh bg-[#f5f7f8] text-[#172026] min-[520px]:pl-60">
      <aside className="border-b border-[#2e363d] bg-[#20252b] text-[#e8edf2] min-[520px]:fixed min-[520px]:inset-y-0 min-[520px]:left-0 min-[520px]:z-40 min-[520px]:flex min-[520px]:w-60 min-[520px]:flex-col min-[520px]:border-r min-[520px]:border-b-0">
        <div className="flex h-16 items-center gap-3 border-b border-[#2e363d] px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2f4b50] text-[#6ee7d8]">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">RunPaceFlow Admin</h1>
            <p className="truncate text-xs text-[#9aa6b2]">配置中心控制台</p>
          </div>
        </div>

        <div className="scrollbar-subtle min-[520px]:flex-1 min-[520px]:overflow-y-auto">
          <div className="border-b border-[#2e363d] p-4">
            <dl className="grid grid-cols-2 divide-x divide-[#2e363d] overflow-hidden rounded-lg border border-[#2e363d]">
              <Metric label="已配置" value={`${stats.configured}/${stats.total}`} />
              <Metric label="密钥项" value={stats.secrets} />
            </dl>
            <div
              className={cn(
                'mt-3 flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm',
                stats.tursoReady
                  ? 'bg-[#173b35] text-[#99f6df]'
                  : 'bg-[#49351d] text-[#ffd28a]',
              )}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
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
                    'flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition',
                    activeCategory === category
                      ? 'bg-[#2a3f45] text-[#d8fbf3]'
                      : 'text-[#b8c2cc] hover:bg-[#293039] hover:text-white',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[#8e9aa5]">
                    {configured}/{categorySettings.length}
                  </span>
                </button>
              )
            })}
          </nav>
        </div>

        <div className="border-t border-[#2e363d] p-3">
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-[#b8c2cc] transition hover:bg-[#293039] hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-[#dbe1e6] bg-white/90 backdrop-blur-xl">
        <div className="flex min-h-16 flex-col justify-center gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="text-xs text-[#65717c]">{activeCategory}</p>
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
              className="flex h-9 items-center gap-2 rounded-lg bg-[#0f766e] px-3 text-sm font-medium text-white transition hover:bg-[#115e59] disabled:opacity-50"
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
              <p className="text-sm text-[#5d6975]">{activeMeta.description}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#65717c]">
              <KeyRound className="h-4 w-4" />
              <span>{activeDefinitions.length} 个配置项</span>
            </div>
          </div>

          <form
            id="settings-form"
            action={saveSettingsAction}
            className="overflow-hidden rounded-lg border border-[#d7dee4] bg-white"
          >
            <div className="hidden border-b border-[#d7dee4] bg-[#eef2f4] px-4 py-2 text-xs text-[#65717c] md:grid md:grid-cols-[minmax(210px,0.85fr)_minmax(260px,1fr)_150px] md:gap-4">
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
                  className="grid gap-3 border-b border-[#e3e8ec] p-4 last:border-b-0 md:grid-cols-[minmax(210px,0.85fr)_minmax(260px,1fr)_150px] md:items-center md:gap-4"
                >
                  <div className="min-w-0">
                    <label htmlFor={definition.key} className="text-sm font-semibold">
                      {definition.label}
                    </label>
                    <p className="mt-1 text-xs leading-5 text-[#5d6975]">
                      {definition.description}
                    </p>
                    <code className="mt-2 block truncate text-xs text-[#798691]">
                      {definition.key}
                    </code>
                  </div>

                  <div className="relative min-w-0">
                    {definition.kind === 'select' ? (
                      <select
                        id={definition.key}
                        name={`setting:${definition.key}`}
                        defaultValue={value}
                        className="h-10 w-full rounded-lg border border-[#cfd8df] bg-white px-3 text-sm outline-none transition focus:border-[#0f766e] focus:ring-4 focus:ring-[#0f766e]/15"
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
                          'h-10 w-full rounded-lg border border-[#cfd8df] bg-white px-3 text-sm outline-none transition placeholder:text-[#9aa6b2] focus:border-[#0f766e] focus:ring-4 focus:ring-[#0f766e]/15',
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
                        className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-md text-[#798691] transition hover:bg-[#eef2f4] hover:text-[#172026]"
                        aria-label={visible ? '隐藏密钥' : '显示密钥'}
                      >
                        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs text-[#798691] md:block md:text-right">
                    <span className="md:hidden">状态</span>
                    <span>{setting?.updatedAt ? formatDateTime(setting.updatedAt) : '默认值'}</span>
                  </div>
                </div>
              )
            })}
          </form>
        </section>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="rounded-lg border border-[#d7dee4] bg-white p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileInput className="h-4 w-4" />
              导入 .env
            </h3>
            <form action={importAction} className="space-y-3">
              <textarea
                name="envText"
                rows={6}
                placeholder="DATABASE_URL=libsql://..."
                className="scrollbar-subtle w-full resize-none rounded-lg border border-[#cfd8df] bg-white p-3 font-mono text-xs outline-none transition placeholder:text-[#9aa6b2] focus:border-[#0f766e] focus:ring-4 focus:ring-[#0f766e]/15"
              />
              {importState?.message && (
                <p className="rounded-lg bg-[#e7f6ef] px-3 py-2 text-xs text-[#08704f]">
                  {importState.message}
                </p>
              )}
              <button
                type="submit"
                disabled={importing}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#243039] text-sm font-medium text-white transition hover:bg-[#172026] disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {importing ? '导入中...' : '导入'}
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-[#d7dee4] bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Clipboard className="h-4 w-4" />
                导出 .env
              </h3>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="flex h-8 items-center gap-2 rounded-lg border border-[#cfd8df] px-3 text-xs transition hover:bg-[#eef2f4] disabled:opacity-50"
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
              className="scrollbar-subtle w-full resize-none rounded-lg border border-[#cfd8df] bg-white p-3 font-mono text-xs outline-none placeholder:text-[#9aa6b2]"
            />
          </section>

          <section className="rounded-lg border border-[#d7dee4] bg-white p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" />
              部署接入
            </h3>
            <div className="mt-3 space-y-3 text-sm text-[#5d6975]">
              <p>
                通过
                <code className="mx-1 rounded bg-[#eef2f4] px-1 py-0.5 text-[#172026]">
                  /api/settings/export
                </code>
                生成主应用环境文件。
              </p>
              <pre className="scrollbar-subtle max-w-full overflow-x-auto rounded-lg border border-[#d7dee4] bg-[#f4f6f7] p-3 text-xs text-[#28323b]">
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
    <div className="bg-[#252c34] p-3">
      <dt className="text-xs text-[#94a0aa]">{label}</dt>
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
    <span className="hidden h-9 items-center gap-2 rounded-lg border border-[#d7dee4] bg-white px-3 text-xs text-[#5d6975] sm:flex">
      <Icon className="h-4 w-4" />
      {label}
    </span>
  )
}
