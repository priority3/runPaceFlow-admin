# Settings Governance (app_settings / SETTING_DEFINITIONS)

Conventions distilled from the 2026-07-22 settings-cleanup audit (42→38 keys). Full per-key audit: `.trellis/tasks/archive/**/07-21-admin-settings-cleanup/`.

## Rules

1. **Every consumed setting must be registered.** `getSettingsMap`/`exportSettings` project only `SETTING_DEFINITIONS` — an unregistered key's DB row is silently invisible (ghost key). If code reads a key via `getRuntimeSettings`, register it or read `process.env` explicitly.
2. **Deploy-time constants stay out of the registry.** The test is NOT "is it consumed at runtime" — it is **"does a change scenario exist that is NOT part of a deployment operation?"** Credential rotation, model switching, user preferences: yes. Listen ports, domains/public URLs, bootstrap addresses, auth-pairing secrets read from `process.env` on both ends: no — changing those always accompanies deploy-scale surgery (tunnel/DNS/compose), so an env edit is free at that moment, and a UI knob is either a no-op or breaks the pairing. (Ruling 2026-07-22: `NEXT_PUBLIC_ADMIN_URL` removed on these grounds despite having a real runtime distribution channel — runtime *distribution* to browsers ≠ runtime *configurability*; the distribution channel sources from env just fine.)
3. **`defaultValue` is display-only.** Since the cleanup, unconfigured keys export nothing and resolve to env/consumer defaults; defaults never masquerade as configured values in the export channel to the main site.
4. **Read through `getRuntimeSettings`, never `process.env`, in runtime code paths** — env-direct reads silently ignore admin UI edits (this bug shipped 12× before the cleanup).
5. **Removing a key = registry + consumers + orphan DB row.** Use `bun run scripts/prune-orphan-settings.ts` (dry-run default, `--apply` to delete).
6. **Adding a category** requires: `SettingCategory` union + `CATEGORY_META` + the icon `Record` and `CATEGORY_ORDER` in `SettingsPanel.tsx` (tsc catches the Record, not the order).

## Wrong vs Correct

```typescript
// Wrong: skip gate in a script via raw env — diverges from env+config-DB merged resolution
if (!process.env.SOME_KEY) skip()
// Correct: same source of truth as the app layer
const settings = await getRuntimeSettings(); if (!settings.SOME_KEY) skip()
```
