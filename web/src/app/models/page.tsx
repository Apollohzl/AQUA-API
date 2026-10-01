/** 模型广场（公开 /models）：分组筛选 + 模型卡片 + 详情弹层。
 *
 * 意图（Why）：
 *   10 秒回答「有什么、什么价」。Z 型流程：顶部分组筛选（起点）→ 卡片网格 → 底部计数。
 *   按厂商分组（vendorOf）做相似性组织，卡片同构保证扫视效率。
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { AppIcon } from '@/components/AppIcon'
import { fetchModelPlaza } from '@/api/site'
import type { ModelPlaza, PlazaGroup, PlazaModel, PlazaPrice } from '@/api/types'
import { Badge, EmptyState, Skeleton } from '@/components/ui/Display'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Display'
import { SiteFooter } from '@/components/site/SiteFooter'
import { SiteHeader } from '@/components/site/SiteHeader'
import { vendorLabel, vendorOf, vendorTone } from '@/utils/vendor'
import { formatNumber } from '@/utils/format'

export default function ModelPlazaPage() {
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

  const grouped = useMemo(() => {
    if (!data) return []
    const map = new Map<string, PlazaModel[]>()
    for (const item of data.items) {
      const vendor = vendorOf(item.model)
      const list = map.get(vendor) ?? []
      list.push(item)
      map.set(vendor, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [data])

  const tabs = useMemo(() => {
    const items: { value: string; label: string; count?: number }[] = [{ value: 'all', label: '全部' }]
    for (const g of data?.groups ?? []) {
      items.push({ value: g.name, label: g.label, count: g.model_count })
    }
    return items
  }, [data])

  return (
    <>
      <SiteHeader transparent={false} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">模型广场</h1>
            <p className="mt-1 text-[13px] text-ink-3">当前可用模型与分组价格</p>
          </div>
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

        <div className="mt-6">
          <Tabs items={tabs as { value: string; label: string; count?: number }[]} value={group} onChange={(v) => setGroup(v)} />
        </div>

        {!data ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-card">
            <EmptyState title="没有匹配的模型" description="换一个关键词或分组试试" />
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {grouped.map(([vendor, models]) => (
              <section key={vendor}>
                <div className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ring-1 text-xs font-semibold ${vendorTone(vendor)}`}>
                    {vendorLabel(vendor).slice(0, 1).toUpperCase()}
                  </span>
                  <h2 className="text-sm font-semibold text-ink-2">{vendorLabel(vendor)}</h2>
                  <span className="text-xs text-ink-3">{models.length} 个</span>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {models.map((model) => (
                    <ModelCard key={model.model} model={model} onClick={() => setSelected(model)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="mt-6 text-center text-xs text-ink-3">
          共 {data?.total ?? 0} 个模型
        </div>
      </main>

      <SiteFooter />

      <ModelDetailModal model={selected} onClose={() => setSelected(null)} />
    </>
  )
}

/* ── 模型卡片 ───────────────────────────────────────────── */

function ModelCard({ model, onClick }: { model: PlazaModel; onClick: () => void }) {
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
        {price?.is_free ? <Badge tone="info">免费</Badge> : <Badge tone="brand">{priceLabel(price)}</Badge>}
        {model.channel_count > 0 && <span className="ml-auto text-xs text-ink-3">{model.channel_count} 渠道</span>}
      </div>
    </button>
  )
}

/** 价格摘要：按计费方式给出一行文案 */
function priceLabel(price: PlazaPrice | undefined): string {
  if (!price) return '待定价'
  if (price.is_free) return '免费'
  if (price.billing_mode === 'per_call') {
    return price.per_call_price > 0 ? `${formatNumber(price.per_call_price)} 额度/次` : '按次'
  }
  if (price.billing_mode === 'free') return '免费'
  const prompt = price.prompt_price
  return prompt > 0 ? `${formatNumber(prompt)} /1M 输入` : '按量'
}

/* ── 详情弹层 ───────────────────────────────────────────── */

function ModelDetailModal({ model, onClose }: { model: PlazaModel | null; onClose: () => void }) {
  if (!model) return null
  return (
    <Modal open onClose={onClose} title={model.model} width={560}>
      <div className="flex items-center gap-2">
        {model.available ? <Badge tone="ok">可用</Badge> : <Badge tone="err">不可用</Badge>}
        <Badge tone="off">{model.channel_count} 个启用渠道</Badge>
        <Badge tone="info">{model.groups.length} 个分组</Badge>
      </div>

      {model.prices.length > 0 ? (
        <div className="mt-4 space-y-2">
          {model.prices.map((price) => (
            <div key={price.group} className="flex items-center justify-between rounded-md border border-line bg-surface/50 px-3 py-2.5 text-sm">
              <span className="font-medium text-ink-2">{price.group}</span>
              <div className="flex items-center gap-2">
                {price.is_free ? (
                  <Badge tone="info">免费</Badge>
                ) : price.billing_mode === 'per_call' ? (
                  <span className="text-ink-2">
                    {price.per_call_price > 0 ? `${formatNumber(price.per_call_price)} 额度/次` : '按次计费'}
                  </span>
                ) : (
                  <span className="text-ink-2">
                    输入 {formatNumber(price.prompt_price)} · 输出 {formatNumber(price.completion_price)}
                    <span className="text-xs text-ink-3"> /1M</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">该模型暂未配置价格规则。</p>
      )}
    </Modal>
  )
}