/** 管理后台：模型 ID 映射总览（/admin/model-mappings）。
 *
 * 意图（Why）：
 *   跨渠道聚合回答「平台模型 ID 映射到哪些上游 ID」，并列出未配置映射的渠道
 *   （它们把模型名原样透传给上游）。纯只读页面，方便站长巡检映射覆盖情况。
 *
 * 流转（Flow）：
 *   load() → fetchModelMappingOverview() → 两张卡片：
 *     ① 无映射渠道（原样透传）；② 已配置的映射明细。
 *   映射本身在「渠道详情」中维护（listChannelMappings / replaceChannelMappings），本页不提供编辑。
 *
 * 扩展（Extend）：
 *   总览接口新增字段时同步 types.ts 的 ModelMappingOverview 与本页列定义。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { fetchModelMappingOverview } from '@/api/admin'
import type { ModelMappingOverviewItem, ModelMappingPlainChannel } from '@/api/types'
import { Badge, Card } from '@/components/ui/Display'
import { DataTable, type Column } from '@/components/ui/Table'
import { Switch } from '@/components/ui/Form'
import { channelStatusLabel } from '@/utils/display'
import { formatNumber } from '@/utils/format'

/** 渠道状态 → 徽标配色：1 启用绿 / 2 停用灰 / 3 自动停用黄 */
function channelStatusTone(status: number): 'ok' | 'warn' | 'off' {
  if (status === 1) return 'ok'
  if (status === 3) return 'warn'
  return 'off'
}

export default function AdminModelMappingsPage() {
  const [items, setItems] = useState<ModelMappingOverviewItem[]>([])
  const [plainChannels, setPlainChannels] = useState<ModelMappingPlainChannel[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchModelMappingOverview()
      setItems(data.items)
      setPlainChannels(data.channels_without_mapping)
    } catch {
      /* 401 统一处理 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const plainColumns: Column<ModelMappingPlainChannel>[] = [
    { title: '渠道名', render: (row) => <span className="font-medium text-ink">{row.channel_name}</span> },
    {
      title: '渠道状态',
      render: (row) => <Badge tone={channelStatusTone(row.channel_status)}>{channelStatusLabel(row.channel_status)}</Badge>,
    },
    {
      title: '模型数',
      align: 'right',
      render: (row) => <span className="text-ink-2">{row.model_count > 0 ? `${formatNumber(row.model_count)} 个` : '全部模型'}</span>,
    },
  ]

  const mappingColumns: Column<ModelMappingOverviewItem>[] = [
    { title: '渠道名', render: (row) => <span className="font-medium text-ink">{row.channel_name}</span> },
    {
      title: '渠道状态',
      render: (row) => <Badge tone={channelStatusTone(row.channel_status)}>{channelStatusLabel(row.channel_status)}</Badge>,
    },
    { title: '平台模型', render: (row) => <span className="font-mono text-[13px] text-ink-2">{row.public_model}</span> },
    { title: '上游模型', render: (row) => <span className="font-mono text-[13px] text-ink-2">{row.upstream_model}</span> },
    { title: '优先级', align: 'right', render: (row) => <span className="text-ink-2">{row.priority}</span> },
    {
      title: '启用',
      render: (row) => <Switch checked={row.enabled} onChange={() => undefined} disabled label={`映射 ${row.public_model} 是否启用`} />,
    },
    {
      title: '备注',
      render: (row) => (
        <span className="max-w-44 truncate text-[13px] text-ink-3" title={row.remark || undefined}>
          {row.remark || '—'}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">模型映射总览</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">平台模型 ID ↔ 上游模型 ID；映射关系在渠道详情中维护，本页只读</p>
      </div>

      <Card padding="none">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">无映射渠道（模型名原样透传）</h2>
          <p className="mt-0.5 text-xs text-ink-3">共 {plainChannels.length} 个渠道未配置映射，可在渠道详情中补充</p>
        </div>
        <DataTable
          columns={plainColumns}
          rows={loading ? null : plainChannels}
          loading={loading}
          rowKey={(row) => row.channel_id}
          emptyTitle="所有渠道都已配置映射"
        />
      </Card>

      <Card padding="none">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">已配置的模型映射</h2>
          <p className="mt-0.5 text-xs text-ink-3">共 {items.length} 条</p>
        </div>
        <DataTable
          columns={mappingColumns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle="还没有任何模型映射"
          emptyDescription="在渠道详情中添加映射，这里会自动汇总"
        />
      </Card>
    </div>
  )
}
