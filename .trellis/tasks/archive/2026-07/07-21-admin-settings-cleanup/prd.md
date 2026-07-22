# PRD:admin 配置管理瘦身

## 背景(用户原话归纳,2026-07-21)

配置管理页(42 个 SETTING_DEFINITIONS,UI 显示 21/39 已配置)存在三类问题:

1. **「快速配置预设」名不副实且危险**:预设无法真正完成配置——所有真实配置都要用户自己去三方(Turso/Strava/PushPlus/网关)拿凭据;预设至多有「教用户怎么配」的价值。实际实现更糟:「腾讯云生产」预设会把线上 `DATABASE_URL` **覆盖成占位符 `libsql://your-turso-db.turso.io` 并立即保存**;「Strava 用户」「通知推送」预设甚至不含各自领域的任何键,只重复写 DB 占位符 + 地图样式。
2. **部署期常量混进运行时配置**:如「运行时-Admin 内网地址」(RUNPACEFLOW_ADMIN_URL)——这是部署拓扑决定的,部署者在部署时自己指定(env),放 admin UI 里配没有意义;已确认主站查找 admin 只读主站自己的 process.env(runPaceFlow/src/lib/runtime-config/server.ts:13),admin 库里那份无人消费。
3. **用途不明的键**:如 CONFIG_EXPORT_TOKEN(什么场景需要导出?)——实际是主站运行时配置分发通道(主站拉 /api/settings/export)+ 评测凭据导出的鉴权对钥,有用但描述完全没讲清;类似的「描述讲不清自己是干嘛的」键不止一个。

## 目标

1. 配置页只保留**运行时真的被消费、且用 UI 随时改有真实价值**的键;
2. 每个凭据键的描述讲清「去哪获取、怎么填」(取代预设的「教学」职能);
3. 预设机制移除(或降级为纯文档指引,不写任何值);
4. 部署期常量从 UI 摘除(仍走 env);两仓均无消费的死键连注册带消费残骸一起清;
5. 分组/计数/文案与实际保持一致。

## 约束

- **不能破坏主站配置分发通道**:主站服务端依赖 admin `/api/settings/export`(Bearer CONFIG_EXPORT_TOKEN)拉全量配置覆盖自身 env;任何键的摘除都要先确认主站不再经此通道消费它。
- **不能丢生产已配置的值**:摘除注册 ≠ 删库行;app_settings 中现存值的处置(保留孤儿行/显式清理)必须在方案中写明。
- **NEXT_PUBLIC_\* 的生效通道要逐键查证**:构建期内联的键改配置库不生效,是否保留取决于是否存在运行时注入通道(主站 getPublicRuntimeConfig / admin public/stream)。
- 改动范围:admin 仓为主;若审计发现主站侧死消费,单独列出、不在本任务动主站代码。

## 验收标准

1. 「快速配置预设」区块从 UI 移除;不存在任何「一键写入占位符覆盖真实配置」的路径;
2. 每个保留键的 description 能回答「这是干嘛的 + 去哪获取/怎么定值」;凭据类键含获取地址;
3. 审计判决表(keep / env-only / dead-remove / merge-or-rework)覆盖全部 42 键,每键有 file:line 证据,落在 design.md;
4. env-only 与 dead-remove 键从 SETTING_DEFINITIONS 摘除后:配置页计数、分组、连接诊断不出现空档或报错;`/api/settings/export` 对主站仍在消费的键输出不变;
5. app_settings 孤儿行处置方案已执行(方案中明确保留或清理);
6. lint + type-check 通过;现有配置保存/读取回归正常。
