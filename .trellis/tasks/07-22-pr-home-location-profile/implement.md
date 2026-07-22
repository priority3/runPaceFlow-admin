# 执行计划:常跑地点迁 friend_profile

前置阅读:prd.md → design.md → src/lib/pr/providers/environment.ts(getHomeLocation 全链)→ src/lib/pr/memory.ts:770-860(profile 单行读写模式)→ src/lib/db/activities-client.ts(ALTER 模式)。

## 步骤

### 1. 数据层
- [ ] activities-schema.ts:friendProfile 加 homeLocationJson 列;activities-client.ts ensureActivitiesSchema 加幂等 ALTER。
- [ ] profile 读写 helper:导出 getFriendProfileRow / upsertHomeLocation(只 set homeLocationJson+updatedAt)。
- 验证:tsc;临时库冒烟 upsert→读回。

### 2. 读取链切换
- [ ] environment.ts:显式值改读 profile 列,删 3 个 getRuntimeSetting;导出 invalidateHomeLocationCache(清 locationCache+envCache)。
- 验证:临时库:设置列→getHomeLocation 返回显式值;清列→回退推导;fixture 仍最优先。

### 3. API + UI
- [ ] /api/pr/profile/home-location:GET/PUT/DELETE(withAuth,校验范围,写后失效缓存)。
- [ ] HomeLocationCard.tsx 挂进 PrPanel(展示来源、编辑、清除、推导预览采用)。
- 验证:tsc + lint;dev 起服务手动过一遍三操作。

### 4. settings 摘除 + 收尾
- [ ] settings.ts 删三键(38→35);grep 全仓无 PR_HOME_ 残留(.trellis/claudedocs 除外);README 部署段补一句 env 配置不再生效。
- [ ] 全量 lint+tsc;trellis-check;提交。

## 回滚点
每步独立 commit;新列 additive,revert 无残留风险。
