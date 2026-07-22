# State Management

> There is no state library and no server-cache layer — by design. State is React built-ins: `useState` per component, props down, one Context for toasts. Before adding any state dependency (React Query, zustand, jotai…), stop: the codebase has deliberately avoided all of them.

---

## State Categories

| Category | Where it lives | Evidence |
|----------|----------------|----------|
| Server data (per panel) | `useState<Data \| null>(null)` + inline `fetchX` (see hook-guidelines.md) | 22 fetching components |
| Cross-tab shared data | Lifted into `DashboardView`'s useState, passed down as props (`stats`/`syncStatus`/`monitor` → Overview/Activities/Monitor panels) | `src/app/dashboard/DashboardView.tsx:44-49` |
| Global UI state | **One** Context: `ToastContext` (`src/components/ui/toast.tsx`), provider mounted once in root layout, consumed via `useToast()` | the only `createContext` in src/ |
| Tab / filter state | Plain `useState` (`useState<Tab>('overview')`, settings category, analytics day-range) — **not** in the URL | `DashboardView.tsx:44`; 0 uses of `useSearchParams`/`useRouter`/`usePathname` |
| Form state | Controlled draft objects in useState (panel CRUD) vs uncontrolled `defaultValue` (server-action forms) | `SchedulerPanel.tsx` vs `SettingsPanel.tsx` |

URL state is a deliberate absence: tabs and filters reset on reload and are not deep-linkable. Keep it that way unless a real deep-link requirement lands — then use `useSearchParams` consistently, not `window.location` hacks (the only URL manipulation today is pr/page.tsx stripping its `?t=` token via `history.replaceState`).

## Server State Lifecycle

1. **First paint**: the route's server shell fetches from lib and passes `initialData` props (`src/app/monitor/page.tsx` → `MonitorDashboard initialData={data}`; `/` passes `settings` from `listSettings()`).
2. **After hydration**: all further reads go through client `fetch('/api/...', { cache: 'no-store' })` into useState.
3. **Freshness**: `setInterval` polling (10–60s, 7 files) + manual refresh buttons. No cache invalidation layer exists.
4. **After mutation**: full re-fetch — `await fetchX()` right after a successful write. No optimistic updates in the dashboard (the pr chat page is the only optimistic/streaming UI: optimistic message append + hand-parsed SSE + AbortController, `src/app/pr/page.tsx:253-355` — an island, don't generalize).

## Mutations: Two Channels, Pick by Feature Area

- **Server actions** (`src/app/actions.ts`, the only `'use server'` file: login/logout/saveSettings/importEnv/exportEnv): wired with `<form action={...}>` + `useActionState` → `[state, action, pending]`; the action calls `revalidatePath('/')` so server-fetched props refresh; client toasts from a useEffect deduped by a `savedAt` timestamp in a useRef (`src/app/dashboard/components/SettingsPanel.tsx:48-71`). Use for settings-like whole-form saves and auth.
- **fetch CRUD** (everything else — Scheduler/Memory/PrReviews/ABTestConfig/Activities panels): `fetch` with method + JSON body → `res.ok` check → toast success/error → `await fetchX()` refetch. A `saving`/`busyId` state disables buttons in flight (`src/app/dashboard/components/SchedulerPanel.tsx:78-120`).

Don't mix channels within one feature; panel CRUD never uses server actions today.

## Auth State

- Admin session = cookie (`runpaceflow_admin_session`, `src/lib/auth.ts`), set/cleared by the login/logout server actions (the UI path) and by the programmatic `/api/auth/login|logout` routes. No `middleware.ts` — every server page repeats the `isAuthenticated()` + `redirect('/login')` gate. Admin API routes wrap in `withAuth` (401 `{ error }`; 44 of 61 routes); the other 17 are deliberate exceptions — public analytics ingestion/polling (`/api/analytics/track|public|widget|realtime|summary|insights`), `/api/health*`, `/api/strava/webhook`, `/api/auth/login|logout`, `/api/settings/export|import` (separate export Bearer token), and `/api/pr/*` (pr chat Bearer token).
- Dashboard client fetches do **not** special-case 401 (an expired session just falls into the generic error path until reload). Only `/pr` checks `r.status === 401` because it authenticates with a Bearer token from localStorage (`pr_chat_token`) instead of the cookie.

## When to Add Global State

The bar is high — one Context in the whole repo. Add a new Context only when ≥3 components across different subtrees need the same client state and prop-drilling through `DashboardView` is demonstrably worse. Reach for an external store only with an explicit team decision recorded in this spec.

## Common Mistakes

- Adding React Query/SWR "to clean up fetching" — the repo's contract is the inline idiom; a second data layer would split the codebase in two.
- Optimistic updates in dashboard panels — the pattern is refetch-after-write; optimism exists only in the pr chat island.
- Storing tab/filter state in the URL ad hoc — currently nothing does; introduce it as a decision, not a drive-by.
