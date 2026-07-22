# Hook Guidelines

> Hook usage in this repo is deliberately plain: useState + useEffect, fetch inline, almost no memoization. Don't import a data-fetching library and don't build a hook layer — match the existing idioms below.

---

## Custom Hooks

There is exactly **one** custom hook in the repo: `useToast`, colocated with its provider in `src/components/ui/toast.tsx` (no `src/hooks/` directory — don't create one). Data-fetch logic is never extracted into hooks; it stays inline in each component as a local async function. The bar for a new custom hook: used by multiple components AND stateful — otherwise keep it a plain function or inline.

## Hook Profile

- `useState` (~109 call-sites in 25 files) and `useEffect` (~30 in 23 files) dominate.
- Memoization is the exception: `useCallback` only to stabilize fetch functions used as effect deps and the toast API; `useMemo` in one file (SettingsPanel). Don't blanket-wrap handlers.
- `useReducer`, `useOptimistic`, `useFormStatus`: 0 uses. `useActionState` (3 sites) and `useTransition` (2) appear only in the server-action forms (LoginForm, SettingsPanel, MonitorDashboard refresh).

## Canonical Data-Fetch Idiom

Every panel loads its own data with a local `fetchX` (see `src/app/dashboard/components/MemoryPanel.tsx:58`):

```tsx
const fetchMemories = async () => {
  setLoading(true)
  try {
    const res = await fetch('/api/pr/memories?status=candidate,active', { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      setMemories(data.memories ?? [])
      setLoadError(null)
    } else setLoadError(`加载记忆失败 (HTTP ${res.status})`)
  } catch (e) { setLoadError(`加载记忆失败: ${e instanceof Error ? e.message : '网络错误'}`) }
  setLoading(false)
}
```

Ingredients: `cache: 'no-store'` (37 of 58 fetch calls), `res.ok` check, typed `useState<Data | null>(null)` payload state, `useState(true)` loading flag, defensive field reads (`data.memories ?? []`), `loadError` string state. API responses are **raw domain JSON with no envelope** (`{ jobs }`, `{ stats }`); errors are `{ error }` + HTTP status from `withAuth` (`src/lib/api-helpers.ts`) — so `res.ok` is the success test.

## Mount Kickoff

Initial fetch runs in a mount-only effect via the deferral idiom (9 files):

```tsx
useEffect(() => {
  void Promise.resolve().then(fetchStats)
  const interval = setInterval(fetchStats, 30000)
  return () => clearInterval(interval)
}, [])
```

The `void Promise.resolve().then(...)` defers the synchronous `setLoading(true)` out of the effect body to satisfy the `react-hooks/set-state-in-effect` lint rule — prefer it over inline `eslint-disable` (pr/page.tsx's disable is the exception, not the pattern).

## Polling & Refresh

- Live panels poll with `setInterval` (10s monitor / 30s dashboard; 7 files) registered in the mount effect and **always cleared in cleanup**.
- Manual refresh buttons just call `fetchX` again; `MonitorDashboard.tsx` wraps manual refresh in `useTransition` for its spinner.
- On polled refreshes, show the spinner **only on first load** — keep rendered data on subsequent ticks (`src/app/dashboard/DashboardView.tsx:52`):

```tsx
// Reason: 仅首次（无数据）显示加载态；30s 轮询时保留已渲染内容，避免概览页周期性闪烁
setStats(prev => {
  if (prev === null) setLoadingStats(true)
  return prev
})
```

## Known Gaps (documented reality, not targets)

- No `AbortController` on dashboard fetches (unmount/tab-switch races are unhandled); only `src/app/pr/page.tsx:91` aborts. If you hit a real stale-response bug, fix it with an abort — don't add speculative cancellation everywhere.
- `SchedulerPanel.tsx:130` sniffs `/api/cron` success from message text with a regex — acknowledged in its `// Reason:` comment as a workaround for that route's inconsistent success signal. Don't replicate for new endpoints; return a proper status field instead.
- Error surfacing is mid-migration: ~12 older read-only panels still swallow with empty `catch {}`; the surfaced-`loadError` style is the intended direction (see quality-guidelines.md). New code must surface.

## Reference Files

- `src/app/dashboard/components/MemoryPanel.tsx` / `SchedulerPanel.tsx` — full canonical panel (fetch, loading, error, toast, refetch)
- `src/app/dashboard/DashboardView.tsx` — polling + first-load-only spinner + retry banner
- `src/components/ui/toast.tsx` — the custom-hook + provider shape, if you ever add hook #2
