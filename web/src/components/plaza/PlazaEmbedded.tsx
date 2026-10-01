/** PlazaEmbedded：内嵌模型广场（套在门户/后台外壳里）。
 *
 * 意图（Why）：
 *   与公开 /models 相同的数据源与卡片逻辑，但去掉了公共站外壳，
 *   避免点进广场后丢失侧边栏与身份上下文。
 *   为避免代码重复，复用 models 页的核心逻辑，通过 props 切换「是否独立页面」。
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { AppIcon } from '@/components/AppIcon'
import { fetchModelPlaza } from '@/api/site'
import type { ModelPlaza, PlazaModel, PlazaPrice } from '@/api/types'
import { Badge, EmptyState, Skeleton } from '@/components/ui/Display'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Display'
import { vendorLabel, vendorOf, vendorTone } from '@/utils/vendor'
import { formatNumber } from '@/utils/format'

export function PlazaEmbedded() {
  const [data, setData] = useState<ModelPlaza | null>(null)
  const [group, setGroup] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<PlazaModel | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchModelPlaza({ group: group === 'all' ? undefined : group, keyword: keyword || undefined })
      setData(result)
    } catch {
      setData(null)
    }
  }, [group, keyword])

  useEffect(() => {
    void load()
  }, [load])

  const tabs = useMemo(() => {
    const items: { value: string; label: string; count?: number }[] = [{ value: 'all', label: '全部' }]
    for (const g of data?.groups ?? []) items.push({ value: g.name, label: g.label, count: g.model_count })
    return items
  }, [data])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-ink">模型广场</h1>
        <div className="flex max-w-xs flex-1 items-center gap-2 rounded-md border border-line-2 bg-card px-3 focus-within:border-brand">
          <AppIcon name="search" size={15} className="text-ink-3" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索模型…"
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
        </div>
      </div>

      <Tabs items={tabs as { value: string; label: string; count?: number }[]} value={group} onChange={(v) => setGroup(v)} />

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-card">
          <EmptyState title="没有匹配的模型" description="换一个关键词或分组试试" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((model) => (
            <ModelTile key={model.model} model={model} onClick={() => setSelected(model)} />
          ))}
        </div>
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.model ?? ''} width={560}>
        {selected && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {selected.available ? <Badge tone="ok">可用</Badge> : <Badge tone="err">不可用</Badge>}
              <Badge tone="off">{selected.channel_count} 个启用渠道</Badge>
            </div>
            {selected.prices.length > 0 ? (
              <div className="space-y-2">
                {selected.prices.map((price) => (
                  <div key={price.group} className="flex items-center justify-between rounded-md border border-line bg-surface/50 px-3 py-2.5 text-sm">
                    <span className="font-medium text-ink-2">{price.group}</span>
                    <span className="text-ink-2">{priceSummary(price)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-3">该模型暂未配置价格规则。</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function priceSummary(price: PlazaPrice): string {
  if (price.is_free || price.billing_mode === 'free') return '免费'
  if (price.billing_mode === 'per_call') {
    return price.per_call_price > 0 ? `${formatNumber(price.per_call_price)} 额度/次` : '按次'
  }
  return `输入 ${formatNumber(price.prompt_price)} · 输出 ${formatNumber(price.completion_price)} /1M`
}

function ModelTile({ model, onClick }: { model: PlazaModel; onClick: () => void }) {
  const vendor = vendorOf(model.model)
  const price = model.prices?.[0]
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col rounded-lg border border-line bg-card p-4 text-left transition hover:border-line-2 hover:bg-surface/70"
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 text-sm font-semibold ${vendorTone(vendor)}`}>
          {vendorLabel(vendor).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{model.model}</div>
          <div className="text-xs text-ink-3">{vendorLabel(vendor)}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {model.available ? <Badge tone="ok">可用</Badge> : <Badge tone="err">不可用</Badge>}
        {price && <Badge tone={price.is_free ? 'info' : 'brand'}>{priceSummary(price)}</Badge>}
      </div>
    </button>
  )
}