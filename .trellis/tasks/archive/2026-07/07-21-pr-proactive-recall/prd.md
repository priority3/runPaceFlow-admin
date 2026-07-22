# PRD:PR 主动查证 + 活动数据供给拓宽

> 来源:2026-07-21 用户生产实测反馈(会话截图)。用户问「像20号这种户外徒步天气我应该做什么防护」,PR 既没查 20 号实测天气,也没声明查不到,拿今天 40.7°C + 七月常识默默顶替,还编造了「马线有些段没什么遮挡」这种无依据的路线细节。用户明确产品期望:**「我不太喜欢未知的事情,我提到 20 号徒步,就应该去查一下 20 号相关的信息——天气、路线概括、有没有发生什么等一切信息」**;并反馈「和 PR 聊天总感觉回答不够具体」。

## 问题定位(已核实)

1. **数据在库里但被裁掉**:activities 表已存 `weather_data`(每次活动回填的实测天气 JSON:温度/湿度/风速/描述)、`elevation_gain`、`route_coordinates`/`gpx_data`,但 `context.ts::ACTIVITY_SUMMARY_COLUMNS` 只选 6 列 → 上下文快照与 query_activities 全都拿不到。想具体没料,只能编。
2. **query_weather 只有 forecast 路径**:过去日期落在 daily 范围外,错误文案「XX 还查不了」是未来语气;而 Open-Meteo forecast API 原生支持 `past_days`(≤92 天,近期实测),没接。
3. **prompt v9 工具规则没覆盖「过去某天」**:第 22 条列举的是「更早记录/趋势/明天或比赛那天」;路线级细节(遮挡/补给/路况)也没有专门红线。

## Goal

1. 用户提到具体日期/某次活动时,PR 主动把那天能查的都查齐(活动详情+当天天气+当天身体),基于实据给具体回答;查不到的维度如实说,不许拿今天数据/常识默默顶替。
2. 数据供给补齐:query_activities 与上下文快照带当次实测天气/爬升/起点相对位置;query_weather 支持过去日期(近 92 天)。
3. 评测锁住:新增「过去日期主动查证」与「路线细节幻觉诱导」用例,回归不倒退。

## Requirements

- **R1 活动数据供给**:`ACTIVITY_SUMMARY_COLUMNS` 补 weather_data / elevation_gain / route_coordinates 起点(substr 技巧,不整列取回);query_activities 返回与快照行带天气(温度+现象)、爬升(有意义时);起点标签用「常跑地点附近 / 离常跑地点约 N km」(haversine 距离,零外网、零反地理编码依赖);query_activities 加 `date` 精确过滤参数,工具描述同步(「复盘某天活动就用它」)。
- **R2 query_weather 过去日期**:date < 今天且 ≤92 天 → `fetchForecast` 加 `pastDays` 参数取近期实测;>92 天如实说查不到;错误文案区分「已过去查不到」与「太远还没预报」;返回标注是历史实测。评测 fixture 的 forecast.daily/hourly 加过去日期条目(不出外网)。
- **R3 prompt v10**(bump `pr-chat-v10`):新增「主动查证」规则(提到具体某天/某次运动 → 先查齐再答,查不到的维度明说,禁止拿今天天气/常识顶替过去);路线路况细节红线(没依据不断言)。新增 ≤3 行,避免稀释既有规则。
- **R4 评测**:新用例 ≥2 条(过去某天活动复盘查证 / 路线细节诱导);种子活动补 weather_data/elevation_gain/route_coordinates;ENV_FIXTURE 与裁判事实块同步真值;定点+全量回归。
- **R5 git**:延续分支 `feat/pr-boundary-weather`(依赖其 place/fixture 改动),增量提交,不 push(等用户决定)。

## Acceptance Criteria

- [x] A1 新用例通过:`chat-past-day-recall`(提到过去某天徒步/跑步复盘 → 调 query_activities 等工具,回答含当天实测温度/爬升等实据,不拿今天天气顶替)、`chat-route-detail-bait`(诱导补路线细节 → 不编造,明说没数据并给一般性提醒)。—— S6 定点 + S7 全量双确认 ✅
- [x] A2 天气三条既有用例(chat-weather / chat-weather-tomorrow / chat-weather-city)与相关定点回归全绿。—— S6 12/12(1 条网关抖动复跑过)✅
- [x] A3 全量回归通过率不低于修前基线,新失败必须分诊。—— 108 条原始 102 通过,6 条非通过全数复跑通过(等效 108/108 ≥ 基线 104/104),分诊见报告目录 triage.md,无一与本次改动相关 ✅
- [x] A4 评测零外网依赖保持(fixture 路径覆盖过去日期查询)。—— 核查 agent 验证 fixture 模式零真实 HTTP ✅
- [x] A5 真实路径冒烟:fetchForecast past_days 经生产出口实拉 07-20 实测 26-40°C 晴(徒步当天的「未知」已可查);生产对话级冒烟待部署后用户实测(避免污染生产会话)。✅
