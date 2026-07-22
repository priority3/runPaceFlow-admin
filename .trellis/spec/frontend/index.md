# Frontend Development Guidelines

> Conventions for the runpaceflow-admin UI layer, extracted from the real codebase (2026-07-22 audit of all 33 .tsx files). Sub-agents: read the relevant guide before writing frontend code.

---

## Stack Snapshot

Next.js App Router (canary) + React 19 (RC), client-heavy SPA-in-Next: one server shell per route → one big client view with useState tab switching. Tailwind CSS v4 (CSS-first, tokens in `src/styles/globals.css`), `cn()` = clsx+twMerge, lucide-react icons, in-house toast. **No** React Query/SWR/zustand, no tests, no formatter — see the guides for what that implies. Package manager: bun; gates: `bun run lint` + `bun run type-check`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | src layout, route anatomy, feature colocation, naming, imports | Active |
| [Component Guidelines](./component-guidelines.md) | Component shape, styling tokens, icons, loading/error/empty, interactivity, a11y | Active |
| [Hook Guidelines](./hook-guidelines.md) | The inline fetch idiom, mount kickoff, polling, custom-hook bar | Active |
| [State Management](./state-management.md) | State categories, server-state lifecycle, two mutation channels, auth state | Active |
| [Type Safety](./type-safety.md) | Fetch-boundary contract, where types live, narrowing, any-census | Active |
| [Quality Guidelines](./quality-guidelines.md) | Gates, forbidden/required patterns, comments, security, review checklist | Active |

---

## Cross-Cutting Rules

- **Canonical templates**: new dashboard panel → copy the shape of `src/app/dashboard/components/SchedulerPanel.tsx` / `MemoryPanel.tsx`; new page → `src/app/monitor/page.tsx` + `MonitorDashboard.tsx` pair.
- **`src/app/pr/page.tsx` is an island** (own brand system, own auth, own dark mode). Its patterns don't generalize outward, and dashboard patterns don't leak in.
- **Document reality**: these guides describe what the code does, including known debt (500-line violations, silent-catch legacy, duplicated types). Fixing debt is a separate task decision, not a drive-by.

**Language**: documentation in English; inline code comments follow repo convention (Chinese, `// Reason:` for non-obvious choices). UI copy is Simplified Chinese.
