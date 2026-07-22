# Component Guidelines

> How components are built in this repo. The canonical template for a new dashboard panel is `src/app/dashboard/components/SchedulerPanel.tsx` (fetch + loading + error banner + toast + inline edit); `ABTestConfigPanel.tsx` adds the two-step delete.

---

## Server vs Client

- `'use client'` is **line 1** of every interactive component file (29/33 tsx). The only server files are `src/app/layout.tsx` and the 3 thin page shells (`/`, `/login`, `/monitor`) — see directory-structure.md for the shell shape.
- `src/app/pr/page.tsx` is a deliberate client-only island with its own brand system, inline SVG icons, and scoped dark mode. **Do not generalize its patterns to dashboard work, and do not leak dashboard tokens into it** — its component JSDoc (`src/app/pr/page.tsx:65`) scopes the brand to `--pr-*` vars「不依赖全局 shadcn 令牌」; the don't-generalize direction is this spec's rule.

## Component Shape

- `export function Xxx()` named function declarations; `export default` only where Next.js requires it (layout + pages). No `React.FC`, no `React.memo`, no class components (all 0 uses).
- Multiple related components per file is normal (`shared.tsx` holds 6, `MonitorDashboard.tsx` 4). File ordering: `'use client'` → imports (react, lucide-react, `@/lib`, `@/components`, then relative `./`) → interfaces/types → module-level const maps (`CRON_PRESETS`, `VARIANT_STYLE`) → main exported component → private helper subcomponents at the bottom. Long multi-component files use `// ─── Section ───` dividers.
- Props are typed **inline as an anonymous object type destructured in the signature**; a named `XxxProps` interface is reserved for top-level view components (`DashboardViewProps`, `MonitorDashboardProps` are the only two):

```tsx
// src/app/dashboard/components/shared.tsx
export function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: string; accent?: 'green' | 'red'
}) {
```

## Styling

- Tailwind utility classes only — 0 CSS modules, 0 styled-components. The single stylesheet is `src/styles/globals.css` (Tailwind v4 CSS-first; tokens in `@theme inline`, no tailwind.config file).
- `cn()` (`twMerge(clsx(...))` from `src/lib/utils.ts`) is for **conditional/variant merging only**; static class lists stay plain string literals.
- Color language: shadcn-style semantic tokens for chrome (`bg-card` 65×, `text-muted-foreground` 182×, `bg-background`, `bg-primary`), raw Tailwind palette for status — emerald=success, red=error, amber=warning, blue=info, usually as `bg-{color}-50 text-{color}-700` badges.
- Recurring idioms: card `bg-card rounded-lg border p-4 shadow-sm`; panel header `sticky top-0 z-30 bg-background/95 backdrop-blur border-b` (verbatim in 6 panels); button primary `bg-primary text-primary-foreground hover:bg-primary/90`, outline `bg-background hover:bg-accent border`.
- The dashboard is **light-only**: 0 `dark:` classes; `html { color-scheme: light }`. The `data-theme` script and `tailwindcss-uikit-colors` import are dormant infrastructure — don't assume dark mode works, and don't use the uikit iOS palette classes (0 current usages).

## Icons

`lucide-react` named imports (25/33 files). Size via className, not the `size` prop: `h-4 w-4` default, `h-3 w-3` / `h-3.5 w-3.5` in small buttons, `h-5 w-5` for logo marks. Busy state = `animate-spin` on `RefreshCw`/`Loader2`. Pass icons as props typed `React.ComponentType<{ className?: string }>`.

## Loading / Error / Empty

- Loading: early-return the shared spinner — `if (loading) return <LoadingState />` (`src/app/dashboard/components/shared.tsx:95`); collapsed sub-panels use `<CollapsibleSkeleton />`. Don't re-declare private copies (AnalyticsPanel's duplicate is legacy).
- Load failure: red inline banner `rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900`, message template `` `加载X失败 (HTTP ${res.status})` ``, optionally a 重试 button (`src/app/dashboard/DashboardView.tsx:143`).
- Empty list: muted text row `暂无X。` (`text-muted-foreground px-4 py-6 text-sm`) — never illustrations or empty-state components.

## Interactivity

- Native `<button>` with explicit `type="button"` (62×; `type="submit"` only inside real forms).
- Destructive actions use **inline two-step confirm** — first click swaps the icon for 确认删除/取消 buttons held in a `confirmingDelete` state (`src/app/dashboard/components/ABTestConfigPanel.tsx:186`). `window.confirm()` is never used (0/33).
- Mutation feedback via the in-house toast: `const { success, error: toastError } = useToast()` — the `error: toastError` rename is universal (5/5 consumer files). `success('已保存')` / `` toastError(`保存失败 (HTTP ${res.status})`) ``.
- Forms split by channel: settings/auth use server actions with **uncontrolled** inputs (`defaultValue` + `name="setting:KEY"`, `src/app/dashboard/components/SettingsPanel.tsx`); panel CRUD uses **controlled** draft objects in useState (`SchedulerPanel.tsx`).

## Accessibility

Semantic HTML is the baseline (real `<button>`/`<section>`/`<header>`/`<form>`). aria usage is concentrated in 4 islands — copy them when building similar widgets: `LoginForm.tsx` (`aria-invalid`/`aria-describedby`/`role="alert"`), `toast.tsx` (`role="status" aria-live="polite"`), AnalyticsPanel's ExportMenu (`aria-haspopup`/`aria-expanded`/`role="menu"` + Esc + outside-click), pr page icon buttons (`aria-label`). Icon-only dashboard buttons mostly rely on `title=` — at minimum keep that.

## Copy & Locale

All UI copy is hardcoded Simplified Chinese with technical terms in English (Cron, HTTP, Heap); no i18n layer; `html lang="zh-CN"`; dates via `formatDateTime()` from `src/lib/utils.ts` (zh-CN locale).

## Common Mistakes (seen in this repo — don't repeat)

- Re-declaring shared things locally: duplicate `LoadingState` (AnalyticsPanel), duplicate `ActivityStats` interface (OverviewPanel + ActivitiesPanel), two different `ServiceCard`s (shared.tsx vs MonitorDashboard.tsx). Import from `./shared` / `@/lib` types instead.
- `MemoryPanel.tsx` styles itself for a dark surface (`text-white/80`, `bg-white/[0.03]`) inside a light `bg-card` container — broken contrast; stick to semantic tokens.
- `window.alert()` for errors (2 legacy sites in pr/page.tsx) — use toast.
- Growing a panel past 500 lines (ActivitiesPanel at 822 is debt, not license).
