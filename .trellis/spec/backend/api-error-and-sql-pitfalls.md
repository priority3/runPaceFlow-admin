# API Error Surfacing & SQLite Pitfalls

> Extracted from the 2026-07-29 incident: the whole 访问分析 page rendered "无法加载分析数据" while the container log stayed clean.

---

## Every 500 must leave a trace

`src/lib/api-helpers.ts` has four auth wrappers (`withAuth`, `withAuthParams`, `withHealthImportAuth`, `withPrChatAuth`). All of them funnel unexpected errors through the single `internalError(request, error)` helper, which `console.error`s `method + pathname + error` before returning the 500 JSON.

**Rule**: a new wrapper or a hand-rolled `try/catch` in a route must not return 500 without logging. Combined with the client-side habit of silent `catch {}` (see `AnalyticsPanel.fetchAnalytics`), an unlogged 500 is invisible on both ends — the only symptom is an empty page, and triage degenerates into guessing.

## Aggregate endpoints fail as a unit

`GET /api/analytics/stats` runs ~20 queries under one `Promise.all`. One rejection rejects the whole array → 500 → the client's `!data` guard replaces the entire page with a single error line. Two consequences:

- A defect in one rarely-exercised query (p95, week-comparison) takes down every card on the page.
- When adding a query to such an endpoint, either keep it inside the all-or-nothing contract deliberately, or wrap it so a failure degrades to `null` instead of nuking the response.

## SQLite `LIMIT` / `OFFSET` require integers

libsql/SQLite rejects a non-integer `OFFSET` with `SQLITE_MISMATCH: datatype mismatch`. Percentile-by-offset queries compute the index arithmetically, so the expression **must** be wrapped in `CAST(... AS INTEGER)`:

```sql
-- correct (src/lib/analytics-advanced.ts, getPerformanceStats)
OFFSET (SELECT CAST(COUNT(*) * 0.95 AS INTEGER) FROM page_views WHERE ...)

-- broken: COUNT(*) * 0.05 is a float
OFFSET (SELECT MAX(0, COUNT(*) - COUNT(*) * 0.05) FROM page_views WHERE ...)
```

**Why this class of bug hides**: it only fires when the row count makes the product non-integral (a multiple of 20 happens to pass, and an empty window yields `0`). It therefore ships green and breaks later as data accumulates — the failure is data-dependent, not code-path-dependent. The same p95 index in `getPerformanceTrend` uses `CAST(cnt * 0.95 AS INTEGER) + 1`; keep the two definitions in sync so the trend chart and the summary card can't disagree.

**Verification recipe** (read-only, against the real DB rather than a fixture — the bug is invisible on small/round datasets):

```bash
docker exec -w /app runpaceflow-admin node /app/probe.cjs   # libsql client resolves from /app; .cjs because package.json is type:module
```

Run the candidate SQL across every UI preset (1/7/14/30/90 days), not just one.
