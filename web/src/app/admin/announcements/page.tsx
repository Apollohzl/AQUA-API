/** 管理后台：站点公告（/admin/announcements）。
 *
 * 意图（Why）：
 *   后台维护公告的完整生命周期：标题/内容/语气/置顶/启停/发布窗口。
 *   公开端只读「当前可见」的公告（fetchPublicAnnouncements），后台可见全部含停用与过期。
 *
 * 流转（Flow）：
 *   load() → listAnnouncements({page, size}) → 表格 + 分页；
 *   新建/编辑走 AnnouncementFormModal → createAnnouncement / updateAnnouncement；
 *   删除走 ConfirmDialog → deleteAnnouncement。
 *
 * 扩展（Extend）：
 *   新增语气等级：同步 announcement.ts 的 AnnouncementLevel、本页徽标 tone 与下拉选项。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
  type AnnouncementLevel,
  type AnnouncementPayload,
} from '@/api/announcement'
import { Badge, Card } from '@/components/ui/Display'
import { DataTable, Pagination, type Column } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Form'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/lib/toast/toast-context'
import { formatDateTime } from '@/utils/format'

const PAGE_SIZE = 20

/** 公告语气 → 徽标配色：info 蓝 / success 绿 / warning 橙 / danger 红 */
function levelTone(level: AnnouncementLevel): 'info' | 'ok' | 'warn' | 'err' {
  switch (level) {
    case 'info': return 'info'
    case 'success': return 'ok'
    case 'warning': return 'warn'
    case 'danger': return 'err'
    default: return 'info'
  }
}

const LEVEL_LABEL: Record<AnnouncementLevel, string> = {
  info: '信息',
  success: '成功',
  warning: '警示',
  danger: '紧急',
}

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Announcement | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const { toast, toastError } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listAnnouncements({ page, size: PAGE_SIZE })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      /* 401 统一处理 */
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteAnnouncement(deleteTarget.id)
      toast('公告已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const columns: Column<Announcement>[] = [
    {
      title: '标题',
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {row.pinned && <span className="text-[13px] leading-none text-brand" title="已置顶">★</span>}
          <span className="font-medium text-ink">{row.title}</span>
        </span>
      ),
    },
    { title: '语气', render: (row) => <Badge tone={levelTone(row.level)}>{LEVEL_LABEL[row.level] ?? row.level_text}</Badge> },
    {
      title: '状态',
      render: (row) => (row.enabled ? <Badge tone="ok">启用</Badge> : <Badge tone="off">停用</Badge>),
    },
    {
      title: '发布开始',
      render: (row) => (
        <span className="text-ink-2">{row.publish_at > 0 ? formatDateTime(row.publish_at) : '立即发布'}</span>
      ),
    },
    {
      title: '到期',
      render: (row) => (
        <span className="text-ink-2">{row.expire_at > 0 ? formatDateTime(row.expire_at) : '永不过期'}</span>
      ),
    },
    { title: '更新时间', render: (row) => <span className="text-ink-2">{formatDateTime(row.updated_at)}</span> },
    {
      title: '操作',
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-2 text-[13px]">
          <button type="button" onClick={() => setEditing(row)} className="text-ink-3 hover:text-brand">
            编辑
          </button>
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
          <h1 className="text-xl font-bold text-ink">站点公告</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">前台横幅与公告列表的内容来源（共 {total} 条）</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>新建公告</Button>
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle="还没有公告"
          emptyDescription="新建一条公告，它将出现在前台横幅与公告列表"
        />
        <div className="px-4 pb-3">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </div>
      </Card>

      <AnnouncementFormModal
        open={editing !== null}
        announcement={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load() }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除公告"
        message={`确认删除公告「${deleteTarget?.title}」？删除后不可恢复。`}
        danger
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── 公告表单弹层 ─────────────────────────────────────── */

function AnnouncementFormModal({
  open,
  announcement,
  onClose,
  onSaved,
}: {
  open: boolean
  announcement: Announcement | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [level, setLevel] = useState<AnnouncementLevel>('info')
  const [pinned, setPinned] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(announcement?.title ?? '')
    setContent(announcement?.content ?? '')
    setLevel(announcement?.level ?? 'info')
    setPinned(announcement?.pinned ?? false)
    setEnabled(announcement?.enabled ?? true)
  }, [open, announcement])

  async function handleSubmit() {
    if (!title.trim()) {
      toastError('请填写公告标题')
      return
    }
    if (!content.trim()) {
      toastError('请填写公告内容')
      return
    }
    setLoading(true)
    try {
      const payload: AnnouncementPayload = {
        title: title.trim(),
        content: content.trim(),
        level,
        pinned,
        enabled,
      }
      if (announcement) {
        await updateAnnouncement(announcement.id, payload)
        toast('公告已更新')
      } else {
        await createAnnouncement(payload)
        toast('公告已创建')
      }
      onSaved()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={announcement ? '编辑公告' : '新建公告'} width={560}>
      <div className="space-y-4">
        <Field label="标题" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="公告标题" />
        </Field>

        <Field label="内容" required>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} placeholder="公告正文" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="语气">
            <Select value={level} onChange={(e) => setLevel(e.target.value as AnnouncementLevel)}>
              <option value="info">信息（蓝）</option>
              <option value="success">成功（绿）</option>
              <option value="warning">警示（橙）</option>
              <option value="danger">紧急（红）</option>
            </Select>
          </Field>

          <div className="flex flex-col gap-3 pt-1">
            <label className="flex items-center justify-between text-[13px] text-ink-2">
              <span>置顶</span>
              <Switch checked={pinned} onChange={setPinned} label="置顶公告" />
            </label>
            <label className="flex items-center justify-between text-[13px] text-ink-2">
              <span>启用</span>
              <Switch checked={enabled} onChange={setEnabled} label="启用公告" />
            </label>
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>{announcement ? '保存' : '创建'}</Button>
      </div>
    </Modal>
  )
}
