# Quality Guidelines

> The entire automated quality story is `bun run lint && bun run type-check` — there are no tests, no CI, no formatter. Both gates are green today; every task must leave them green. Everything else below is enforced by convention, so match it exactly.

---

## Gates & Tooling Reality

- `bun run lint` = `eslint .` with a 5-line flat config extending only `eslint-config-next/core-web-vitals` (`eslint.config.mjs`) — zero custom rules. `bun run type-check` = `tsc --noEmit`. Run both before finishing any task (`.trellis/workflow.md` mandates it).
- **No tests exist** (0 `*.test.*`/`*.spec.*` in the repo; the `playwright` dependency is a runtime scraping tool, not a test runner; `scripts/eval` is the PR-agent eval harness, not UI tests). **No CI** (no `.github/`). Don't claim test coverage; don't scaffold a test setup as a drive-by.
- **No formatter** (no Prettier/husky/.editorconfig), yet style is 100% uniform: single quotes, no semicolons, 2-space indent (162/162 import-bearing src files). Match by imitation — a PR that flips quote style is a bug.
- Package manager is bun (`packageManager: bun@1.3.1`); framework is pre-release (next 16 canary, react 19 RC) — expect occasional canary quirks, pin-bumps are deliberate.

## Forbidden in UI Code (all census-verified at 0 today — keep them at 0)

| Pattern | Status | Use instead |
|---------|--------|-------------|
| `console.*` in tsx | 0/33 files | toast (`useToast`) or `loadError` state; server lib may log |
| `window.confirm()` | 0 | inline two-step confirm (component-guidelines.md) |
| `window.alert()` | 2 legacy sites in pr/page.tsx | toast |
| `@ts-ignore` / `@ts-expect-error` | 0 | fix the type |
| TODO/FIXME/HACK markers, commented-out code | 0 | do it or delete it |
| `React.FC`, `React.memo`, class components | 0 | plain `export function` |
| CSS modules / styled-components / inline `style=` for theming | 0 (pr island excepted) | Tailwind classes |
| New `eslint-disable` outside pr/page.tsx | 0 in the other 32 files | fix the cause; pr/page.tsx holds all 10 existing suppressions |

## Required Patterns

- **Error surfacing** (the one place the codebase is mid-migration — new code goes the new way): mutation failures always toast with status/`instanceof Error` message; load failures set a `loadError`/`statsError` string rendered as the red banner. The empty `catch {}` swallowing in ~12 older read-only panels is legacy — `DashboardView.tsx:67`'s `// Reason:` comment marks the migration intent. Never add a new silent swallow.
- **Toast destructure** is verbatim `const { success, error: toastError } = useToast()` (5/5 consumer files).
- **`cn()`** for conditional classes; semantic token classes for chrome; status colors via the emerald/red/amber/blue `-50`/`-700` recipe.
- **Intervals always cleared** in effect cleanup (7/7 polling files comply).
- **Fire-and-forget promises** prefixed with `void `.
- **File ≤500 lines** (2 legacy tsx violations — `ActivitiesPanel.tsx`, `pr/page.tsx` — are debt, not license; oversized `src/lib` files are the backend spec's ledger).

## Comments

Sparse and purposeful (~1.6% of tsx lines): **Chinese comments**, `// Reason:` prefix for non-obvious decisions (12 in tsx, 95 across src), JSDoc only on exported shared utilities, `// ─── Section ───` dividers in multi-component files. Docs (like this spec) are English — that split is stated in `.trellis/spec/backend/index.md` and holds repo-wide.

## Layout & Responsiveness

Mobile-first Tailwind with a narrow breakpoint vocabulary: `sm:` (68×), `lg:` (40×), and `min-[520px]:` (24× — exclusively the sidebar→topbar collapse in DashboardView/MonitorDashboard). `md:`/`xl:`/`2xl:` are never used — stay within the existing set. Grids: `grid gap-4 sm:grid-cols-3` style.

## Security Posture

- `dangerouslySetInnerHTML`: exactly 1, the static hardcoded theme script in `src/app/layout.tsx` — never with dynamic data.
- `target="_blank"` always pairs with `rel="noopener noreferrer"` (1/1 compliant).
- **No `process.env` / `NEXT_PUBLIC_*` reads in client code** (0 today; the `NEXT_PUBLIC_*` strings in `src/lib/settings.ts` are DB settings-registry key names for the main site, not env reads). Client-visible config arrives via server-shell props or `/api`.
- The pr page keeps its token in localStorage + `?t=` param — an accepted island decision, not a pattern.

## Performance Idioms

No `next/image` (7 raw `<img>` all in pr/page.tsx, each individually eslint-suppressed for token-authed URLs), no `next/dynamic`/`React.lazy`, no chart library (charts are hand-rolled divs, `AnalyticsCharts.tsx`). Freshness via polling, memoization only where an effect dep demands it. This is a low-traffic admin — don't optimize speculatively.

## Review Checklist

1. `bun run lint` and `bun run type-check` both exit 0.
2. Failures surfaced (toast/banner) — no new empty `catch {}`.
3. Style matched: single quotes, no semicolons, semantic tokens, `cn()` for conditionals, Chinese UI copy.
4. No entries added to the Forbidden table; no new eslint suppressions.
5. New panel follows the SchedulerPanel/MemoryPanel shape; file ≤500 lines; intervals cleaned up.
6. Any deviation from this spec is called out in the task notes, not slipped in.
