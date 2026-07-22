# 技术设计:admin 配置管理瘦身

依据:settings-audit 工作流(5 视角,42 键全覆盖,证据 file:line 见任务产出)+ 用户决策(微信全套退役;注册 6 个常用幽灵键)。

## 1. 逐键判决表(42 → 38)

### 摘除(10)

| 键 | 判决 | 依据 | 附带代码动作 |
|---|---|---|---|
| PORT | env-only | 监听端口进程启动时定,compose 写死;库值永远追不上 | 无 |
| RUNPACEFLOW_ADMIN_URL | env-only | 主站找 admin 只读主站 env(server.ts:13),库值零读取方,鸡生蛋 | 无 |
| CONFIG_EXPORT_TOKEN | env-only | 鉴权两端各读各的 env(auth.ts:83-91);UI 改=下发不一致值拉断分发,自断链陷阱 | 无(env 用法写进 README 部署段) |
| ANALYTICS_RATE_LIMIT | dead | 限流硬编码 30/min(track/route.ts:47),假旋钮 | 硬编码处加注释说明为何不做设置 |
| NEXT_PUBLIC_APP_URL | dead | 唯一消费是 dispatcher H5 链接第二兜底,语义错误(base+/pr 在主站是 404) | dispatcher.ts:16,90 兜底链去掉此键 |
| WECHAT_TEST_ACCOUNT_APP_ID / APP_SECRET / TEMPLATE_ID / OPEN_ID / TOKEN | dead(决策:全套退役) | 推送链路死透(入队方全改 pushplus);对话入口被 H5 /pr 取代 | 删 /api/wechat/callback 路由、lib/notifications/wechat-test-account.ts、dispatcher 的 wechat_test_account 分支 |

### 新注册(6,幽灵键转正)

| 键 | 分类 | 说明 |
|---|---|---|
| PR_HOME_LAT / PR_HOME_LNG / PR_HOME_LABEL | pr(新) | 常跑地点坐标/名称,环境感知(天气)用;不填则从活动 GPX 聚类推导 |
| PR_MEMORY_RECONCILE_APPLY | pr(新) | 记忆调和写入开关(当前默认关) |
| PR_REVIEW_MODEL / PR_REVIEW_PROVIDER | pr(新) | PR 生成模型/提供方覆盖(不填用 ANTHROPIC_/OPENAI_ 主配置) |

> 注册的意义:getSettingsMap 只投影已注册键(store.ts:46-58),幽灵键此前写库静默无效、只能 env 供给。转正后 UI/库双通道可用。
> ⚠️ 部署前检查 app_settings 是否已有这 6 键的休眠行——注册会让它们立即生效。

### 保留(32)+ 新分类

新增分类 `pr`(PR 伙伴),把 PR_CHAT_TOKEN、PR_EMBEDDING_×3 从 notification/ai 移入,与新注册 6 键同组(改 category 纯元数据,不动 key,库行不受影响)。其余分组不变。全部保留键重写 description,凭据类必答「去哪获取」:

- DATABASE_AUTH_TOKEN → 附 `turso db tokens create` 提示;PUSHPLUS_TOKEN → pushplus.plus 开通步骤;KEEP_* → 手机号+密码即 Keep App 登录凭据;HEALTH_IMPORT_TOKEN → 自定随机串,填进 iOS 快捷指令 Bearer;PR_CHAT_TOKEN → 自定随机串,推送链接自动携带;PR_EMBEDDING_* → SiliconFlow 注册地址与免费额度说明;ANTHROPIC/OPENAI → 官方或网关。
- 修正过期文案:ANTHROPIC_MODEL(主站洞察写死模型,此键只管 admin 的 PR 链路)、sync 分类描述(默认源是 Keep,Strava 政策性停用待命)、NEXT_PUBLIC_* 目标键说明「改后约 1 秒经运行时通道生效,无需重建」。

## 2. 预设机制:整体移除

删 SettingsPanel.tsx 的「快速配置预设」区块与 applyPreset(:91-107,:126-230)。不做替代控件——「教学」职能由重写后的 description + 分类描述承担。理由(审计实锤):写入集随激活 tab 变化、占位符覆盖真实 DATABASE_URL、非占位值全部等于表单默认值,预设唯一净效果就是破坏。

## 3. 机制修复

1. **defaultValue 不再冒充已配置**:现状 listSettings 用 defaultValue 兜底出「非空值」,经 export 以权威值覆盖主站 env(12 个带默认键)。改为:导出与 getSettingsMap 只输出**有库行且非空**的值;defaultValue 仅作 UI placeholder/展示。回归确认:主站 normalize 对同批键自带相同默认(types.ts),行为不变。
2. **读取通道统一**:src/lib/ai.ts(9 处 process.env 直读)与 scheduler.ts 的 PUSHPLUS_TOKEN(3 处直读)改走 getRuntimeSettings——否则 UI 改凭据对 admin 洞察定时任务/调度推送不生效(审计横向发现)。
3. **死端点退役**:删 /api/settings/public、/api/settings/public/stream、lib/public-settings.ts、settings-events 订阅链(两仓零消费方,且无鉴权泄露内网地址)。
4. **孤儿行清理**:新脚本 `scripts/prune-orphan-settings.ts`——列出 app_settings 中未注册键的行(含本次摘除的 10 键 + 微信 5 键旧值),默认 dry-run,`--apply` 删除。
5. **顺手修**:settings.ts 删除无人消费的 `required` 死字段;sync/service.ts:71-72 Nike 死读与 testConnection 死导出清理;retention.ts:5 注释键名改对;SchedulerPanel.tsx:174「立即从 Strava 同步」改 Keep。

## 4. 不做(明确出范围)

- 主站仓改动(旧别名目标键清理、runtime-config/stream 每秒全量拉取的效率问题)——单列后续任务;
- 敏感值在 UI/导出的明文显示策略(现状保留,单列议题);
- Strava 三键与 webhook 整组退役与否(等产品决断,本次保留待命态);
- ACTIVITIES_DATABASE_URL/AUTH_TOKEN 幽灵键(部署期覆盖语义,维持 env,README 记录)。

## 5. 风险与回滚

- **export 通道兼容**:主站消费键(DATABASE_×2、OPENAI_×4、ANTHROPIC_KEY/URL、目标×8、MAP_STYLE、NEXT_PUBLIC_ADMIN_URL)全部保留,导出输出对这些键不变;摘除键均已证实主站不经 export 消费。上线后 diff 导出文本核对。
- **微信退役**:callback 路由删除后,微信后台若仍绑定 URL 会收 404——无害(测试号已弃用)。
- 回滚:单 commit revert;孤儿行清理是显式 --apply 才执行,默认无破坏。

## 6. 验证

- lint + tsc;配置页各分类保存/回显回归;
- 导出对比:改前后 `/api/settings/export` 输出对主站消费键逐行 diff 相同;
- prune 脚本 dry-run 输出核对后再 --apply;
- 计数显示 = 38,新 pr 分类渲染正常。
