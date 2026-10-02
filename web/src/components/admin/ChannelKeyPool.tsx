/** 渠道密钥池运行态：每把密钥的存活状况 + 冷却倒计时。
 *
 * 意图（Why）：
 *   密钥池是"多把上游凭据轮询"的调度单元，它出事时的表现是"渠道整体时好时坏"——
 *   只有把每把密钥的【冷却剩余 / 连续失败 / 失败原因】摆出来，站长才能判断
 *   是"个别密钥坏了"还是"整个上游在抖"。冷却中的密钥给 warn 色 + 倒计时，
 *   让"什么时候会恢复"一眼可见。
 *
 * 流转（Flow）：
 *   渠道编辑弹层 → <ChannelKeyPool channelId={id}/> → listChannelKeysWithBalance(id)
 *   → GET /api/admin/channels/:id/keys
 *   字段全部来自后端 channelKeyDTO（见 internal/server/dto.go），前端不臆造字段名。
 *
 * 扩展（Extend）：
 *   - 冷却结束的"自动恢复可用"由本地 setInterval 每秒重算剩余时间实现，无需后端推送；
 *   - 需要"RPM 使用率"时后端需补「当前分钟已用请求数」字段（当前 DTO 只有 rpm_limit 上限
 *     与 in_flight 在途数，二者单位不同，不能相除当使用率）；本组件暂以「限速 / 在途」展示；
 *   - 「余额/额度耗尽」判定直接用后端下发的派生布尔 balance_exhausted / quota_exhausted，
 *     规则只在领域层维护一处，前端不再自行实现阈值。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { listChannelKeysWithBalance, type ChannelKeyWithBalance } from '@/api/channel'
import { KEY_STATUS_AUTO_REMOVED, KEY_STATUS_ENABLED, type ChannelKey } from '@/api/types'
import { Badge, EmptyState, SkeletonRows } from '@/components/ui/Display'
import { Button } from '@/components/ui/Button'

interface ChannelKeyPoolProps {
  /** 渠道 ID；变化时重新拉取该渠道的密钥明细 */
  channelId: number
}

/** 冷却剩余秒数（<=0 表示不在冷却）。cooldown_until 是 Unix 秒，now 是毫秒时间戳 */
function cooldownSeconds(cooldownUntil: number, nowMs: number): number {
  if (!cooldownUntil) return 0
  return Math.max(0, cooldownUntil - Math.floor(nowMs / 1000))
}

/** 剩余秒 → 「还有 X 分 Y 秒 / X 时 Y 分」 */
function formatCooldown(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `还有 ${h} 时 ${m} 分`
  if (m > 0) return `还有 ${m} 分 ${s} 秒`
  return `还有 ${s} 秒`
}

/** 密钥状态 → 徽标（文案优先用后端下发的 status_text，避免前端硬编码中英映射） */
function KeyStatusBadge({ item }: { item: ChannelKey }) {
  if (item.status === KEY_STATUS_ENABLED) return <Badge tone="ok">{item.status_text || '启用'}</Badge>
  if (item.status === KEY_STATUS_AUTO_REMOVED) return <Badge tone="err">{item.status_text || '已摘除'}</Badge>
  return <Badge tone="off">{item.status_text || '禁用'}</Badge>
}

export function ChannelKeyPool({ channelId }: ChannelKeyPoolProps) {
  const [items, setItems] = useState<ChannelKeyWithBalance[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 每秒刷新的"当前时刻"，用于把 cooldown_until 换算成倒计时并在到期后自动变回可用
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listChannelKeysWithBalance(channelId)
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '密钥池加载失败')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    void load()
  }, [load])

  // 倒计时心跳：组件卸载（弹层关闭）时必须清理，否则会持续 setState 造成泄漏
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const coolingCount = items?.filter((k) => cooldownSeconds(k.cooldown_until, now) > 0).length ?? 0
  // 被「余额/额度耗尽」排除的凭据数：余额（API Key）与订阅额度（OAuth）任一耗尽即计入，
  // 判定直接用后端派生布尔，避免前端另行实现阈值规则。
  const exhaustedCount = items?.filter((k) => k.balance_exhausted || k.quota_exhausted).length ?? 0
  // 整池都耗尽：调度会跳过全部凭据，渠道事实上不可用——必须让站长一眼看到并去补录。
  const allExhausted = (items?.length ?? 0) > 0 && exhaustedCount === items?.length

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">密钥池运行态</h3>
        {items && items.length > 0 && (
          <span className="text-xs text-ink-3">
            共 {items.length} 把{coolingCount > 0 ? ` · ${coolingCount} 把冷却中` : ''}
          </span>
        )}
      </div>
      {allExhausted ? (
        <Badge tone="err">全部凭据余额/额度耗尽</Badge>
      ) : exhaustedCount > 0 ? (
        <Badge tone="warn">{exhaustedCount} 把余额/额度耗尽</Badge>
      ) : coolingCount > 0 ? (
        <Badge tone="warn">{coolingCount} 把冷却中</Badge>
      ) : null}
    </div>
  )

  if (loading && items === null) {
    return (
      <div className="space-y-3">
        {header}
        <SkeletonRows rows={2} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        {header}
        <div className="flex items-center gap-3 text-[13px] text-err">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (!items || items.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded-md border border-line">
          <EmptyState title="该渠道未配置密钥池" description="仍走单密钥模式；需要多把凭据轮询时可在下方表单批量粘贴。" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {header}
      {allExhausted && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-err/40 bg-err/10 px-3 py-2 text-[13px] text-err">
          <Badge tone="err">余额耗尽</Badge>
          <span>该渠道全部 {items?.length} 把凭据的余额/额度已耗尽，调度会跳过整池。请补录余额或更换凭据。</span>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-line">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface/70 text-ink-3">
                <th className="px-3 py-2 text-left font-medium">密钥</th>
                <th className="px-3 py-2 text-left font-medium">状态</th>
                <th className="px-3 py-2 text-left font-medium">冷却</th>
                <th className="px-3 py-2 text-right font-medium">连续失败</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">失败原因</th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">限速 / 在途</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const remaining = cooldownSeconds(item.cooldown_until, now)
                const cooling = remaining > 0
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-line/70 last:border-0 ${cooling ? 'bg-warn/5' : ''}`}
                  >
                    {/* 掩码密钥 + 备注；kind_text 让"订阅账号"与"API Key"一眼可分 */}
                    <td className="px-3 py-2">
                      <div className="font-mono text-ink-2">{item.masked_key || '—'}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                        <span>{item.kind_text || item.kind}</span>
                        {item.label && <span className="truncate" title={item.label}>· {item.label}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <KeyStatusBadge item={item} />
                        {(item.balance_exhausted || item.quota_exhausted) && (
                          <Badge tone="err">{item.balance_exhausted ? '余额耗尽' : '额度耗尽'}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {cooling ? (
                        <Badge tone="warn">{formatCooldown(remaining)}</Badge>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.fail_count > 0 ? <span className="text-warn">{item.fail_count}</span> : <span className="text-ink-3">0</span>}
                    </td>
                    <td className="hidden max-w-56 px-3 py-2 sm:table-cell">
                      {item.last_error ? (
                        <span className="block truncate text-ink-3" title={item.last_error}>
                          {item.last_error}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                      <span className="text-ink-2">{item.rpm_limit > 0 ? `限速 ${item.rpm_limit}` : '不限速'}</span>
                      {item.in_flight > 0 && <span className="text-ink-3"> · 在途 {item.in_flight}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
