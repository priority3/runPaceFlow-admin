'use client'

import { CollapsibleSection, PanelHeader } from './shared'
import { HealthRecoveryPanel } from './HealthRecoveryPanel'
import { HomeLocationCard } from './HomeLocationCard'
import { MemoryPanel } from './MemoryPanel'
import { PrAccessCard } from './PrAccessCard'
import { PrOpsPanel } from './PrOpsPanel'
import { PrReviewsPanel } from './PrReviewsPanel'

/**
 * PR 伙伴是 PR 域的唯一入口：脑(记忆)/嘴(反思)/身体(恢复) +
 * 运行侧(飞轮/周总结/运行审计) + 环境感知(常跑地点) + 对话入口。
 * 原先「运动数据」页还有一份记忆/复盘/恢复的副本，连写操作都做了两份，
 * 现在全部收拢到这里；运动数据页只留一条跳转入口。
 */
export function PrPanel() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PanelHeader
        title="PR 伙伴"
        description="PR 学到的、说过的、跑出来的，都在这里"
      />
      <div className="space-y-4">
        <CollapsibleSection title="记忆 · 确认或纠正 PR 学到的东西">
          <MemoryPanel />
        </CollapsibleSection>
        <CollapsibleSection title="最近反思 · PR 说过的话">
          <PrReviewsPanel />
        </CollapsibleSection>
        <CollapsibleSection title="近 14 天恢复" defaultOpen={false}>
          <HealthRecoveryPanel />
        </CollapsibleSection>
        <CollapsibleSection title="运行与学习 · 飞轮 / 周总结 / 运行审计" defaultOpen={false}>
          <PrOpsPanel />
        </CollapsibleSection>
        <CollapsibleSection title="常跑地点 · 天气与环境感知的定位" defaultOpen={false}>
          <HomeLocationCard />
        </CollapsibleSection>
        <CollapsibleSection title="对话页入口 · 签发一次性链接与管理设备" defaultOpen={false}>
          <PrAccessCard />
        </CollapsibleSection>
      </div>
    </div>
  )
}
