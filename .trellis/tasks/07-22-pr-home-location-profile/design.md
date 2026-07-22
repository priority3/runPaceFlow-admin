# 技术设计:常跑地点迁 friend_profile

## 数据层

- `friend_profile` 新列 `home_location_json`(text,可空),值:`{ lat: number, lng: number, label?: string, setAt: ISO }`。
- 迁移:`ensureActivitiesSchema` 现有 runtime ALTER 模式追加一条(activities-client.ts:470 附近同款,幂等 try/catch 缺列才加)。
- drizzle schema:`friendProfile` 表加 `homeLocationJson: text('home_location_json')`。
- 单行表语义沿用 memory.ts:780(`select().limit(1)`)与 :831 的 upsert(onConflict target id)——写入复用同一 id 约定,只 set `homeLocationJson` 与 `updatedAt`,**不触碰投影列**(projectionVersion 等归记忆投影管)。

## 读取链(src/lib/pr/providers/environment.ts)

`getHomeLocation()` 优先级保持:fixture → TTL 缓存 → **显式值** → 活动聚类推导。唯一变化:显式值来源从 3 个 getRuntimeSetting 改为读 friend_profile.home_location_json:

```ts
const profile = await getFriendProfileRow()   // 新 helper(pr/state.ts 或 memory.ts 导出,复用现有查询)
const home = parseHomeLocation(profile?.homeLocationJson)
if (home) value = { lat, lng, label: home.label ? `按${home.label}` : '按你设置的常跑地点' }
else value = await deriveLocationFromActivities()
```

- 缓存失效:保存 API 成功后调用 `invalidateHomeLocationCache()`(environment.ts 导出,置空 locationCache 与 envCache)——同进程立即生效,满足验收 2 的"主动失效"。
- fixture/评测通道零改动(fixture 分支在最前,seed 的 friend_profile 无该列值时走推导,与现状一致)。

## API(admin 会话鉴权,withAuth)

`src/app/api/pr/profile/home-location/route.ts`:
- `GET`:返回 `{ explicit: {...}|null, effective: HomeLocation|null, source: 'explicit'|'derived'|'none' }`(effective 用 getHomeLocation 的非缓存变体或读后失效,给面板展示"当前生效");
- `PUT` body `{ lat, lng, label? }`:校验 lat∈[-90,90]、lng∈[-180,180]、label ≤30 字;upsert 列;失效缓存;
- `DELETE`:清空列(回退推导);失效缓存。

## UI(PrPanel 新卡片)

`src/app/dashboard/components/pr/HomeLocationCard.tsx`(挂进 PrPanel 的 CollapsibleSection,风格对齐 MemoryPanel):
- 展示当前生效地点与来源徽标(显式设置 / 按常跑路线推导 / 未知);
- 编辑:纬度/经度/名称三输入 + 保存 + 清除(回退推导);输入框下给一行帮助文案(从地图 App 长按取坐标);
- 显示推导预览:source=derived 时展示推导出的坐标,一键「采用为显式值」(把推导值填进表单)。

## settings 三键摘除

- `settings.ts` 删 PR_HOME_LAT/LNG/LABEL 注册(38→35);
- environment.ts 删 getRuntimeSetting 三连读;
- 生产库零数据(2026-07-22 部署时已验证),无数据迁移;若个别环境 env 里配过 PR_HOME_*,行为变化为回退聚类推导——README 部署段提一句。

## 风险

- 写列与记忆投影并发:upsert 只 set 单列,SQLite 行级原子,无互踩;
- eval:seed 不动,fixture 优先,零影响;
- 回滚:单 commit revert;新列残留无害(additive)。
