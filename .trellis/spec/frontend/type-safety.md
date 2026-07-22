# Type Safety

> `strict: true`, near-zero `any`, no runtime validation at the fetch boundary. The client's payload interfaces ARE the API contract — TypeScript won't catch server drift, so keeping them in sync by hand is part of every API change.

---

## Compiler Setup

- `tsconfig.json`: `strict: true` only — no `noUncheckedIndexedAccess`, no `exactOptionalPropertyTypes`; `skipLibCheck` + `allowJs` on; path alias `@/*` → `./src/*`; `scripts/eval` excluded from type-check (it is still linted).
- Gate: `bun run type-check` (`tsc --noEmit`) must exit clean — it does today; keep it that way.

## Where Types Live

- **Inline in the component file.** Components declare local interfaces for their API payloads and props; the UI never imports from `src/types/` (vestigial — 1 file, used only by `src/lib/activity/naming.ts`).
- **`import type` from lib** when a server shell passes lib data as props — the client view declares an explicit props interface using it (`src/app/monitor/MonitorDashboard.tsx:26` imports the type from `@/lib/monitor`). This is the better existing pattern when a lib type matches; prefer it over re-declaring.
- Server side of that handoff relies on return-type inference; drizzle `$inferSelect` stays behind lib and never reaches tsx.
- Known duplication debt (don't add to it): `ActivityStats` is copied in 3 places (`src/lib/activity/dashboard-stats.ts:7`, `OverviewPanel.tsx`, `ActivitiesPanel.tsx`); two different `MonitorData`/`SyncStatus` definitions coexist. Structural typing hides this until a rename doesn't propagate.

## The Fetch-Boundary Contract

There is **no zod, no typed-fetch helper, no runtime validation** in client code (zod is server-only: `src/app/actions.ts` validates action inputs). The idiom is untyped `res.json()` flowing into a typed setter:

```tsx
// src/app/dashboard/components/MemoryPanel.tsx — the useState generic IS the contract
const [memories, setMemories] = useState<MemoryItem[]>([])
...
const data = await res.json()
setMemories(data.memories ?? [])
```

Consequences you must act on:
- When you change an API route's response shape, **grep for the panels that fetch it and update their local interfaces** — nothing else will catch the drift; it fails silently at render time.
- Defensive field reads (`data.memories ?? []`) are the norm at the boundary.
- Don't introduce a client validation layer to "fix" this — it's a deliberate trade-off; consistency matters more.

## useState Typing

Explicit generic when the initial value can't carry the type — null-initialized payloads, unions, typed arrays (~54% of the 109 call-sites); initializer inference otherwise. Complex one-off payloads may inline the object literal type inside the generic instead of naming an interface (`ActivitiesPanel.tsx:21`).

## Narrowing & Assertions

- `catch` variables stay strict-mode `unknown`, narrowed with `e instanceof Error ? e.message : '网络错误'` when shown to users (18 sites). Never `catch (e: any)` (0 uses).
- Census to preserve (whole UI layer): `: any` 2 lines (legacy, both in `SetupDiagnostic.tsx` — the one file that traverses a raw payload untyped; don't copy it), `as any` 0, `@ts-ignore`/`@ts-expect-error` 0, non-null `!` 1 (`RealtimeMapPanel.tsx:53`), plain `as T` casts ~15 across 5 files (mostly `as Tab` literal-widening in DashboardView and DOM casts like `e.target as HTMLElement`; fine in those spots).
- No enums, no `satisfies` — string-literal unions instead: `type Tab = 'overview' | 'activities' | ...`.
- Event handlers are inline/contextually typed; explicit event annotations only where extraction forces it (4 sites: `React.KeyboardEvent` in pr/page.tsx, native `PointerEvent`/`MouseEvent`/`KeyboardEvent` for document-level listeners). `React.FormEvent` is never used. No `React.FC` (0 uses). Icon props: `React.ComponentType<{ className?: string }>`.

## Enforcement Honesty

The near-zero-`any` state survives **by convention only**: ESLint carries no `@typescript-eslint/no-explicit-any` rule and tsconfig lacks the stricter flags. Sub-agents must uphold the census above rather than rely on tooling to catch them.

## Reference Files

- `src/app/dashboard/components/ErrorTrackingPanel.tsx` — canonical read-only panel typing (local payload interfaces → typed useState → untyped res.json)
- `src/app/dashboard/components/SchedulerPanel.tsx` — mutation + instanceof-Error narrowing
- `src/app/monitor/MonitorDashboard.tsx` — `import type` from lib + explicit props interface
- `src/components/login/LoginForm.tsx` — `useActionState` full inference, zero manual event typing
