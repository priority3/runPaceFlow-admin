# Implement:执行清单

> 顺序执行;每步结束跑该步的校验;S1-S5 各自独立 commit(回滚点)。校验基线:`bun run lint`(eslint .)、`bun run type-check`(tsc --noEmit)。评测统一走 `PR_EVAL_ENV=<creds> scripts/eval/run.sh`(凭据见 scripts/eval/README.md;本机不可达网关需按记忆补 .env.local/SSH 桥)。

## S1 数据层:context.ts 活动详情列

- [ ] `ACTIVITY_SUMMARY_COLUMNS` 加 weatherData / elevationGain / routeHead(substr 64)三列
- [ ] `RecentActivityContext` 加 optional 字段 weather / elevationGainM / startLatLng;`mapActivityRow` 解析(JSON/正则均容错)
- [ ] `queryActivityContext` 支持 `date` 精确过滤(上海时区当天区间)
- [ ] 校验:`bun run type-check`
- [ ] commit(回滚点 1)

## S2 activities provider:快照行 + 工具返回

- [ ] `activityLine` 追加爬升(≥50 m)与当次天气尾巴
- [ ] environment.ts 导出 `getHomeLocation()`(改名自私有 resolveHomeLocation,保留 TTL 缓存);activities.ts 引入,实现 haversine + startPlace 标签
- [ ] `query_activities` 返回补 weather / elevationGainM / startPlace;inputSchema 加 `date`;工具描述更新
- [ ] 校验:`bun run lint && bun run type-check`
- [ ] commit(回滚点 2)

## S3 天气过去日期

- [ ] `fetchForecast` 加 `pastDays = 0` 参数,透传 `past_days`
- [ ] `query_weather` 执行体:过去日期分支(≤92 天单独 fetchForecast;>92 天如实 error 并指路 query_activities);返回加历史实测 note;错误文案分「已过去」/「还没预报到」
- [ ] 工具描述补「过去日期(近 3 个月)也能查」
- [ ] 校验:`bun run type-check`
- [ ] commit(回滚点 3)

## S4 prompt v10

- [ ] 版本 bump `pr-chat-v10` + 文件头 v10 注释一行
- [ ] 「怎么回」加主动查证条(design 改动 4 措辞);第 20 条补路线细节红线半句
- [ ] 自查:净增 ≤3 行;v9 边界段/思考段未被改动
- [ ] commit(回滚点 4)

## S5 评测同步

- [ ] seed/dataset:昨天徒步条目补 weatherData / elevationGain / routeCoordinates(起点在常跑网格内)
- [ ] ENV_FIXTURE:forecast.daily 加 `daysAgoDate(1)` 真值条目 + 该日早晚 hourly
- [ ] cases(noise.ts,仿 chat-weather-* 格式):`chat-past-day-recall`(L3)、`chat-route-detail-bait`(L4)
- [ ] 裁判事实块活动段/环境段同步真值
- [ ] 校验:`bun run lint && bun run type-check`
- [ ] commit(回滚点 5)

## S6 定点回归 【review gate:失败必须分诊,不许改判据凑绿】

- [ ] `scripts/eval/run.sh --case=chat-past-day-recall` / `--case=chat-route-detail-bait` 通过
- [ ] 天气三条:`--case=chat-weather` / `--case=chat-weather-tomorrow` / `--case=chat-weather-city` 全绿
- [ ] 抽查边界不回归:wb-changegoal-note / inj2-grind / inj2-tool-echo / chat-identity

## S7 全量回归 + 冒烟 【review gate】

- [ ] 全量 run.sh,通过率 ≥ 修前基线;新失败逐条分诊记录
- [ ] 真实路径冒烟(dev 起服务):问「昨天徒步那天啥情况/该注意啥」,确认回答引用当次实测天气/爬升、无路线细节编造
- [ ] 汇总结果,回填 prd.md 验收框

## S8 收尾

- [ ] trellis-update-spec(若沉淀出可复用约定:如「provider 数据供给三层修法」)
- [ ] 按 Phase 3.4 提交流程收口(不 push,等用户决定)
