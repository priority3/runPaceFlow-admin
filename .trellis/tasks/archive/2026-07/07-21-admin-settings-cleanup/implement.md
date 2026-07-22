# 执行计划:admin 配置管理瘦身

前置阅读:prd.md → design.md(判决表是唯一事实源)→ src/lib/settings.ts → src/app/dashboard/components/SettingsPanel.tsx → src/lib/settings/store.ts。

## 步骤(按序,每步可独立 commit)

### 1. 预设移除(P0 止血)
- [ ] SettingsPanel.tsx:删「快速配置预设」区块、applyPreset、confirmingPreset 状态。
- 验证:type-check + lint;配置页正常渲染保存。

### 2. 注册表重构(settings.ts)
- [ ] 摘除 10 键(PORT/RUNPACEFLOW_ADMIN_URL/CONFIG_EXPORT_TOKEN/ANALYTICS_RATE_LIMIT/NEXT_PUBLIC_APP_URL/WECHAT_×5)。
- [ ] 新增 `pr` 分类(CATEGORY_META + SettingCategory);移入 PR_CHAT_TOKEN、PR_EMBEDDING_×3;注册 PR_HOME_LAT/LNG/LABEL、PR_MEMORY_RECONCILE_APPLY、PR_REVIEW_MODEL、PR_REVIEW_PROVIDER(描述按 design §1)。
- [ ] 全部保留键 description 重写(凭据类含获取方式;NEXT_PUBLIC 目标键注明约 1 秒生效);分类描述更新(sync 说 Keep 默认);删 `required` 死字段。
- 验证:type-check;页面各分类渲染、计数=38。

### 3. 微信退役 + 死代码清理
- [ ] 删 src/app/api/wechat/callback/、src/lib/notifications/wechat-test-account.ts、dispatcher.ts 的 wechat_test_account 分支与 buildConfig 微信字段。
- [ ] dispatcher.ts:16,90 兜底链去掉 NEXT_PUBLIC_APP_URL。
- [ ] sync/service.ts Nike 死读(:71-72)、testConnection 死导出;retention.ts:5 注释;SchedulerPanel.tsx:174 文案;api/analytics/track/route.ts:47 加「为何硬编码」注释。
- 验证:type-check + lint;grep 全仓无 wechat-test-account 残留引用。

### 4. 机制修复
- [ ] store.ts/listSettings 或 getSettingsMap/exportSettings:defaultValue 不再作为导出值/运行时值,仅 UI 展示(design §3.1)。
- [ ] src/lib/ai.ts 9 处、scheduler.ts PUSHPLUS 3 处 → getRuntimeSettings。
- [ ] 删 /api/settings/public、/public/stream、lib/public-settings.ts、settings-events 死链。
- 验证:type-check;手动对比 /api/settings/export 输出(主站消费键不变;默认值键不再凭空出现)。

### 5. 孤儿行清理脚本
- [ ] scripts/prune-orphan-settings.ts:列未注册键行,dry-run 默认,--apply 删除;含本次摘除键与微信键。
- [ ] 部署前检查:SELECT 6 个新注册键是否有休眠行,有则人工确认值再上线。
- 验证:dry-run 输出人工核对。

### 6. 收尾
- [ ] 全量 lint + tsc;文件 <500 行核查(SettingsPanel 删块后应更小;settings.ts 注意增删相抵)。
- [ ] trellis-check 全量核查 → 提交(分步 commit)→ 部署走 overlay 法。

## 回滚点
- 每步独立 commit;步骤 4.1(defaultValue 语义)风险最高,单独 commit 便于定点回滚。
- prune 脚本 --apply 前必须人工过 dry-run 清单。
