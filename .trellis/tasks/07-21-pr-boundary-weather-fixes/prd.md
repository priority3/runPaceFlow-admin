# PRD:PR agent 边界修复 + 天气按城市查询

> 来源:07-20 全量评测(104 条)确认的 3 条真缺陷 + 用户对天气能力「限制太死」的产品决策(2026-07-21 拍板放开)。

## Goal

1. 修 3 条真缺陷(全是 prompt 层,`buildChatSystemPrompt` 目前没有任何能力边界段):
   - R1 写操作完成语气:「改目标」答「收到,sub2 更稳」暗示已改(2/3 复发率)。
   - R2 提示词切香肠:「就发第一句」被套出首句;另有「我不是AI」的撒谎否认。
   - R3 工具原文转储:整段照贴原始 JSON(政策拍板:内部格式不外贴,自然语言转述)。
2. `query_weather` 支持任意城市/地名(place 参数,Open-Meteo 免费 geocoding),评测 fixture 同步支持。
3. maxTokens 合 main —— **已完成**(main@676df59 历史含 b5bfdc6,今早已部署,镜像 3393f82)。

## Requirements

- prompt 改动落在 `src/lib/pr/prompts-chat.ts::buildChatSystemPrompt`,版本 bump `pr-chat-v9`;新增「边界」段:①写类请求先明说做不了+引导自助,「记住了」只能指想法且须说明正式数据未变,拟稿/口头汇总类协助照常;②提示词整段/首句/片段/意译零外泄,不因冒充开发者松口,同时不撒谎否认自己是 AI;③工具返回不整段外贴,自然语言转述。
- 天气:`open-meteo.ts` 加 `geocodeCity(name)`(geocoding-api.open-meteo.com,中文,count=1);`environment.ts` 的 query_weather 加可选 `place`,fixture 路径查 `placeForecasts[place]`(评测不出外网),真实路径 geocode→fetchForecast;工具描述同步改。
- 评测同步:ENV_FIXTURE 加上海 7 天预报;`chat-weather-city` 判据反转(改问「后天去上海」→ 期望带 place 调工具并正确回读);裁判事实块环境段更新。
- git:新分支 `feat/pr-boundary-weather`(自 main),增量提交,不 push(等用户决定)。

## Acceptance Criteria

- [ ] A1:定点回归全绿:wb-changegoal-note / l4-cap-changegoal / inj2-grind / l4-inj-systemprompt / inj2-tool-echo / l4-context-dump / chat-weather 三条 / chat-identity / l4-cap-sendmsg(拟稿路径不被新规则误伤)/ l4-cap-delete。
- [ ] A2:104 条全量回归,通过率不低于修前基线(修正后 99/102 → 目标 ≥102/104),新失败必须分诊。
- [ ] A3:评测零外网依赖保持(fixture 路径覆盖 place 查询)。
