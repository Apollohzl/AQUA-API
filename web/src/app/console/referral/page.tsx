/** 用户门户：邀请奖励（/console/referral）。
 *
 * 意图（Why）：
 *   邀请码/链接展示 + 签到按钮 + 返利流水，三个增长动作收敛一页。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { checkin, fetchReferral, listMyReferralRewards, type ReferralInfo } from '@/api/referral'
import type { ReferralReward } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, StatCard } from '@/components/ui/Display'
import { DataTable, Pagination, type Column } from '@/components/ui/Table'
import { CopyButton } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Display'
import { useToast } from '@/lib/toast/toast-context'
import { useSite } from '@/lib/site/site-context'
import { formatDateTime } from '@/utils/format'
import { formatYuanFromQuota } from '@/utils/money'

const PAGE_SIZE = 20

export default function ConsoleReferralPage() {
  const [info, setInfo] = useState<ReferralInfo | null>(null)
  const [rewards, setRewards] = useState<ReferralReward[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const { toast, toastError } = useToast()
  const { quotaPerYuan } = useSite()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, rews] = await Promise.all([
        fetchReferral(),
        listMyReferralRewards({ page, size: PAGE_SIZE }),
      ])
      setInfo(r)
      setRewards(rews.items)
      setTotal(rews.total)
    } catch {
      /* 401 统一处理 */
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCheckin() {
    try {
      const result = await checkin()
      setInfo((prev) => (prev ? { ...prev, checkin: result } : prev))
      toast(result.daily_quota > 0 ? `签到成功，获得 ${formatYuanFromQuota(result.daily_quota, quotaPerYuan)}` : '签到成功')
    } catch (err) {
      toastError(err instanceof Error ? err.message : '签到失败')
    }
  }

  const inviteUrl = info ? `${typeof window !== 'undefined' ? window.location.origin : ''}${info.invite_path}` : ''

  const columns: Column<ReferralReward>[] = [
    { title: '类型', render: (row) => <Badge tone={row.kind === 'register' ? 'info' : 'brand'}>{row.kind_text}</Badge> },
    { title: '返利', align: 'right', render: (row) => <span className="text-ink-2">+{formatYuanFromQuota(row.quota, quotaPerYuan)}</span> },
    { title: '来源', render: (row) => <span className="text-ink-2">{row.invitee}</span> },
    { title: '时间', render: (row) => <span className="text-ink-2">{formatDateTime(row.created_at)}</span> },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">邀请奖励</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">邀请好友注册，双方都有奖励</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="text-sm font-semibold text-ink-2">我的邀请链接</div>
          {info ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2.5 font-mono text-xs text-ink">
                <span className="truncate">{inviteUrl}</span>
                <CopyButton text={inviteUrl} label="复制" />
              </div>
              <div className="text-[13px] text-ink-3">
                已邀请 {info.invited_count} 人 · 注册奖 {formatYuanFromQuota(info.register_bonus_quota, quotaPerYuan)}
                {info.recharge_ratio > 0 && ` · 充值返利 ${info.recharge_ratio}%`}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-[13px] text-ink-3">加载中…</div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-ink-2">每日签到</div>
            {info?.checkin.checked_today && <Badge tone="ok">今日已签</Badge>}
          </div>
          {info ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-semibold text-ink">{info.checkin.streak_days}</div>
                  <div className="text-xs text-ink-3">连续天数</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-ink">{info.checkin.total_days}</div>
                  <div className="text-xs text-ink-3">累计天数</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-ink">{formatYuanFromQuota(info.checkin.total_quota, quotaPerYuan)}</div>
                  <div className="text-xs text-ink-3">累计返利</div>
                </div>
              </div>
              {info.checkin.enabled && (
                <Button variant="primary" className="w-full" disabled={info.checkin.checked_today} onClick={handleCheckin}>
                  {info.checkin.checked_today ? '明天再来' : '立即签到'}
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-3 text-[13px] text-ink-3">加载中…</div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="累计返利" value={info ? formatYuanFromQuota(info.total_reward_quota, quotaPerYuan) : '—'} />
      </div>

      <Card padding="none">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink-2">返利明细</div>
        <DataTable columns={columns} rows={loading ? null : rewards} loading={loading} rowKey={(row) => row.id} emptyTitle="还没有返利记录" />
        <div className="px-4 pb-3">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </div>
      </Card>
    </div>
  )
}