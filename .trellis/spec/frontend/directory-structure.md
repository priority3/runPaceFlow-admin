# Directory Structure

> How frontend code is organized in this repo. Evidence-based from the working tree (33 .tsx files); follow these layouts instead of inventing new ones.

---

## Top-Level Layout

```
src/
├── app/          # routes, API routes, and feature-colocated UI
│   ├── actions.ts            # the ONLY 'use server' actions file (login/logout/settings)
│   ├── layout.tsx            # single root layout (no nested layouts)
│   ├── page.tsx              # '/' server shell → renders dashboard/DashboardView
│   ├── login/  monitor/  pr/ # other page routes
│   ├── dashboard/            # component home for '/', has NO page.tsx of its own
│   │   ├── DashboardView.tsx
│   │   └── components/       # ~24 panel components
│   └── api/                  # 61 route.ts files, kebab-case dirs
├── components/   # cross-page reusables ONLY (2 files: login/LoginForm.tsx, ui/toast.tsx)
├── lib/          # server-side logic; UI imports it as types + @/lib/utils
├── styles/       # globals.css (the single stylesheet)
└── types/        # vestigial for UI — no tsx imports it; don't add UI types here
```

There is **no `src/hooks/`, no `src/utils/`, no barrel files** (the only `index.ts` is `src/lib/sync/index.ts`, internal to lib). Don't create them.

## Route Anatomy

A page route is a thin **async server shell**: auth-gate, optionally fetch initial data, render one client view component (3/4 routes: `/`, `/login`, `/monitor`; the view is colocated in `src/app` for `/` and `/monitor`, while `/login` renders the cross-page `src/components/login/LoginForm.tsx`). `/monitor` additionally sets `export const dynamic = 'force-dynamic'`:

```tsx
// src/app/monitor/page.tsx
export default async function MonitorPage() {
  if (!(await isAuthenticated())) redirect('/login')
  const data = await getMonitorData()
  return <MonitorDashboard initialData={data} />
}
```

Known exception: `src/app/pr/page.tsx` is a client-only mobile H5 chat page with its own token auth — a deliberate island, not a template.

Deliberately absent (don't introduce without a decision): `loading.tsx`, `error.tsx`, `not-found.tsx`, `template.tsx`, `middleware.ts`, route groups `(group)`, nested layouts. Loading/error states are hand-rolled per component (`src/app/dashboard/components/shared.tsx`). Dynamic segments (`[id]`) exist only under `src/app/api/`.

## Feature Colocation

Feature UI lives **next to its route in `src/app`**, not in `src/components`:

- Dashboard capability → one new `<Name>Panel.tsx` in `src/app/dashboard/components/` + a wiring edit in its **parent panel** — usually an existing top-level panel (`AnalyticsPanel`/`OverviewPanel`/`SettingsPanel`/`PrPanel`) — + its backing `src/app/api/` route. Edit `DashboardView.tsx` only when adding a new top-level tab (7 exist; just 2 of the 13 panel-adding commits ever touched it — sub-panels nest under parents).
- Standalone surface → new route dir with `page.tsx` (+ lib modules), e.g. `src/app/pr/`.
- `src/components/` is reserved for genuinely cross-page pieces; the bar is high (2 files in the whole repo).

## Naming

- Components: `PascalCase.tsx`, filename = the single named export (`OverviewPanel.tsx` → `export function OverviewPanel`). 0 kebab-case or camelCase .tsx files exist.
- Framework entries stay lowercase: `page.tsx`, `layout.tsx`, `route.ts`, `actions.ts`.
- Multi-export utility tsx modules are lowercase single words: `shared.tsx`, `toast.tsx`.
- `src/lib` .ts files: lowercase, kebab-case when multi-word (`api-helpers.ts`, `dashboard-stats.ts`).
- Known deviation (don't copy): `AnalyticsCharts.tsx` exports ten components (nine `*Section` + `HourlyHeatMap`) instead of matching its filename.

## Imports

- `@/` alias (→ `./src/`) for anything outside the current subtree; relative `./` for same-dir siblings (`./shared` is imported 19× by panels).
- Client components import server lib **as `import type` only**; their sole runtime lib imports are `@/lib/utils` (`cn`, `formatDateTime`) and constant tables from `@/lib/settings`. Real data access stays in server shells or `/api` fetches.

## File Length

House ceiling is 500 lines per file. Two legacy violations are tracked debt, not precedent: `src/app/dashboard/components/ActivitiesPanel.tsx` (822) and `src/app/pr/page.tsx` (756). Everything else is ≤483 — split before you cross the line.

## Reference Files

- `src/app/monitor/page.tsx` + `src/app/monitor/MonitorDashboard.tsx` — server shell → client view pair
- `src/app/dashboard/components/MemoryPanel.tsx` — canonical new-panel shape
- `src/app/dashboard/DashboardView.tsx` — panel registration/wiring
- `src/app/actions.ts` — the single server-actions module
