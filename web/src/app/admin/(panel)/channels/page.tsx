/** 管理后台：渠道管理（/admin/channels）。
 *
 * 意图（Why）：
 *   渠道是网关的「上游接入点」。列表 + 新建/编辑弹层 + 测活 + 启停/删除。
 *   表单按渠道类型目录（fetchChannelTypes）做触发式渲染，密钥池支持批量粘贴。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  createChannel,
  deleteChannel,
  fetchChannelTypes,
  fetchUpstreamModels,
  listChannels,
  testChannel,
  updateChannel,
} from '@/api/admin'
import type { Channel, ChannelPayload, ChannelTestResult, ChannelType, FetchModelsPayload } from '@/api/types'
import { ChannelHealthPanel } from '@/components/admin/ChannelHealthPanel'
import { ChannelKeyPool } from '@/components/admin/ChannelKeyPool'
import { SpeedTestModal } from '@/components/admin/SpeedTestModal'
import { Badge, Card, EmptyState, Tabs } from '@/components/ui/Display'
import { DataTable, Pagination, type Column } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Form'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/lib/toast/toast-context'
import { channelStatusLabel, channelStatusBadgeClass } from '@/utils/display'
import { formatDateTime } from '@/utils/format'

const PAGE_SIZE = 20

export default function AdminChannelsPage() {
  const [items, setItems] = useState<Channel[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [types, setTypes] = useState<ChannelType[]>([])
  const [editing, setEditing] = useState<Channel | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null)
  const [testResult, setTestResult] = useState<ChannelTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  // 模型测速弹层的目标渠道（null = 关闭）：与测活分开，两者口径不同
  //（测活=通不通；测速=每个模型各有多快）。
  const [speedTarget, setSpeedTarget] = useState<Channel | null>(null)

  const { toast, toastError } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listChannels({ page, size: PAGE_SIZE })
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

  useEffect(() => {
    void fetchChannelTypes().then((data) => setTypes(data.items)).catch(() => setTypes([]))
  }, [])

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteChannel(deleteTarget.id)
      toast('渠道已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleToggle(channel: Channel) {
    try {
      await updateChannel(channel.id, { status: channel.status === 1 ? 2 : 1 } as Partial<ChannelPayload>)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '操作失败')
    }
  }

  async function handleTest(channel: Channel) {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testChannel(channel.id)
      setTestResult(result)
    } catch (err) {
      toastError(err instanceof Error ? err.message : '测活失败')
    } finally {
      setTesting(false)
    }
  }

  const columns: Column<Channel>[] = [
    { title: '名称', render: (row) => <span className="font-medium text-ink">{row.name}</span> },
    { title: '类型', render: (row) => <span className="text-ink-2">{row.type_key || `#${row.type}`}</span> },
    {
      title: '模型',
      render: (row) => <span className="max-w-44 truncate text-[13px] text-ink-3" title={row.models.join(', ')}>{row.models.length > 0 ? `${row.models.length} 个模型` : '全部模型'}</span>,
    },
    {
      // 密钥池运行态的"一览"信号：以「启用/总数」+ 异常数提示哪条渠道的凭据在掉队。
      // 元数据来自渠道列表响应里的 key_pool 概览（后端一次 GROUP BY 下发，无额外请求）。
      title: '密钥池',
      align: 'right',
      width: 'hidden sm:table-cell',
      className: 'hidden sm:table-cell',
      render: (row) => {
        const pool = row.key_pool
        if (!pool || pool.total === 0) return <span className="text-[13px] text-ink-3">单密钥</span>
        const degraded = pool.disabled + pool.auto_removed
        return (
          <span className="inline-flex items-center gap-2 text-[13px]">
            <span className="tabular-nums text-ink-2">{pool.enabled}/{pool.total}</span>
            {degraded > 0 && <Badge tone="warn">{degraded} 异常</Badge>}
          </span>
        )
      },
    },
    {
      title: '状态',
      render: (row) => (
        <span className={channelStatusBadgeClass(row.status)}>{channelStatusLabel(row.status)}</span>
      ),
    },
    { title: '测活', render: (row) => <span className="text-ink-2">{row.last_test_ok ? <Badge tone="ok">通过</Badge> : <Badge tone="off">未测</Badge>}</span> },
    {
      title: '操作',
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-2 text-[13px]">
          <button type="button" onClick={() => setSpeedTarget(row)} className="text-ink-3 hover:text-brand" disabled={row.models.length === 0}>测速</button>
          <button type="button" onClick={() => handleTest(row)} className="text-ink-3 hover:text-brand" disabled={testing}>测活</button>
          <button type="button" onClick={() => setEditing(row)} className="text-ink-3 hover:text-brand">编辑</button>
          <button type="button" onClick={() => handleToggle(row)} className="text-ink-3 hover:text-brand">{row.status === 1 ? '停用' : '启用'}</button>
          <button type="button" onClick={() => setDeleteTarget(row)} className="text-ink-3 hover:text-err">删除</button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">渠道管理</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">上游接入渠道（{total}）</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>新建渠道</Button>
      </div>

      {/* 健康概览：渠道状态分布 + 近 24h 全站调用健康度 */}
      <ChannelHealthPanel />

      <Card padding="none">
        <DataTable columns={columns} rows={loading ? null : items} loading={loading} rowKey={(row) => row.id} emptyTitle="还没有渠道" />
        <div className="px-4 pb-3">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </div>
      </Card>

      {/* 测活结果弹层 */}
      <Modal open={Boolean(testResult)} onClose={() => setTestResult(null)} title="渠道测活结果" width={560}>
        {testResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {testResult.ok ? <Badge tone="ok">通过</Badge> : <Badge tone="err">失败</Badge>}
              <span className="text-sm text-ink-2">{testResult.message}</span>
            </div>
            {testResult.latency_ms > 0 && <div className="text-[13px] text-ink-3">耗时 {testResult.latency_ms}ms</div>}
            {testResult.upstream_body && (
              <div className="rounded-md border border-line bg-surface p-3 text-xs text-ink-2">
                <div className="mb-1 font-medium text-ink-3">上游响应</div>
                <code className="break-all">{testResult.upstream_body}</code>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 模型测速弹层：逐模型测首字延迟。关闭时刷新列表——
          自动屏蔽（403/404）可能改了渠道的模型清单，需要反映到表格。 */}
      <SpeedTestModal
        open={speedTarget !== null}
        channelId={speedTarget?.id ?? null}
        channelName={speedTarget?.name}
        models={speedTarget?.models ?? []}
        onClose={() => {
          setSpeedTarget(null)
          void load()
        }}
      />

      <ChannelFormModal
        open={editing !== null}
        channel={editing === 'new' ? null : editing}
        types={types}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load() }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除渠道"
        message={`确认删除渠道「${deleteTarget?.name}」？删除后该渠道的调用将立即失败。`}
        danger
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── 渠道表单弹层 ───────────────────────────────────────── */

function ChannelFormModal({
  open,
  channel,
  types,
  onClose,
  onSaved,
}: {
  open: boolean
  channel: Channel | null
  types: ChannelType[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()
  const [name, setName] = useState('')
  const [type, setType] = useState(1)
  const [typeKey, setTypeKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [keysText, setKeysText] = useState('')
  const [status, setStatus] = useState(1)
  const [loading, setLoading] = useState(false)
  // 「从上游获取模型」进行中：按钮转圈并防止重复点击
  const [fetchingModels, setFetchingModels] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(channel?.name ?? '')
    setType(channel?.type ?? 1)
    // 用 typeKey 做类型下拉的受控值：优先取目录中匹配的 key（编辑时 type 可能对应历史编号）
    const initialType = channel?.type ?? 1
    setType(initialType)
    setTypeKey(types.find((t) => t.key === String(initialType))?.key ?? types[0]?.key ?? '')
    setBaseUrl(channel?.base_url ?? '')
    setApiKey('')
    setModelsText((channel?.models ?? []).join('\n'))
    setKeysText('')
    setStatus(channel?.status ?? 1)
  }, [open, channel, types])

  const selectedType = types.find((t) => t.key === typeKey) ?? types[0]

  /** 从上游拉取模型清单并合并进输入框（不覆盖已填写的条目）。
   *
   * 凭据策略（与后端 handleFetchModels 的两种模式对齐）：
   *   - 编辑态 + 未填新密钥 + 地址未改 → 传 channel_id，后端用库中地址与
   *     密钥（含密钥池兜底）拉取——这正是"渠道已配好，同步一下清单"的场景；
   *   - 其余情况（新建、或表单里改了地址/密钥）→ 传表单当前值，
   *     拉到的一定是"即将保存的这套配置"的真实清单。
   */
  async function handleFetchModels() {
    const url = baseUrl.trim()
    const key = apiKey.trim()
    const useSaved = channel != null && !key && url === channel.base_url
    if (!useSaved && !url) {
      toastError('请先填写上游地址')
      return
    }
    setFetchingModels(true)
    try {
      const payload: FetchModelsPayload = useSaved
        ? { channel_id: channel.id }
        : { base_url: url, api_key: key || undefined }
      const result = await fetchUpstreamModels(payload)
      const existing = modelsText.split('\n').map((s) => s.trim()).filter(Boolean)
      const seen = new Set(existing)
      const added = result.models.filter((m) => !seen.has(m))
      if (added.length === 0) {
        toast(`已获取 ${result.count} 个模型（清单没有变化）`)
      } else {
        setModelsText([...existing, ...added].join('\n'))
        toast(`已获取 ${result.count} 个模型，合并新增 ${added.length} 个`)
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toastError('请填写渠道名称')
      return
    }
    if (!channel && !apiKey.trim()) {
      toastError('新建渠道必须填写上游密钥')
      return
    }
    if (!channel && !baseUrl.trim()) {
      toastError('新建渠道必须填写上游地址')
      return
    }
    setLoading(true)
    try {
      const payload: ChannelPayload = {
        name: name.trim(),
        type,
        type_key: typeKey || undefined,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim() || undefined,
        models: modelsText.split('\n').map((s) => s.trim()).filter(Boolean),
        group: 'default',
        groups: ['default'],
        priority: 0,
        weight: 0,
        status,
        keys_text: keysText.trim() || undefined,
      }
      if (channel) {
        delete payload.api_key
        delete payload.keys_text
        await updateChannel(channel.id, payload)
        toast('渠道已更新')
      } else {
        await createChannel(payload)
        toast('渠道已创建')
      }
      onSaved()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={channel ? '编辑渠道' : '新建渠道'} width={760}>
      <div className="space-y-4">
        <Field label="渠道名称" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="给这个上游起个名字" />
        </Field>

        <Field label="渠道类型" help={selectedType?.notes}>
          {types.length > 0 ? (
            <Select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
              {types.map((t) => (
                <option key={t.key} value={t.key} disabled={!t.available}>{t.label}</option>
              ))}
            </Select>
          ) : (
            <Input value={type} onChange={(e) => setType(Number(e.target.value))} type="number" placeholder="渠道类型编号" />
          )}
        </Field>

        <Field label="上游地址" required={!channel}>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={selectedType?.default_base_url || 'https://api.example.com'} />
        </Field>

        <Field label="上游密钥" required={!channel} help={channel ? '留空表示不修改' : '同时支持密钥池：每行一把，可用空格或逗号附备注'}>
          <Textarea value={apiKey} onChange={(e) => setApiKey(e.target.value)} rows={2} placeholder="sk-..." />
        </Field>

        {!channel && (
          <Field label="密钥池（可选）" help="每行一把，批量粘贴多把上游密钥">
            <Textarea value={keysText} onChange={(e) => setKeysText(e.target.value)} rows={3} placeholder="sk-a\nsk-b 备注1" />
          </Field>
        )}

        <Field label="模型列表" help="每行一个；留空表示支持全部模型">
          {/* 一键从上游拉取：省去逐个手敲模型名（长名字极易敲错导致路由失效）。
              合并而非覆盖——已填写的条目可能是管理员刻意收敛过的子集。 */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3">支持从上游自动拉取清单，结果合并到下方</span>
            <Button
              variant="secondary"
              size="sm"
              loading={fetchingModels}
              onClick={handleFetchModels}
              disabled={!fetchingModels && !baseUrl.trim() && channel == null}
            >
              从上游获取
            </Button>
          </div>
          <Textarea value={modelsText} onChange={(e) => setModelsText(e.target.value)} rows={5} placeholder="gpt-4o\nclaude-3-5-sonnet" />
        </Field>

        <label className="flex items-center justify-between text-[13px] text-ink-2">
          <span>启用渠道</span>
          <Switch checked={status === 1} onChange={(v) => setStatus(v ? 1 : 2)} />
        </label>
      </div>

      {/* 密钥池运行态：仅编辑已有渠道时展示（新建时还没有渠道 ID，没有明细可查）。
          放在表单下方独立分区，既不打乱"填表"的主线，又能就近观察凭据健康状况。 */}
      {channel && (
        <div className="mt-5 border-t border-line pt-4">
          <ChannelKeyPool channelId={channel.id} />
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>{channel ? '保存' : '创建'}</Button>
      </div>
    </Modal>
  )
}