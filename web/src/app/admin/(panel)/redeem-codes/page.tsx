/** 管理后台：兑换码（/admin/redeem-codes）。列表（明文 code）+ 关键词/批次筛选 + 批量生成（CodeBlock 分发）+ 作废/删除 + 清理失效；数据经 api/admin.ts 读写 /api/admin/redeem-codes。 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  createRedeemCodes,
  deleteInvalidRedeemCodes,
  deleteRedeemCode,
  listRedeemCodes,
  updateRedeemCode,
} from '@/api/admin'
import type { CreateRedeemCodesResult, RedeemCode } from '@/api/types'
import { REDEEM_STATUS_UNUSED, REDEEM_STATUS_USED, REDEEM_STATUS_VOID } from '@/api/types'
import { Badge, Card, CodeBlock } from '@/components/ui/Display'
import { DataTable, Pagination, type Column } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Form'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/lib/toast/toast-context'
import { formatExpiry, formatNumber } from '@/utils/format'

const PAGE_SIZE = 20

/** 兑换码状态徽标：1 未使用 info / 2 已使用 off / 3 已作废 warn；已过期优先按 warn 展示 */
function RedeemStatusBadge({ code }: { code: RedeemCode }) {
  const tone = code.expired
    ? 'warn'
    : code.status === REDEEM_STATUS_UNUSED
      ? 'info'
      : code.status === REDEEM_STATUS_USED
        ? 'off'
        : 'warn'
  const text = code.expired && code.status === REDEEM_STATUS_UNUSED ? '已过期' : code.status_text
  return <Badge tone={tone}>{text}</Badge>
}

export default function AdminRedeemCodesPage() {
  const [items, setItems] = useState<RedeemCode[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [filters, setFilters] = useState<{ keyword?: string; batch_no?: string }>({})
  const [generateOpen, setGenerateOpen] = useState(false)
  const [voidTarget, setVoidTarget] = useState<RedeemCode | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RedeemCode | null>(null)
  const { toast, toastError } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listRedeemCodes({ page, size: PAGE_SIZE, ...filters })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      /* 401 统一处理 */
    } finally {
      setLoading(false)
    }
  }, [page, filters])

  useEffect(() => {
    void load()
  }, [load])

  function handleSearch() {
    setFilters({ keyword: keyword.trim() || undefined, batch_no: batchNo.trim() || undefined })
    setPage(1)
  }

  function handleReset() {
    setKeyword('')
    setBatchNo('')
    setFilters({})
    setPage(1)
  }

  async function handleVoid() {
    if (!voidTarget) return
    try {
      await updateRedeemCode(voidTarget.id, { status: REDEEM_STATUS_VOID })
      toast('兑换码已作废')
      setVoidTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '作废失败')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteRedeemCode(deleteTarget.id)
      toast('兑换码已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleClearInvalid() {
    try {
      const { deleted } = await deleteInvalidRedeemCodes()
      toast(deleted > 0 ? `已清理 ${deleted} 条失效兑换码` : '没有需要清理的失效兑换码')
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '清理失败')
    }
  }

  const columns: Column<RedeemCode>[] = [
    { title: '兑换码', render: (row) => <code className="font-mono text-[13px] font-medium text-ink">{row.code}</code> },
    {
      title: '额度',
      align: 'right',
      render: (row) => <span className="text-ink-2">{formatNumber(row.quota)}</span>,
    },
    { title: '状态', render: (row) => <RedeemStatusBadge code={row} /> },
    {
      title: '过期',
      render: (row) => <span className="text-[13px] text-ink-3">{formatExpiry(row.expires_at)}</span>,
    },
    { title: '批次', render: (row) => <span className="text-[13px] text-ink-2">{row.batch_no || '—'}</span> },
    { title: '备注', render: (row) => <span className="text-[13px] text-ink-3">{row.remark || '—'}</span> },
    {
      title: '领取用户',
      render: (row) => <span className="text-ink-2">{row.used_by > 0 ? `#${row.used_by}` : '—'}</span>,
    },
    {
      title: '操作',
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-2 text-[13px]">
          {row.status === REDEEM_STATUS_UNUSED && (
            <button type="button" onClick={() => setVoidTarget(row)} className="text-ink-3 hover:text-warn">
              作废
            </button>
          )}
          <button type="button" onClick={() => setDeleteTarget(row)} className="text-ink-3 hover:text-err">
            删除
          </button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">兑换码</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">批量生成、分发与作废兑换码（{total}）</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleClearInvalid}>
            清理失效
          </Button>
          <Button variant="primary" onClick={() => setGenerateOpen(true)}>
            批量生成
          </Button>
        </div>
      </div>

      {/* 筛选条：关键词（码/备注）+ 批次号 */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-60">
          <Field label="关键词" htmlFor="rc-keyword">
            <Input
              id="rc-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="兑换码 / 备注"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch()
              }}
            />
          </Field>
        </div>
        <div className="w-52">
          <Field label="批次号" htmlFor="rc-batch">
            <Input
              id="rc-batch"
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder="批次号"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch()
              }}
            />
          </Field>
        </div>
        <Button variant="secondary" onClick={handleSearch}>
          查询
        </Button>
        <Button variant="ghost" onClick={handleReset}>
          重置
        </Button>
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle="没有符合条件的兑换码"
          emptyDescription="调整筛选条件，或点「批量生成」创建一批新码"
        />
        <div className="px-4 pb-3">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </div>
      </Card>

      <RedeemGenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onSaved={() => void load()}
      />

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="作废兑换码"
        message={`确认作废兑换码「${voidTarget?.code}」？作废后用户将无法兑换。`}
        danger
        confirmText="作废"
        onConfirm={handleVoid}
        onCancel={() => setVoidTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除兑换码"
        message={`确认删除兑换码「${deleteTarget?.code}」？删除后不可恢复。`}
        danger
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── 批量生成弹层：表单 → 成功后切换展示本批明文码 ───────── */

function RedeemGenerateModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()
  const [count, setCount] = useState('10')
  const [quota, setQuota] = useState('1000')
  const [expiresDays, setExpiresDays] = useState('0')
  const [remark, setRemark] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CreateRedeemCodesResult | null>(null)

  useEffect(() => {
    if (!open) return
    setCount('10')
    setQuota('1000')
    setExpiresDays('0')
    setRemark('')
    setBatchNo('')
    setResult(null)
  }, [open])

  async function handleSubmit() {
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      toastError('生成数量需为 1~500 的整数')
      return
    }
    const q = Number(quota)
    if (!Number.isFinite(q) || q < 0) {
      toastError('请填写正确的额度')
      return
    }
    setLoading(true)
    try {
      const data = await createRedeemCodes({
        count: n,
        quota: q,
        expires_days: Number(expiresDays || 0),
        remark: remark.trim() || undefined,
        batch_no: batchNo.trim() || undefined,
      })
      setResult(data)
      toast(`已生成 ${data.count} 张兑换码`)
      onSaved()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }

  // 生成成功：切换为结果面板（CodeBlock 供复制分发），列表已由 onSaved 刷新
  if (result) {
    return (
      <Modal open={open} onClose={onClose} title="兑换码生成成功" width={560}>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone="ok">生成成功</Badge>
            <span className="text-sm text-ink-2">
              批次 {result.batch_no || '—'} · 共 {result.count} 张
            </span>
          </div>
          <CodeBlock code={result.items.map((item) => item.code).join('\n')} title="本批兑换码（复制分发）" />
          <div className="text-xs text-ink-3">请尽快复制分发；关闭后仍可在列表中查看本批明文码。</div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="批量生成兑换码" width={560}>
      <div className="space-y-4">
        <Field label="生成数量" required help="1~500 之间的整数">
          <Input value={count} onChange={(e) => setCount(e.target.value)} type="number" placeholder="10" />
        </Field>

        <Field label="每张额度" required help="用户兑换后获得的额度">
          <Input value={quota} onChange={(e) => setQuota(e.target.value)} type="number" placeholder="1000" />
        </Field>

        <Field label="有效期（天）" help="0 表示永不过期">
          <Input value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} type="number" placeholder="0" />
        </Field>

        <Field label="备注">
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="给本批码写个说明（如：双十一活动）" />
        </Field>

        <Field label="批次号" help="留空由服务端按时间自动生成">
          <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="如 20261001-A" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>
          生成
        </Button>
      </div>
    </Modal>
  )
}