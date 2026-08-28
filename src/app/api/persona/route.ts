import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getActivitiesClient } from '@/lib/db/activities-client'

export const dynamic = 'force-dynamic'

/**
 * 数字分身投影只读接口(「数字分身」面板数据源)。
 *
 * 刻意用 raw select 而不把 persona_state 加进本仓 drizzle schema:
 * persona 的 DDL/投影逻辑/解析规则 owner 全在 pr-agent(共库部署下写同一个 shared.db),
 * admin 只消费最终 JSON,连表结构都不感知——将来面板整体切 pr-agent API 时本页零迁移。
 * 设计:pr-agent/claudedocs/persona-avatar-design.md
 */
export const GET = withAuth(async () => {
  const client = await getActivitiesClient()
  try {
    const result = await client.execute(
      "SELECT payload_json, projection_version FROM persona_state WHERE id = 'singleton' LIMIT 1",
    )
    const row = result.rows[0]
    if (!row) return NextResponse.json({ persona: null })
    return NextResponse.json({
      persona: JSON.parse(String(row.payload_json)) as unknown,
      projectionVersion: Number(row.projection_version),
    })
  } catch {
    // 表还没建(pr-agent 尚未升级/未跑过投影)→ 面板显示引导态而不是 500。
    return NextResponse.json({ persona: null })
  }
})
