/** 管理后台：用户管理（/admin/users）。列表 + 新建/编辑弹层（角色/状态/额度）+ 删除确认；数据经 api/admin.ts 读写 /api/admin/users。 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { createUser, deleteUser, listUsers, updateUser } from '@/api/admin'
import type { AdminUser, CreateUserPayload, UpdateUserPayload } from '@/api/types'
import { STATUS_DISABLED, STATUS_ENABLED } from '@/api/types'
import { Badge, Card } from '@/components/ui/Display'
import { DataTable, Pagination, type Column } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Switch } from '@/components/ui/Form'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/lib/toast/toast-context'
import { roleLabel } from '@/utils/display'
import { formatDateTime } from '@/utils/format'
import { quotaToYuanInput, yuanToQuota, formatYuanFromQuota } from '@/utils/money'
import { useSite } from '@/lib/site/site-context'

const PAGE_SIZE = 20

/** 用户额度 → 输入框回填值：-1 表示不限（契约），其余换算为人民币 */
function userQuotaInput(quota: number | null | undefined, quotaPerYuan: number): string {
  const q = Number(quota ?? 0)
  if (q < 0) return '-1'
  return quotaToYuanInput(q, quotaPerYuan)
}

export default function AdminUsersPage() {
  const { quotaPerYuan } = useSite()
  const [items, setItems] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AdminUser | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const { toast, toastError } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUsers({ page, size: PAGE_SIZE })
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
      await deleteUser(deleteTarget.id)
      toast('用户已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const columns: Column<AdminUser>[] = [
    { title: 'ID', render: (row) => <span className="text-ink-3">#{row.id}</span> },
    { title: '用户名', render: (row) => <span className="font-medium text-ink">{row.username}</span> },
    { title: '邮箱', render: (row) => <span className="text-ink-2">{row.email || '—'}</span> },
    {
      title: '角色',
      render: (row) => <Badge tone={row.role === 10 ? 'brand' : 'off'}>{roleLabel(row.role)}</Badge>,
    },
    {
      title: '状态',
      render: (row) => (
        <Badge tone={row.status === STATUS_ENABLED ? 'ok' : 'off'}>
          {row.status === STATUS_ENABLED ? '启用' : '停用'}
        </Badge>
      ),
    },
    {
      // 代理标记：一眼看出哪些账号在按批发档看模型广场
      title: '代理',
      render: (row) =>
        row.agent_group ? (
          <Badge tone="warn">{row.agent_group}</Badge>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      title: '余额',
      align: 'right',
      render: (row) => <span className="text-ink-2">{formatYuanFromQuota(row.quota, quotaPerYuan)}</span>,
    },
    {
      title: '已用',
      align: 'right',
      render: (row) => <span className="text-ink-2">{formatYuanFromQuota(row.used_quota, quotaPerYuan)}</span>,
    },
    {
      title: '注册时间',
      render: (row) => <span className="text-[13px] text-ink-3">{formatDateTime(row.created_at)}</span>,
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
          <h1 className="text-xl font-bold text-ink">用户管理</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">平台全部注册用户（{total}）</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          新建用户
        </Button>
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle="还没有用户"
          emptyDescription="注册用户会出现在这里"
        />
        <div className="px-4 pb-3">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </div>
      </Card>

      <UserFormModal
        open={editing !== null}
        user={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除用户"
        message={`确认删除用户「${deleteTarget?.username}」？该用户的令牌将一并失效。`}
        danger
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── 用户表单弹层 ───────────────────────────────────────── */

function UserFormModal({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean
  user: AdminUser | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()
  const { quotaPerYuan } = useSite()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(1)
  const [status, setStatus] = useState(STATUS_ENABLED)
  // 额度以人民币录入（元），提交时换算成契约额度
  const [quota, setQuota] = useState('')
  // 代理分组名：非空即该账号在模型广场按此分组的模型与折扣价展示
  const [agentGroup, setAgentGroup] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setUsername(user?.username ?? '')
    setPassword('')
    setEmail(user?.email ?? '')
    setRole(user?.role ?? 1)
    setStatus(user?.status ?? STATUS_ENABLED)
    setQuota(user ? userQuotaInput(user.quota, quotaPerYuan) : '')
    setAgentGroup(user?.agent_group ?? '')
  }, [open, user, quotaPerYuan])

  async function handleSubmit() {
    if (!username.trim()) {
      toastError('请填写用户名')
      return
    }
    if (!user && !password) {
      toastError('请设置初始密码')
      return
    }
    setLoading(true)
    try {
      if (user) {
        const payload: UpdateUserPayload = {
          email: email.trim() || undefined,
          role,
          status,
          // 恒提交（含空串）：空串 = 取消代理资格，这是后台表单的明确意图
          agent_group: agentGroup.trim(),
        }
        // 额度输入留空视为不修改（避免编辑时误把额度清零）；
        // 输入为人民币，提交时换算成契约额度
        if (quota.trim() !== '') {
          const value = Number(quota)
          if (!Number.isFinite(value)) {
            toastError('额度需为数字')
            return
          }
          payload.quota = yuanToQuota(value, quotaPerYuan) ?? Math.round(value)
        }
        await updateUser(user.id, payload)
        toast('用户已更新')
      } else {
        const payload: CreateUserPayload = {
          username: username.trim(),
          password,
          role,
        }
        if (email.trim()) payload.email = email.trim()
        if (agentGroup.trim()) payload.agent_group = agentGroup.trim()
        await createUser(payload)
        toast('用户已创建')
      }
      onSaved()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={user ? '编辑用户' : '新建用户'} width={560}>
      <div className="space-y-4">
        <Field label="用户名" required>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="登录用户名" disabled={Boolean(user)} />
        </Field>

        {!user && (
          <Field label="初始密码" required>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="设置登录密码" autoComplete="new-password" />
          </Field>
        )}

        <Field label="邮箱">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="选填" />
        </Field>

        <Field label="角色">
          <Select value={role} onChange={(e) => setRole(Number(e.target.value))}>
            <option value={1}>普通用户</option>
            <option value={10}>管理员</option>
          </Select>
        </Field>

        {user && (
          <>
            <Field label="状态">
              <div className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2">
                <span className="text-[13px] text-ink-2">{status === STATUS_ENABLED ? '启用' : '停用'}</span>
                <Switch checked={status === STATUS_ENABLED} onChange={(v) => setStatus(v ? STATUS_ENABLED : STATUS_DISABLED)} />
              </div>
            </Field>

            <Field label="余额（¥）" help="用户当前的可用余额（元）；-1 = 不限；留空表示不修改">
              <Input value={quota} onChange={(e) => setQuota(e.target.value)} type="number" placeholder="留空表示不修改" />
            </Field>
          </>
        )}

        <Field
          label="代理分组"
          help="填分组标识（如 agent）后，该账号在模型广场只看到该分组下的模型与代理折扣价；留空 = 普通用户"
        >
          <Input value={agentGroup} onChange={(e) => setAgentGroup(e.target.value)} placeholder="留空 = 普通用户" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>
          {user ? '保存' : '创建'}
        </Button>
      </div>
    </Modal>
  )
}