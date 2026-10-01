/** 用户门户概览页（/console）：余额卡组 + 用量趋势 + 模型排行。
 *
 * 意图（Why）：
 *   3 秒看到「还剩多少、用了多少、主要用在哪」。四个汇总卡 + 两张图，
 *   图表配色来自 utils/chart.ts，亮色下保证可读。
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchFinanceSummary } from '@/api/portal'
import type { FinanceSummary } from '@/api/types'
import { fetchMyTrial } from '@/api/portal'
import { fetchMyUsage } from '@/api/portal'
import type { UsageStats } from '@/api/types'
import { Card, Skeleton, StatCard } from '@/components/ui/Display'
import { EChart } from '@/components/ui/EChart'
import { useAuth } from '@/lib/auth/auth-context'
import { CHART_PALETTE, AXIS_LABEL_STYLE, SPLIT_LINE_STYLE, TOOLTIP_STYLE } from '@/utils/chart'
import { formatNumber } from '@/utils/format'

export default function ConsoleOverviewPage() {
  const { refreshUser } = useAuth()
  const [finance, setFinance] = useState<FinanceSummary | null>(null)
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [days, setDays] = useState(7)

  const load = useCallback(async () => {
    try {
      const [f, u] = await Promise.all([fetchFinanceSummary(), fetchMyUsage(days)])
      setFinance(f)
      setUsage(u)
    } catch {
      /* 401 由 client 统一处理 */
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  // 进入页面刷新一次额度快照（余额可能刚被充值）
  useEffect(() => {
    void refreshUser()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const trendOption = useMemo(() => {
    const series = usage?.series ?? []
    return {
      tooltip: { trigger: 'axis', ...TOOLTIP_STYLE },
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: series.map((item) => item.date), axisLabel: AXIS_LABEL_STYLE },
      yAxis: { type: 'value', axisLabel: AXIS_LABEL_STYLE, splitLine: SPLIT_LINE_STYLE },
      series: [
        {
          name: '请求数',
          type: 'line',
          smooth: true,
          data: series.map((item) => item.requests),
          itemStyle: { color: CHART_PALETTE[0] },
          areaStyle: { color: 'rgba(8,145,178,0.12)' },
        },
      ],
    }
  }, [usage])

  const modelOption = useMemo(() => {
    const items = (usage?.by_model ?? []).slice(0, 8)
    return {
      tooltip: { trigger: 'item', ...TOOLTIP_STYLE },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          data: items.map((item, index) => ({
            name: item.model,
            value: item.tokens,
            itemStyle: { color: CHART_PALETTE[index % CHART_PALETTE.length] },
          })),
          label: { color: '#475569', fontSize: 11 },
        },
      ],
    }
  }, [usage])

  const unlimited = finance?.balance_quota === -1

  return (
    <div className="space-y-6">
      {/* 试用额横幅（可折叠信息，不占主要注意力） */}
      <TrialBanner />

      <div>
        <h1 className="text-xl font-bold text-ink">概览</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">当前账户用量与余额</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="当前余额"
          value={finance ? (unlimited ? '不限额度' : formatNumber(finance.balance_quota)) : '—'}
          hint={unlimited ? '额度不限制' : '站内计量单位'}
        />
        <StatCard label="累计消费" value={finance ? formatNumber(finance.used_quota) : '—'} hint="全部历史" />
        <StatCard label="累计充值" value={finance ? formatNumber(finance.recharged_quota) : '—'} hint={`${finance?.recharge_count ?? 0} 笔订单`} />
        <StatCard label="邀请返利" value={finance ? formatNumber(finance.reward_quota) : '—'} hint="注册奖 + 充值返利" />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-ink-2">近 {days} 日用量</div>
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded px-2.5 py-1 text-xs transition ${days === d ? 'bg-card text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2'}`}
            >
              {d} 天
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card padding="none">
          {usage ? <EChart option={trendOption} height={280} /> : <Skeleton className="m-4 h-64" />}
        </Card>
        <Card padding="none">
          {usage ? <EChart option={modelOption} height={280} /> : <Skeleton className="m-4 h-64" />}
        </Card>
      </div>
    </div>
  )
}

function TrialBanner() {
  const [trial, setTrial] = useState<{ active: boolean; remaining: number } | null>(null)
  useEffect(() => {
    void fetchMyTrial().then(setTrial).catch(() => setTrial(null))
  }, [])
  if (!trial?.active) return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand/20 bg-brand/5 px-4 py-2.5 text-[13px] text-ink-2">
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      限时试用额度剩余 {formatNumber(trial.remaining)}，到期自动失效。
    </div>
  )
}