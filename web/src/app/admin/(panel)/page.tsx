/** 管理后台：仪表盘（/admin）。
 *
 * 意图（Why）：
 *   只看不操作：汇总卡（渠道/用户/令牌/今日）+ 请求趋势 + Top 模型。
 */
'use client'

import { useEffect, useMemo, useState } from 'react'

import { fetchDashboard } from '@/api/admin'
import type { DashboardStats } from '@/api/types'
import { Card, Skeleton, StatCard } from '@/components/ui/Display'
import { EChart } from '@/components/ui/EChart'
import { CHART_PALETTE, AXIS_LABEL_STYLE, SPLIT_LINE_STYLE, TOOLTIP_STYLE } from '@/utils/chart'
import { formatNumber } from '@/utils/format'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    void fetchDashboard().then(setStats).catch(() => setStats(null))
  }, [])

  const trendOption = useMemo(() => {
    const days = stats?.recent_days ?? []
    return {
      tooltip: { trigger: 'axis', ...TOOLTIP_STYLE },
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { color: '#475569', fontSize: 11 } },
      xAxis: { type: 'category', data: days.map((d) => d.date), axisLabel: AXIS_LABEL_STYLE },
      yAxis: { type: 'value', axisLabel: AXIS_LABEL_STYLE, splitLine: SPLIT_LINE_STYLE },
      series: [
        { name: '请求数', type: 'bar', data: days.map((d) => d.requests), itemStyle: { color: CHART_PALETTE[0] }, barWidth: '50%' },
        { name: 'Token', type: 'bar', data: days.map((d) => d.tokens), itemStyle: { color: CHART_PALETTE[1] }, barWidth: '50%' },
      ],
    }
  }, [stats])

  const topModelOption = useMemo(() => {
    const items = stats?.top_models?.slice(0, 8) ?? []
    return {
      tooltip: { trigger: 'item', ...TOOLTIP_STYLE },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          data: items.map((item, index) => ({
            name: item.model,
            value: item.requests,
            itemStyle: { color: CHART_PALETTE[index % CHART_PALETTE.length] },
          })),
          label: { color: '#475569', fontSize: 11 },
        },
      ],
    }
  }, [stats])

  const today = stats?.today

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">仪表盘</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">全站运行概览</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="渠道"
          value={stats ? String(stats.channels.total) : '—'}
          hint={`${stats?.channels.enabled ?? 0} 启用 · ${stats?.channels.auto_disabled ?? 0} 自动停用`}
        />
        <StatCard label="用户" value={stats ? String(stats.users.total) : '—'} hint={`${stats?.users.active ?? 0} 活跃`} />
        <StatCard label="令牌" value={stats ? String(stats.tokens.total) : '—'} hint={`${stats?.tokens.enabled ?? 0} 启用`} />
        <StatCard
          label="今日请求"
          value={stats ? formatNumber(today?.requests ?? 0) : '—'}
          hint={today ? `成功率 ${(today.success_rate * 100).toFixed(1)}%` : undefined}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="今日 Token" value={stats ? formatNumber(today?.tokens ?? 0) : '—'} />
        <StatCard label="平均耗时" value={today && today.avg_latency_ms ? `${today.avg_latency_ms}ms` : '—'} />
        <StatCard label="首包延迟" value={today && today.avg_first_token_ms ? `${today.avg_first_token_ms}ms` : '—'} />
        <StatCard label="输出速率" value={today && today.avg_tokens_per_second ? `${today.avg_tokens_per_second.toFixed(1)} t/s` : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card padding="none">
          {stats ? <EChart option={trendOption} height={300} /> : <Skeleton className="m-4 h-64" />}
        </Card>
        <Card padding="none">
          {stats ? <EChart option={topModelOption} height={300} /> : <Skeleton className="m-4 h-64" />}
        </Card>
      </div>
    </div>
  )
}