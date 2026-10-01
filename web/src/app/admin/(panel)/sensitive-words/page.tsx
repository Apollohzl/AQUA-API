/** 管理后台：内容安全 / 敏感词（/admin/sensitive-words）。
 *
 * 意图（Why）：
 *   内容合规过滤由两块配置组成，二者缺一不可，因此放在同一页：
 *     1) 总开关（系统设置里的 safeguard.sensitive_filter_enabled，开关即持久化）；
 *     2) 词表（新建单条 / 批量导入 / 就地启停 / 删除）。
 *   命中词表的请求会被 /v1 入口直接拒绝，直接影响用户可用性，故总开关默认关闭。
 *
 * 流转（Flow）：
 *   本页 → fetchSettings() 读总开关；updateSettings({safeguard:{sensitive_filter_enabled}}) 写总开关
 *   本页 → listSensitiveWords / createSensitiveWord / importSensitiveWords
 *        / updateSensitiveWord / deleteSensitiveWord → /api/admin/sensitive-words
 *
 * 扩展（Extend）：
 *   新增词条属性：同步 types.ts 的 SensitiveWord 与后端 DTO，再在弹层与列表补字段。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { fetchSettings, updateSettings } from '@/api/admin'
import {
  createSensitiveWord,
  deleteSensitiveWord,
  importSensitiveWords,
  listSensitiveWords,
  updateSensitiveWord,
} from '@/api/safeguard'
import type { SensitiveWord, SensitiveWordPayload } from '@/api/types'
import { Badge, Card, EmptyState } from '@/components/ui/Display'
import { Button } from '@/components/ui/Button'
import { Field, Input, Switch, Textarea } from '@/components/ui/Form'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { DataTable, type Column } from '@/components/ui/Table'
import { useToast } from '@/lib/toast/toast-context'
import { formatDateTime } from '@/utils/format'

export default function AdminSensitiveWordsPage() {
  const { toast, toastError } = useToast()

  const [items, setItems] = useState<SensitiveWord[]>([])
  const [total, setTotal] = useState(0)
  const [enabledTotal, setEnabledTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // 总开关（fetchSettings().safeguard.sensitive_filter_enabled）
  const [masterEnabled, setMasterEnabled] = useState(false)
  const [masterBusy, setMasterBusy] = useState(false)

  // 弹层状态
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SensitiveWord | null>(null)
  // 正在就地切换启停的词条 id（0 = 无），用于给对应 Switch 置灰
  const [switchingId, setSwitchingId] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listSensitiveWords()
      setItems(data.items)
      setTotal(data.total)
      setEnabledTotal(data.enabled_total)
    } catch (err) {
      toastError(err instanceof Error ? err.message : '词表加载失败')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    void load()
  }, [load])

  // 总开关初始值来自系统设置
  useEffect(() => {
    void fetchSettings()
      .then((settings) => setMasterEnabled(settings.safeguard?.sensitive_filter_enabled ?? false))
      .catch(() => setMasterEnabled(false))
  }, [])

  /** 总开关切换：乐观更新，失败回滚 */
  async function handleMasterToggle(next: boolean) {
    setMasterEnabled(next)
    setMasterBusy(true)
    try {
      await updateSettings({ safeguard: { sensitive_filter_enabled: next } })
      toast(next ? '敏感词过滤已开启' : '敏感词过滤已关闭')
    } catch (err) {
      setMasterEnabled(!next)
      toastError(err instanceof Error ? err.message : '总开关更新失败')
    } finally {
      setMasterBusy(false)
    }
  }

  /** 列表内就地启停：只提交 enabled 一个字段（后端部分更新） */
  async function handleToggleWord(word: SensitiveWord) {
    setSwitchingId(word.id)
    try {
      await updateSensitiveWord(word.id, { enabled: !word.enabled })
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '启停更新失败')
    } finally {
      setSwitchingId(0)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteSensitiveWord(deleteTarget.id)
      toast('敏感词已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const columns: Column<SensitiveWord>[] = [
    {
      title: '词条',
      render: (row) => <span className="text-[13px] font-medium text-ink">{row.word}</span>,
    },
    {
      title: '分类',
      render: (row) => (row.category ? <Badge tone="info">{row.category}</Badge> : <span className="text-ink-3">—</span>),
    },
    {
      title: '启用',
      align: 'center',
      render: (row) => (
        <div className="flex justify-center">
          <Switch checked={row.enabled} disabled={switchingId === row.id} onChange={() => handleToggleWord(row)} label={`启用词条 ${row.word}`} />
        </div>
      ),
    },
    {
      title: '备注',
      render: (row) => (
        <span className="block max-w-56 truncate text-[13px] text-ink-3" title={row.remark}>{row.remark || '—'}</span>
      ),
    },
    {
      title: '更新时间',
      render: (row) => <span className="whitespace-nowrap text-[13px] text-ink-3">{formatDateTime(row.updated_at)}</span>,
    },
    {
      title: '操作',
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-2 text-[13px]">
          <button type="button" onClick={() => setDeleteTarget(row)} className="text-ink-3 hover:text-err">删除</button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">内容安全</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">
            敏感词过滤总开关：{masterEnabled ? '已开启' : '已关闭'} · 生效中 {enabledTotal} 条
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <Switch checked={masterEnabled} disabled={masterBusy} onChange={handleMasterToggle} label="敏感词过滤总开关" />
            总开关
          </label>
          <Button variant="secondary" onClick={() => setImporting(true)}>批量导入</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>新建词条</Button>
        </div>
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={loading ? null : items}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle="还没有敏感词"
          emptyDescription="新建单条或批量导入，并确保顶部总开关已开启。"
        />
      </Card>

      {/* 新建词条弹层 */}
      <CreateWordModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false)
          void load()
        }}
      />

      {/* 批量导入弹层 */}
      <ImportWordsModal
        open={importing}
        onClose={() => setImporting(false)}
        onSaved={() => {
          setImporting(false)
          void load()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除敏感词"
        message={`确认删除「${deleteTarget?.word}」？删除后该词不再参与匹配。`}
        danger
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── 新建词条弹层 ───────────────────────────────────────── */

function CreateWordModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()
  const [word, setWord] = useState('')
  const [category, setCategory] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setWord('')
    setCategory('')
    setEnabled(true)
    setRemark('')
  }, [open])

  async function handleSubmit() {
    if (!word.trim()) {
      toastError('请填写词条内容')
      return
    }
    setLoading(true)
    try {
      await createSensitiveWord({
        word: word.trim(),
        category: category.trim() || undefined,
        enabled,
        remark: remark.trim() || undefined,
      } as SensitiveWordPayload)
      toast('敏感词已添加')
      onSaved()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="新建敏感词" width={560}>
      <div className="space-y-4">
        <Field label="词条" required help="落库时统一为「去首尾空白 + 小写」，匹配不区分大小写">
          <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="输入需要拦截的词语" />
        </Field>
        <Field label="分类" help="如「违法违规」「广告推广」，可为空">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="可选" />
        </Field>
        <label className="flex items-center justify-between text-[13px] text-ink-2">
          <span>创建后立即启用</span>
          <Switch checked={enabled} onChange={setEnabled} label="创建后立即启用" />
        </label>
        <Field label="备注">
          <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} placeholder="可选" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>添加</Button>
      </div>
    </Modal>
  )
}

/* ── 批量导入弹层 ───────────────────────────────────────── */

function ImportWordsModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()
  const [text, setText] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setText('')
    setCategory('')
  }, [open])

  async function handleSubmit() {
    if (!text.trim()) {
      toastError('请粘贴要导入的词条文本')
      return
    }
    setLoading(true)
    try {
      const result = await importSensitiveWords(text, category.trim())
      toast(`已导入 ${result.imported} 条（解析 ${result.total} 条${result.skipped_invalid ? `，跳过无效 ${result.skipped_invalid} 条` : ''}）`)
      onSaved()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="批量导入敏感词" width={560}>
      <div className="space-y-4">
        <Field label="词条文本" required help="每行一个；也支持用逗号、顿号分隔。已存在的词条会自动跳过">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={'例：\n敏感词A\n敏感词B,敏感词C'} />
        </Field>
        <Field label="统一分类" help="为本批全部词条指定分类，可为空">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="可选" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>导入</Button>
      </div>
    </Modal>
  )
}