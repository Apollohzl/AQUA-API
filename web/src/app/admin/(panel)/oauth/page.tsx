/** 管理后台：订阅账号 OAuth 提供方（/admin/oauth）。列表 + 新建/编辑弹层（client_secret 留空不修改）+ 删除；数据经 api/admin.ts 读写 /api/admin/oauth-providers。 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { createOAuthProvider, deleteOAuthProvider, listOAuthProviders, updateOAuthProvider } from '@/api/admin'
import type { OAuthProvider, OAuthProviderPayload } from '@/api/types'
import { Badge, Card } from '@/components/ui/Display'
import { DataTable, type Column } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Field, Input, Switch } from '@/components/ui/Form'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/lib/toast/toast-context'

export default function AdminOAuthPage() {
  const [items, setItems] = useState<OAuthProvider[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<OAuthProvider | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = useState<OAuthProvider | null>(null)
  const { toast, toastError } = useToast()

  // 接口不分页：一次取回全部提供方（数量级很小），因此本页不渲染 Pagination
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listOAuthProviders()
      setItems(data.items)
      setTotal(data.total)
    } catch {
      /* 401 统一处理 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteOAuthProvider(deleteTarget.id)
      toast('提供方已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const columns: Column<OAuthProvider>[] = [
    { title: '名称', render: (row) => <span className="font-medium text-ink">{row.name}</span> },
    {
      title: '令牌地址',
      render: (row) => (
        <span className="max-w-56 block truncate text-[13px] text-ink-2" title={row.token_url}>
          {row.token_url}
        </span>
      ),
    },
    { title: 'Client ID', render: (row) => <code className="font-mono text-[13px] text-ink-2">{row.client_id}</code> },
    { title: 'Scope', render: (row) => <span className="text-[13px] text-ink-2">{row.scope || '—'}</span> },
    {
      title: '启用',
      render: (row) => <Badge tone={row.enabled ? 'ok' : 'off'}>{row.enabled ? '启用' : '停用'}</Badge>,
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
          <h1 className="text-xl font-bold text-ink">订阅账号</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">OAuth 提供方配置，订阅账号凭据刷新令牌时使用（{total}）</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          新建提供方
        </Button>
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle="还没有 OAuth 提供方"
          emptyDescription="新建提供方后，订阅账号凭据才能刷新访问令牌"
        />
      </Card>

      <OAuthFormModal
        open={editing !== null}
        provider={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除提供方"
        message={`确认删除 OAuth 提供方「${deleteTarget?.name}」？使用它的订阅账号凭据将无法再刷新令牌。`}
        danger
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── OAuth 提供方表单弹层 ──────────────────────────────── */

function OAuthFormModal({
  open,
  provider,
  onClose,
  onSaved,
}: {
  open: boolean
  provider: OAuthProvider | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()
  const [name, setName] = useState('')
  const [tokenUrl, setTokenUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [scope, setScope] = useState('')
  const [remark, setRemark] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(provider?.name ?? '')
    setTokenUrl(provider?.token_url ?? '')
    setClientId(provider?.client_id ?? '')
    setClientSecret('') // 明文永不回显，编辑时留空表示不修改
    setScope(provider?.scope ?? '')
    setRemark(provider?.remark ?? '')
    setEnabled(provider?.enabled ?? true)
  }, [open, provider])

  async function handleSubmit() {
    if (!name.trim()) {
      toastError('请填写提供方名称')
      return
    }
    if (!tokenUrl.trim()) {
      toastError('请填写令牌地址')
      return
    }
    if (!clientId.trim()) {
      toastError('请填写 Client ID')
      return
    }
    if (!provider && !clientSecret.trim()) {
      toastError('新建提供方必须填写 Client Secret')
      return
    }
    setLoading(true)
    try {
      const payload: OAuthProviderPayload = {
        name: name.trim(),
        token_url: tokenUrl.trim(),
        client_id: clientId.trim(),
        scope: scope.trim() || undefined,
        remark: remark.trim() || undefined,
        enabled,
      }
      if (provider) {
        if (clientSecret.trim()) payload.client_secret = clientSecret.trim()
        await updateOAuthProvider(provider.id, payload)
        toast('提供方已更新')
      } else {
        payload.client_secret = clientSecret.trim()
        await createOAuthProvider(payload)
        toast('提供方已创建')
      }
      onSaved()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={provider ? '编辑提供方' : '新建提供方'} width={560}>
      <div className="space-y-4">
        <Field label="名称" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 ChatGPT / Codex" />
        </Field>

        <Field label="令牌地址" required help="OAuth2 token 端点（换 access_token 用）">
          <Input value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} placeholder="https://auth.openai.com/oauth/token" />
        </Field>

        <Field label="Client ID" required>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth 客户端 ID" />
        </Field>

        <Field label="Client Secret" required={!provider} help={provider ? '明文永不回显，留空表示不修改' : 'OAuth 客户端密钥'}>
          <Input
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            type="password"
            placeholder={provider ? '留空表示不修改' : 'OAuth 客户端密钥'}
            autoComplete="new-password"
          />
        </Field>

        <Field label="Scope" help="授权范围，空格分隔；留空表示使用默认范围">
          <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="openid profile email" />
        </Field>

        <Field label="备注">
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
        </Field>

        <Field label="启用">
          <div className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2">
            <span className="text-[13px] text-ink-2">启用该提供方</span>
            <Switch checked={enabled} onChange={setEnabled} />
          </div>
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>
          {provider ? '保存' : '创建'}
        </Button>
      </div>
    </Modal>
  )
}