/** 模型广场（公开 /models）：分组筛选 + 表格化模型清单 + 详情弹层。
 *
 * 意图（Why）：
 *   用户要「技术站」，因此把原来的卡片网格改成**表格**——一行一个模型，
 *   列固定为「模型 / 厂商 / 分组 / 价格 / 渠道」，扫视与比价都更快，也更像工程清单。
 *   仍按厂商分区（表内分组行），保留「有什么、什么价」的 10 秒可读性。
 *
 * 流转（Flow）：
 *   SiteHeader → 分组筛选(Tabs) + 搜索 → 表格（按厂商分区）→ 行点击 → 详情弹层 → SiteFooter
 */
'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { fetchModelPlaza } from '@/api/site'
import type { ModelPlaza, PlazaModel, PlazaPrice } from '@/api/types'
import { AppIcon } from '@/components/AppIcon'
import { Badge, EmptyState, Skeleton, Tabs } from '@/components/ui/Display'
import { Modal } from '@/components/ui/Modal'
import { SiteFooter } from '@/components/site/SiteFooter'
import { SiteHeader } from '@/components/site/SiteHeader'
import { useSite } from '@/lib/site/site-context'
import { formatYuanPerCall, formatYuanPerMillion } from '@/utils/money'
import { vendorLabel, vendorOf, vendorTone } from '@/utils/vendor'

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

  /** 按厂商分区，便于在长表里按相似性定位 */
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
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[12px] text-ink-3">
              <span className="text-brand">/</span> models
            </div>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-ink">模型与价格</h1>
            <p className="mt-1 text-[13px] text-ink-3">当前可用模型与分组价格，实时来自站点信息。</p>
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
          <div className="mt-6 overflow-hidden rounded-lg border border-line">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-none border-b border-line" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-card">
            <EmptyState title="没有匹配的模型" description="换一个关键词或分组试试" />
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface">
                <tr className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
                  <th className="px-4 py-2.5 font-normal">模型</th>
                  <th className="hidden px-4 py-2.5 font-normal sm:table-cell">分组</th>
                  <th className="px-4 py-2.5 text-right font-normal">价格</th>
                  <th className="hidden px-4 py-2.5 text-right font-normal md:table-cell">渠道</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {grouped.map(([vendor, models]) => (
                  <Fragment key={vendor}>
                    {/* 厂商分区行：跨越整表，给长表一个视觉锚点 */}
                    <tr className="bg-surface/60">
                      <td colSpan={4} className="px-4 py-1.5">
                        <span className="flex items-center gap-2">
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full ring-1 text-[10px] font-semibold ${vendorTone(vendor)}`}>
                            {vendorLabel(vendor).slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{vendorLabel(vendor)}</span>
                          <span className="text-[11px] text-ink-3">· {models.length}</span>
                        </span>
                      </td>
                    </tr>
                    {models.map((model) => (
                      <ModelRow key={model.model} model={model} onOpen={() => setSelected(model)} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 font-mono text-[12px] text-ink-3">共 {data?.total ?? 0} 个模型</div>
      </main>

      <SiteFooter />

      <ModelDetailModal model={selected} onClose={() => setSelected(null)} />
    </>
  )
}

/* ── 表格行 ─────────────────────────────────────────────── */

function ModelRow({ model, onOpen }: { model: PlazaModel; onOpen: () => void }) {
  const { quotaPerYuan } = useSite()
  const price = model.prices?.[0]
  return (
    <tr className="cursor-pointer bg-card transition hover:bg-surface/60" onClick={onOpen}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-ink">{model.model}</span>
          {model.available ? <Badge tone="ok">可用</Badge> : <Badge tone="err">不可用</Badge>}
        </div>
      </td>
      <td className="hidden px-4 py-2.5 font-mono text-ink-3 sm:table-cell">{model.groups?.join(' / ') || '—'}</td>
      <td className="px-4 py-2.5 text-right text-ink-2">{priceLabel(price, quotaPerYuan)}</td>
      <td className="hidden px-4 py-2.5 text-right font-mono text-ink-3 md:table-cell">{model.channel_count}</td>
    </tr>
  )
}

/** 价格摘要：按计费方式给出一行文案（一律换算成人民币展示） */
function priceLabel(price: PlazaPrice | undefined, quotaPerYuan: number): string {
  if (!price) return '待定价'
  if (price.is_free || price.billing_mode === 'free') return '免费'
  if (price.billing_mode === 'per_call') {
    return price.per_call_price > 0 ? formatYuanPerCall(price.per_call_price, quotaPerYuan) : '按次'
  }
  const prompt = price.prompt_price
  return prompt > 0 ? `${formatYuanPerMillion(prompt, quotaPerYuan)} 输入` : '按量'
}

/* ── 详情弹层 ───────────────────────────────────────────── */

function ModelDetailModal({ model, onClose }: { model: PlazaModel | null; onClose: () => void }) {
  const { quotaPerYuan } = useSite()
  if (!model) return null
  return (
    <Modal open onClose={onClose} title={model.model} width={560}>
      <div className="flex items-center gap-2">
        {model.available ? <Badge tone="ok">可用</Badge> : <Badge tone="err">不可用</Badge>}
        <Badge tone="off">{model.channel_count} 个启用渠道</Badge>
        <Badge tone="info">{model.groups.length} 个分组</Badge>
      </div>

      {model.prices.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-md border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface">
              <tr className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-3 py-2 font-normal">分组</th>
                <th className="px-3 py-2 text-right font-normal">价格</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {model.prices.map((price) => (
                <tr key={price.group}>
                  <td className="px-3 py-2 font-mono text-ink-2">{price.group}</td>
                  <td className="px-3 py-2 text-right text-ink-2">
                    {price.is_free || price.billing_mode === 'free' ? (
                      <Badge tone="info">免费</Badge>
                    ) : price.billing_mode === 'per_call' ? (
                      price.per_call_price > 0 ? formatYuanPerCall(price.per_call_price, quotaPerYuan) : '按次计费'
                    ) : (
                      <>
                        输入 {formatYuanPerMillion(price.prompt_price, quotaPerYuan)} · 输出{' '}
                        {formatYuanPerMillion(price.completion_price, quotaPerYuan)}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">该模型暂未配置价格规则。</p>
      )}
    </Modal>
  )
}
