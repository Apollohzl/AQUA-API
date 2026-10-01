/** 管理后台：异步任务（/admin/tasks）。
 *
 * 意图（Why）：
 *   全站图像/视频/音乐等异步生成任务的调度面板：筛选 + 进度 + 结果 + 取消。
 *   任务在执行中状态会变化，因此用 setInterval 每 5 秒静默轮询刷新，
 *   卸载时清除定时器，避免后台空转。
 *
 * 流转（Flow）：
 *   初次/筛选变化 → load()（带 loading）；轮询 → load(true)（静默刷新，不闪骨架屏）；
 *   取消 → ConfirmDialog → cancelTask(task_ref) → 重新拉列表。
 *
 * 扩展（Extend）：
 *   新增任务类别：同步 types.ts 的 TASK_KIND_* 与本页筛选下拉的选项。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { cancelTask, listAllTasks } from '@/api/admin'
import type { Task } from '@/api/types'
import { TASK_STATUS_CANCELED, TASK_STATUS_FAILED, TASK_STATUS_QUEUED, TASK_STATUS_RUNNING, TASK_STATUS_SUCCEEDED } from '@/api/types'
import { Badge, Card } from '@/components/ui/Display'
import { DataTable, Pagination, type Column } from '@/components/ui/Table'
import { Select } from '@/components/ui/Form'
import { ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/lib/toast/toast-context'
import { formatDateTime } from '@/utils/format'

const PAGE_SIZE = 20
/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 5000

function statusTone(status: number): 'ok' | 'warn' | 'err' | 'off' | 'brand' | 'info' {
  switch (status) {
    case TASK_STATUS_SUCCEEDED: return 'ok'
    case TASK_STATUS_RUNNING: return 'brand'
    case TASK_STATUS_QUEUED: return 'info'
    case TASK_STATUS_FAILED: return 'err'
    case TASK_STATUS_CANCELED: return 'warn'
    default: return 'off'
  }
}

/** 终态（成功/失败/取消）不可再取消 */
function isFinal(status: number): boolean {
  return status === TASK_STATUS_SUCCEEDED || status === TASK_STATUS_FAILED || status === TASK_STATUS_CANCELED
}

export default function AdminTasksPage() {
  const [items, setItems] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState(0)
  const [loading, setLoading] = useState(true)
  const [cancelTarget, setCancelTarget] = useState<Task | null>(null)
  const { toast, toastError } = useToast()

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const data = await listAllTasks({
          page,
          size: PAGE_SIZE,
          kind,
          status: status === 0 ? undefined : status,
        })
        setItems(data.items)
        setTotal(data.total)
      } catch {
        /* 401 统一处理 */
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [page, kind, status],
  )

  useEffect(() => {
    void load()
  }, [load])

  // 任务在执行中状态会变：每 5 秒静默轮询一次，卸载时清除
  useEffect(() => {
    const timer = setInterval(() => {
      void load(true)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  /** 筛选变化时回到第一页，避免停留在超出结果集的页码 */
  function handleKindChange(value: string) {
    setKind(value)
    setPage(1)
  }

  function handleStatusChange(value: string) {
    setStatus(Number(value))
    setPage(1)
  }

  async function handleCancel() {
    if (!cancelTarget) return
    try {
      await cancelTask(cancelTarget.task_ref)
      toast('任务已取消，额度已退还')
      setCancelTarget(null)
      void load(true)
    } catch (err) {
      toastError(err instanceof Error ? err.message : '取消失败')
    }
  }

  const columns: Column<Task>[] = [
    { title: '任务', render: (row) => <span className="max-w-44 truncate text-[13px] text-ink-2" title={row.task_ref}>{row.task_ref}</span> },
    { title: '用户', align: 'right', render: (row) => <span className="text-ink-2">#{row.user_id}</span> },
    { title: '类别', render: (row) => <span className="text-ink-2">{row.kind_text}</span> },
    { title: '模型', render: (row) => <span className="text-ink-2">{row.model || '—'}</span> },
    { title: '状态', render: (row) => <Badge tone={statusTone(row.status)}>{row.status_text}</Badge> },
    {
      title: '进度',
      render: (row) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, row.progress)}%` }} />
          </div>
          <span className="text-xs text-ink-3">{row.progress}%</span>
        </div>
      ),
    },
    {
      title: '结果',
      render: (row) =>
        row.result_url ? (
          <a href={row.result_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">查看结果</a>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    { title: '创建时间', render: (row) => <span className="text-ink-2">{formatDateTime(row.created_at)}</span> },
    {
      title: '操作',
      align: 'right',
      render: (row) =>
        isFinal(row.status) ? (
          <span className="text-ink-3/50">—</span>
        ) : (
          <button type="button" onClick={() => setCancelTarget(row)} className="text-[13px] text-ink-3 hover:text-err">
            取消
          </button>
        ),
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">异步任务</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">全站图像 / 视频 / 音乐生成任务（每 5 秒自动刷新）</p>
      </div>

      {/* 筛选条：类别 + 状态 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={kind}
          onChange={(e) => handleKindChange(e.target.value)}
          className="w-36"
          aria-label="按类别筛选"
        >
          <option value="">全部类别</option>
          <option value="image">图像</option>
          <option value="video">视频</option>
          <option value="music">音乐</option>
        </Select>
        <Select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="w-36"
          aria-label="按状态筛选"
        >
          <option value={0}>全部状态</option>
          <option value={1}>排队</option>
          <option value={2}>执行中</option>
          <option value={3}>成功</option>
          <option value={4}>失败</option>
          <option value={5}>已取消</option>
        </Select>
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.task_ref}
          emptyTitle="没有符合条件的任务"
          emptyDescription="调整筛选条件，或等待新任务产生"
        />
        <div className="px-4 pb-3">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="取消任务"
        message={`确认取消任务「${cancelTarget?.task_ref}」？将退还对应额度。`}
        danger
        confirmText="取消任务"
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
