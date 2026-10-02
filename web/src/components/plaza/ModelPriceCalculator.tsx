/** 定价试算器：输入用量，实时估算一次调用的花费。
 *
 * 意图（Why）：
 *   价格表只给出"每百万 token 多少元"，用户很难折算成"我这次调用要花多少"。
 *   试算器把这段换算替用户算掉，并在结果里回显「命中了哪条规则、什么倍率」，
 *   让"为什么是这个价"变得可解释；代理视图下还顺带印证了拿货折扣。
 *
 *   本组件【本地计算】（见 pricing.ts 的 localQuote），与后端计费链路同口径；
 *   不调用 /api/admin/prices/quote —— 那是管理员接口，公开广场无权访问。
 *
 * 流转（Flow）：
 *   PlazaPrice[]（当前模型的逐分组价格）
 *     → 选择分组 → 输入用量 → localQuote() → formatYuanFromQuota() → 展示
 *
 * 扩展（Extend）：
 *   新增输入维度（如缓存命中率）时：在 QuoteInput 加字段 + 加输入框 + 传入 localQuote。
 */
'use client'

import { useMemo, useState } from 'react'

import type { PlazaPrice, PlazaViewer } from '@/api/types'
import { AppIcon } from '@/components/AppIcon'
import { Badge } from '@/components/ui/Display'
import { Field, Input, Select } from '@/components/ui/Form'
import { formatYuanFromQuota, formatYuanPerCall } from '@/utils/money'

import {
  QUOTE_MAX_COUNT,
  QUOTE_MAX_TOKENS,
  billingKindLabel,
  billingKindOf,
  cachePriceLabel,
  localQuote,
  ratioLabel,
  type QuoteInput,
} from './pricing'

interface Props {
  /** 当前模型的逐分组价格（非代理视图可能多条；代理视图只有一条） */
  prices: PlazaPrice[]
  viewer?: PlazaViewer
  quotaPerYuan: number
}

/** 输入框文本 → 非负数值（空串/非法按 0） */
function toNum(text: string): number {
  const v = Number(text)
  return Number.isFinite(v) && v > 0 ? v : 0
}

export function ModelPriceCalculator({ prices, viewer, quotaPerYuan }: Props) {
  const [group, setGroup] = useState(prices[0]?.group ?? '')
  const [prompt, setPrompt] = useState('1000')
  const [completion, setCompletion] = useState('1000')
  const [cached, setCached] = useState('0')
  const [count, setCount] = useState('1')

  const price = useMemo(() => prices.find((p) => p.group === group) ?? prices[0], [prices, group])
  const kind = billingKindOf(price)
  const cacheLabel = cachePriceLabel(price, quotaPerYuan)

  const result = useMemo(() => {
    const input: QuoteInput = {
      promptTokens: toNum(prompt),
      completionTokens: toNum(completion),
      cachedTokens: toNum(cached),
      count: toNum(count),
    }
    return localQuote(price, input)
  }, [price, prompt, completion, cached, count])

  if (prices.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface/50 p-4 text-[13px] text-ink-3">
        该模型暂未配置价格规则，无法试算。
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-line bg-surface/50 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <AppIcon name="bolt" size={15} className="text-brand" />
        <h4 className="text-[13px] font-semibold text-ink">费用试算</h4>
        <span className="text-[12px] text-ink-3">按下方价格本地估算，结果仅供参考</span>
      </div>

      {/* 分组选择：多分组时让用户切换，代理视图只有一档无需选择 */}
      {prices.length > 1 ? (
        <div className="mt-3">
          <Field label="计费分组">
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              {prices.map((p) => (
                <option key={p.group} value={p.group}>
                  {p.group} · {ratioLabel(p.ratio)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[12px] text-ink-3">
          <span>{prices[0].group}</span>
          <span>·</span>
          <span>{ratioLabel(viewer ? viewer.ratio : prices[0].ratio)}</span>
          <Badge tone={kind === 'free' ? 'info' : 'brand'}>{billingKindLabel(kind)}</Badge>
        </div>
      )}

      {kind === 'free' ? (
        <div className="mt-3 rounded-md border border-line bg-card px-3.5 py-3 text-[13px] text-ink-2">
          该分组的模型标记为免费，调用不计费。
        </div>
      ) : kind === 'per_call' ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="调用次数" help={`本次调用按次计费，单次 ${formatYuanPerCall(price?.per_call_price ?? 0, quotaPerYuan)}`}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={QUOTE_MAX_COUNT}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="输入 token 数" help="prompt 部分的 token 数量">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={QUOTE_MAX_TOKENS}
              step={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>
          <Field label="输出 token 数" help="completion 部分的 token 数量">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={QUOTE_MAX_TOKENS}
              step={1}
              value={completion}
              onChange={(e) => setCompletion(e.target.value)}
            />
          </Field>
          {/* 仅在配置了缓存价时才提供该输入：未配置时命中部分本就直接按输入价计，
              给了输入框反而让人误以为能省缓存钱 */}
          {cacheLabel && (
            <Field label="其中命中缓存 token 数" help={`命中缓存单价 ${cacheLabel}，留空/0 表示未命中`}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={QUOTE_MAX_TOKENS}
                step={1}
                value={cached}
                onChange={(e) => setCached(e.target.value)}
              />
            </Field>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-md border border-line bg-card px-3.5 py-3">
        <div>
          <div className="text-[12px] text-ink-3">预估花费</div>
          <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-ink">
            {result ? formatYuanFromQuota(result.quota, quotaPerYuan) : '—'}
          </div>
          {result && !result.isFree && (
            <div className="mt-0.5 font-mono text-[11px] text-ink-3">= {result.quota} 额度</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {result ? (
            result.isFree ? (
              <Badge tone="info">免费</Badge>
            ) : (
              <Badge tone="brand">{billingKindLabel(result.kind)}</Badge>
            )
          ) : null}
          <span className="max-w-[18rem] text-right text-[11px] text-ink-3">{ruleText(price, result, count, quotaPerYuan)}</span>
        </div>
      </div>
    </div>
  )
}

/** 组装"命中哪条价格规则"的说明文案（分组 + 计费方式 + 倍率 / 次数） */
function ruleText(
  price: PlazaPrice | undefined,
  result: ReturnType<typeof localQuote>,
  countText: string,
  quotaPerYuan: number,
): string {
  if (!price || !result) return '该分组没有价格规则，无法试算'
  if (result.kind === 'free') return `分组「${price.group}」命中「免费」规则，不计费`
  if (result.kind === 'per_call') {
    const n = toNum(countText) || 1
    return `分组「${price.group}」· 按次 ${formatYuanPerCall(price.per_call_price, quotaPerYuan)} × ${n} 次`
  }
  return `分组「${price.group}」· 按量 · ${ratioLabel(price.ratio)}`
}
