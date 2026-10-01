/** 管理后台：令牌管理（/admin/tokens）。列表 + 新建弹层（含一次性明文 key 提示保存）+ 编辑（状态/额度）+ 删除；数据经 api/admin.ts 读写 /api/admin/tokens。 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { createTokenForUser, deleteToken, listAllTokens, updateToken } from '@/api/admin'
import type { AccessToken, AdminUpdateTokenPayload, CreateTokenPayload } from '@/api/types'
import { STATUS_DISABLED, STATUS_ENABLED } from '@/api/types'
import { Badge, Card } from '@/components/ui/Display'
import { DataTable, Pagination, type Column } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Field, Input, Switch } from '@/components/ui/Form'
import { Modal, ConfirmDialog, CopyButton } from '@/components/ui/Modal'
import { useToast } from '@/lib/toast/toast-context'
import { formatExpiry, formatNumber, formatQuota, parseModelList } from '@/utils/format'

const PAGE_SIZE = 20

export default function AdminTokensPage() {
  const [items, setItems] = useState<AccessToken[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AccessToken | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccessToken | null>(null)
  const { toast, toastError } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listAllTokens({ page, size: PAGE_SIZE })
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
      await deleteToken(deleteTarget.id)
      toast('令牌已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const columns: Column<AccessToken>[] = [
    { title: 'ID', render: (row) => <span className="text-ink-3">#{row.id}</span> },
    { title: '名称', render: (row) => <span className="font-medium text-ink">{row.name}</span> },
    { title: '密钥', render: (row) => <code className="font-mono text-[13px] text-ink-2">{row.masked_key}</code> },
    {
      title: '状态',
      render: (row) => (
        <Badge tone={row.status === STATUS_ENABLED ? 'ok' : 'off'}>
          {row.status_text ?? (row.status === STATUS_ENABLED ? '启用' : '停用')}
        </Badge>
      ),
    },
    {
      title: '额度',
      align: 'right',
      render: (row) => <span className="text-ink-2">{formatQuota(row.remain_quota, row.unlimited_quota)}</span>,
    },
    {
      title: '已用',
      align: 'right',
      render: (row) => <span className="text-ink-2">{formatNumber(row.used_quota)}</span>,
    },
    {
      title: '到期',
      render: (row) => <span className="text-[13px] text-ink-3">{formatExpiry(row.expires_at)}</span>,
    },
    {
      title: '归属用户',
      render: (row) => <span className="text-ink-2">{row.username ?? (row.user_id ? `#${row.user_id}` : '—')}</span>,
    },
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
          <h1 className="text-xl font-bold text-ink">令牌管理</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">全站 API 访问令牌（{total}）</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          新建令牌
        </Button>
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle="还没有令牌"
          emptyDescription="为用户创建的 API 令牌会出现在这里"
        />
        <div className="px-4 pb-3">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </div>
      </Card>

      <TokenFormModal
        open={editing !== null}
        token={editing === 'new' ? null : editing}
        onClose={() => {
          setEditing(null)
          void load()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除令牌"
        message={`确认删除令牌「${deleteTarget?.name}」？使用该令牌的调用将立即失败。`}
        danger
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── 令牌表单弹层（新建含一次性明文 key 展示） ──────────── */

function TokenFormModal({
  open,
  token,
  onClose,
}: {
  open: boolean
  token: AccessToken | null
  onClose: () => void
}) {
  const { toast, toastError } = useToast()
  // 新建字段
  const [name, setName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('0')
  const [modelsText, setModelsText] = useState('')
  const [userId, setUserId] = useState('')
  // 新建/编辑共用
  const [unlimited, setUnlimited] = useState(false)
  const [remainQuota, setRemainQuota] = useState('')
  const [status, setStatus] = useState(STATUS_ENABLED)
  const [loading, setLoading] = useState(false)
  // 新建成功后的一次性明文密钥
  const [createdKey, setCreatedKey] = useState('')

  useEffect(() => {
    if (!open) return
    setName(token?.name ?? '')
    setExpiresInDays('0')
    setModelsText('')
    setUserId('')
    setUnlimited(token?.unlimited_quota ?? false)
    setRemainQuota(token ? String(token.remain_quota) : '')
    setStatus(token?.status ?? STATUS_ENABLED)
    setCreatedKey('')
  }, [open, token])

  async function handleSubmit() {
    if (createdKey) return // 已创建成功，等待关闭
    if (!token && !name.trim()) {
      toastError('请填写令牌名称')
      return
    }
    if (!token && !userId.trim()) {
      toastError('请填写归属用户 ID')
      return
    }
    setLoading(true)
    try {
      if (token) {
        const payload: AdminUpdateTokenPayload = {
          status,
          unlimited_quota: unlimited,
          remain_quota: Number(remainQuota || 0),
        }
        await updateToken(token.id, payload)
        toast('令牌已更新')
        onClose()
      } else {
        const payload: CreateTokenPayload = {
          name: name.trim(),
          expires_in_days: Number(expiresInDays || 0),
          models: parseModelList(modelsText),
          unlimited_quota: unlimited,
          remain_quota: unlimited ? 0 : Number(remainQuota || 0),
          user_id: Number(userId.trim()),
        }
        const result = await createTokenForUser(payload)
        setCreatedKey(result.key)
        toast('令牌已创建')
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={createdKey ? '令牌已创建' : token ? '编辑令牌' : '新建令牌'}
      width={560}
    >
      {createdKey ? (
        /* 一次性明文密钥：warn 强调「仅此一次」，配合 CopyButton 快速保存 */
        <div className="space-y-4">
          <div className="rounded-md border border-warn/40 bg-warn/10 p-4">
            <div className="flex items-center gap-2">
              <Badge tone="warn">仅此一次</Badge>
              <span className="text-sm font-medium text-warn">请立即复制保存，关闭后不再显示明文</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
              <code className="break-all font-mono text-[13px] text-ink">{createdKey}</code>
              <CopyButton text={createdKey} label="复制密钥" className="shrink-0" />
            </div>
          </div>
          <div className="text-xs text-ink-3">明文密钥仅返回一次；丢失后只能删除重建，无法找回。</div>
        </div>
      ) : (
        <div className="space-y-4">
          {!token && (
            <>
              <Field label="令牌名称" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="给这个令牌起个名字" />
              </Field>

              <Field label="有效期（天）" help="0 表示永不过期">
                <Input value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} type="number" placeholder="0" />
              </Field>

              <Field label="模型限制" help="逗号分隔模型名；留空表示不限制模型">
                <Input value={modelsText} onChange={(e) => setModelsText(e.target.value)} placeholder="gpt-4o, claude-3-5-sonnet" />
              </Field>

              <Field label="归属用户 ID" required help="为该用户创建令牌">
                <Input value={userId} onChange={(e) => setUserId(e.target.value)} type="number" placeholder="用户 ID" />
              </Field>
            </>
          )}

          {token && (
            <Field label="状态">
              <div className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2">
                <span className="text-[13px] text-ink-2">{status === STATUS_ENABLED ? '启用' : '停用'}</span>
                <Switch checked={status === STATUS_ENABLED} onChange={(v) => setStatus(v ? STATUS_ENABLED : STATUS_DISABLED)} />
              </div>
            </Field>
          )}

          <Field label="不限额度">
            <div className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2">
              <span className="text-[13px] text-ink-2">不限制可用额度</span>
              <Switch checked={unlimited} onChange={setUnlimited} />
            </div>
          </Field>

          <Field label="可用额度" help={unlimited ? '不限额度时无需填写' : '该令牌可消耗的额度上限'}>
            <Input
              value={remainQuota}
              onChange={(e) => setRemainQuota(e.target.value)}
              type="number"
              placeholder="0"
              disabled={unlimited}
            />
          </Field>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {createdKey ? (
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" loading={loading} onClick={handleSubmit}>
              {token ? '保存' : '创建'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}