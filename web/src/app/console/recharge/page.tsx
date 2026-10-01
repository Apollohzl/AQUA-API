/** 用户门户：账户充值（/console/recharge）。
 *
 * 意图（Why）：
 *   单一决策点：选金额 → 选支付方式 → 下单跳收银台。金额档位 + 自定义输入，
 *   支付方式由后端 /api/payment/public 下发（含子方式），前端用多行选项渲染。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { createOrder, getMyOrder } from '@/api/portal'
import { fetchPaymentInfo } from '@/api/site'
import type { PublicPaymentInfo } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Display'
import { useToast } from '@/lib/toast/toast-context'

const PRESETS = [10, 30, 50, 100, 200, 500]

export default function ConsoleRechargePage() {
  const [info, setInfo] = useState<PublicPaymentInfo | null>(null)
  const [amount, setAmount] = useState<number>(30)
  const [custom, setCustom] = useState('')
  const [method, setMethod] = useState('')
  const [subMethod, setSubMethod] = useState('')
  const [loading, setLoading] = useState(false)
  const { toastError } = useToast()

  const load = useCallback(async () => {
    try {
      const data = await fetchPaymentInfo()
      setInfo(data)
      if (data.methods.length > 0) setMethod(data.methods[0].name)
    } catch {
      /* 提示状态由下方展示 */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const effectiveAmount = custom ? Number(custom) : amount

  async function handleOrder() {
    if (!method) {
      toastError('请选择支付方式')
      return
    }
    setLoading(true)
    try {
      const order = await createOrder({
        amount_cents: Math.round(effectiveAmount * 100),
        method,
        sub_method: subMethod || undefined,
      })
      if (order.pay_url) {
        // 跳第三方收银台；回到本站后由支付页轮询确认
        window.location.href = order.pay_url
      } else {
        toastError('下单成功但未获取到支付地址，请联系管理员')
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '下单失败')
    } finally {
      setLoading(false)
    }
  }

  if (!info?.enabled) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold text-ink">账户充值</h1>
        <Card>
          <p className="text-sm text-ink-2">本站当前未开放在线充值。如需充值请联系管理员。</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">账户充值</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">
          1 元 = {info.exchange_rate} 额度 · 单笔 {info.min_cents / 100} 元起
        </p>
      </div>

      <Card>
        <div className="text-sm font-semibold text-ink-2">选择金额（元）</div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setAmount(value); setCustom('') }}
              className={`rounded-md border px-3 py-2.5 text-sm font-medium transition ${
                !custom && amount === value ? 'border-brand bg-brand/8 text-brand' : 'border-line-2 text-ink-2 hover:border-brand/40'
              }`}
            >
              ¥{value}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-ink-3">自定义：</span>
          <input
            type="number"
            min={info.min_cents / 100}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="输入金额"
            className="h-9 w-32 rounded-md border border-line-2 bg-card px-3 text-sm outline-none focus:border-brand"
          />
          <span className="text-xs text-ink-3">元</span>
        </div>
      </Card>

      {info.methods.length > 0 && (
        <Card>
          <div className="text-sm font-semibold text-ink-2">支付方式</div>
          <div className="mt-3 space-y-2">
            {info.methods.map((item) => {
              const ready = item.ready
              return item.sub_methods.length > 0 ? (
                <div key={item.name} className="rounded-md border border-line p-3">
                  <div className="text-sm font-medium text-ink-2">{item.label}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.sub_methods.map((sub) => (
                      <button
                        key={sub.name}
                        type="button"
                        disabled={!ready}
                        onClick={() => { setMethod(item.name); setSubMethod(sub.name) }}
                        className={`rounded-md border px-3 py-1.5 text-[13px] transition disabled:opacity-40 ${
                          method === item.name && subMethod === sub.name
                            ? 'border-brand bg-brand/8 text-brand'
                            : 'border-line-2 text-ink-2 hover:border-brand/40'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  key={item.name}
                  type="button"
                  disabled={!ready}
                  onClick={() => { setMethod(item.name); setSubMethod('') }}
                  className={`flex w-full items-center justify-start gap-2 rounded-md border px-3 py-2.5 text-sm transition disabled:opacity-40 ${
                    method === item.name ? 'border-brand bg-brand/8 text-brand' : 'border-line-2 text-ink-2 hover:border-brand/40'
                  }`}
                >
                  {item.label}
                  {!ready && <span className="text-xs text-warn">通道未就绪</span>}
                </button>
              )
            })}
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between rounded-lg border border-line bg-card p-4">
        <div>
          <div className="text-sm text-ink-3">应付金额</div>
          <div className="text-2xl font-bold text-ink">¥{effectiveAmount ? effectiveAmount.toFixed(2) : '0.00'}</div>
        </div>
        <Button variant="primary" size="lg" loading={loading} disabled={!effectiveAmount || effectiveAmount <= 0} onClick={handleOrder}>
          立即支付
        </Button>
      </div>
    </div>
  )
}