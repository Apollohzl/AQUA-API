<script setup lang="ts">
/**
 * 管理后台 · 内容安全：敏感词过滤（词表维护 + 总开关）。
 *
 * 意图（Why）：
 *   网关对外提供生成能力，站长需要对明显违规的输入做最低成本的管控；
 *   同时部分上游会因内容违规封禁整个渠道。本页是这套能力的唯一入口，
 *   要保证两件事对站长始终清楚：
 *     1) 过滤现在是【开还是关】——开关未开时词表填了也不会生效，
 *        这是最容易造成"我配了但没效果"的误解点，因此放在页面最上方；
 *     2) 词条【当前是否参与匹配】——停用的词条仍在表里但不会拦截，
 *        列表里用徽标明确区分，而不是直接删掉（保留便于随时恢复）。
 *
 *   命中后返回给用户的文案不包含词条本身：词表一旦被试探出内容，
 *   使用者就能通过改写绕过。因此本页也不提供"上次命中了哪个词"的明细。
 *
 * 流转（Flow）：
 *   进入页面 → fetchSettings()（读总开关）+ listSensitiveWords() → 表格
 *   新增 → Modal 表单 → createSensitiveWord
 *   批量导入 → 文本域 → importSensitiveWords（后端按换行/逗号切分并跳过重复）
 *   启停/删除 → updateSensitiveWord / deleteSensitiveWord
 *   任一写操作 → 后端立即失效词表缓存，无需等待轮询
 *
 * 扩展（Extend）：
 *   新增词条属性（如"仅记录不拦截"）时：在 types.ts 的 SensitiveWord 与后端
 *   model.SensitiveWord 加字段，并在本页表格与表单各补一处。
 */
import { computed, onMounted, ref } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import DataState from '@/components/DataState.vue'
import Modal from '@/components/Modal.vue'
import { ApiError } from '@/api/client'
import { fetchSettings, updateSettings } from '@/api/admin'
import {
  createSensitiveWord,
  deleteSensitiveWord,
  importSensitiveWords,
  listSensitiveWords,
  updateSensitiveWord,
} from '@/api/safeguard'
import type { SensitiveWord } from '@/api/types'
import { confirmDialog } from '@/composables/useConfirm'
import { toastError, toastSuccess } from '@/composables/useToast'

const words = ref<SensitiveWord[]>([])
const loading = ref(true)
const error = ref('')

/** 总开关（来自系统设置；本页只负责这一个字段） */
const filterEnabled = ref(false)
const togglingSwitch = ref(false)

/** 本地筛选：词表不参与分页，直接在前端过滤更顺手 */
const keyword = ref('')

const formOpen = ref(false)
const editing = ref<SensitiveWord | null>(null)
const saving = ref(false)
const formError = ref('')
const form = ref({ word: '', category: '', enabled: true, remark: '' })

const importOpen = ref(false)
const importText = ref('')
const importCategory = ref('')
const importing = ref(false)
const importError = ref('')

const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return words.value
  return words.value.filter(
    (item) =>
      item.word.toLowerCase().includes(needle) ||
      item.category.toLowerCase().includes(needle) ||
      item.remark.toLowerCase().includes(needle),
  )
})

const enabledCount = computed(() => words.value.filter((item) => item.enabled).length)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await listSensitiveWords()
    words.value = result.items ?? []
  } catch (err) {
    words.value = []
    error.value = err instanceof ApiError ? err.message : '敏感词加载失败'
  } finally {
    loading.value = false
  }
}

async function loadSwitch(): Promise<void> {
  try {
    const settings = await fetchSettings()
    // safeguard 缺失（后端未升级）时保持关闭的默认态，不阻断词表维护
    filterEnabled.value = settings.safeguard?.sensitive_filter_enabled === true
  } catch {
    filterEnabled.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadSwitch(), load()])
})

async function toggleSwitch(): Promise<void> {
  const next = !filterEnabled.value
  togglingSwitch.value = true
  try {
    await updateSettings({ safeguard: { sensitive_filter_enabled: next } })
    filterEnabled.value = next
    toastSuccess(next ? '已开启敏感词过滤，命中即拒绝请求' : '已关闭敏感词过滤，请求不再被扫描')
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '开关保存失败')
  } finally {
    togglingSwitch.value = false
  }
}

function openCreate(): void {
  editing.value = null
  formError.value = ''
  form.value = { word: '', category: '', enabled: true, remark: '' }
  formOpen.value = true
}

function openEdit(item: SensitiveWord): void {
  editing.value = item
  formError.value = ''
  form.value = {
    word: item.word,
    category: item.category,
    enabled: item.enabled,
    remark: item.remark,
  }
  formOpen.value = true
}

async function submit(): Promise<void> {
  if (!form.value.word.trim()) {
    formError.value = '敏感词不能为空（空词会命中所有请求）'
    return
  }

  saving.value = true
  formError.value = ''
  const payload = {
    word: form.value.word.trim(),
    category: form.value.category.trim(),
    enabled: form.value.enabled,
    remark: form.value.remark.trim(),
  }

  try {
    if (editing.value) {
      await updateSensitiveWord(editing.value.id, payload)
      toastSuccess('敏感词已更新，立即生效')
    } else {
      await createSensitiveWord(payload)
      toastSuccess('敏感词已添加，立即生效')
    }
    formOpen.value = false
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(item: SensitiveWord): Promise<void> {
  try {
    await updateSensitiveWord(item.id, { enabled: !item.enabled })
    toastSuccess(item.enabled ? '已停用（不再拦截）' : '已启用（重新参与匹配）')
    await load()
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function remove(item: SensitiveWord): Promise<void> {
  const ok = await confirmDialog({
    title: `删除敏感词「${item.word}」`,
    message: '删除后该词不再参与匹配，且无法从历史记录恢复。若只是暂时不想拦截，建议改为「停用」。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return

  try {
    await deleteSensitiveWord(item.id)
    toastSuccess('敏感词已删除')
    await load()
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '删除失败')
  }
}

function openImport(): void {
  importText.value = ''
  importCategory.value = ''
  importError.value = ''
  importOpen.value = true
}

async function submitImport(): Promise<void> {
  if (!importText.value.trim()) {
    importError.value = '请粘贴至少一个词条'
    return
  }

  importing.value = true
  importError.value = ''
  try {
    const result = await importSensitiveWords(importText.value, importCategory.value.trim())
    const skipped = result.skipped_invalid > 0 ? `，跳过 ${result.skipped_invalid} 条不合法词条` : ''
    toastSuccess(`解析 ${result.total} 条，新增 ${result.imported} 条${skipped}（已存在的自动跳过）`)
    importOpen.value = false
    await load()
  } catch (err) {
    importError.value = err instanceof ApiError ? err.message : '导入失败'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">内容安全</h2>
        <p class="page-desc">
          在请求进入上游之前扫描正文，命中词表即拒绝该请求（返回
          <code class="chip">content_filter</code>）——命中的请求不会转发上游，也不会计费。
          匹配<span class="text-ink-100">不区分大小写</span>；图片等 Base64 内容不参与匹配，避免误拦。
        </p>
      </div>
      <div class="toolbar">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="load">
          <AppIcon name="refresh" :size="14" />
          刷新
        </button>
        <button type="button" class="btn btn-secondary btn-sm" @click="openImport">
          <AppIcon name="plus" :size="14" />
          批量导入
        </button>
        <button type="button" class="btn btn-primary btn-sm" @click="openCreate">
          <AppIcon name="plus" :size="14" />
          新增词条
        </button>
      </div>
    </div>

    <!-- 总开关放在最上方：词表填了但开关没开是最容易误解的失效原因 -->
    <section class="card card-pad mb-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="section-title flex items-center gap-2">
            <AppIcon name="shield" :size="16" class="text-brand-700" />
            过滤总开关
          </h3>
          <p class="mt-1 text-sm text-ink-300">
            当前状态：<strong :class="filterEnabled ? 'text-emerald-400' : 'text-ink-400'">
              {{ filterEnabled ? '已开启' : '已关闭' }}
            </strong>
            <span class="ml-2 text-xs text-ink-400">词表共 {{ words.length }} 条，其中生效中 {{ enabledCount }} 条</span>
          </p>
          <p class="mt-1 text-xs text-ink-400">
            关闭时不会读取请求体、不产生额外开销；开启后命中任意一条生效词条即拒绝。
          </p>
        </div>
        <button
          type="button"
          class="btn btn-sm"
          :class="filterEnabled ? 'btn-secondary' : 'btn-primary'"
          :disabled="togglingSwitch"
          @click="toggleSwitch"
        >
          {{ togglingSwitch ? '保存中…' : filterEnabled ? '关闭过滤' : '开启过滤' }}
        </button>
      </div>
    </section>

    <div class="toolbar mb-3">
      <input
        v-model="keyword"
        class="input max-w-[16rem]"
        type="text"
        placeholder="按词条 / 分类 / 备注筛选"
      />
    </div>

    <div class="table-wrap table-cards">
      <table class="data-table">
        <thead>
          <tr>
            <th>词条</th>
            <th>分类</th>
            <th>状态</th>
            <th>备注</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <DataState
            :loading="loading"
            :error="error"
            :empty="!loading && !error && filtered.length === 0"
            :colspan="5"
            loading-text="正在读取词表…"
            empty-text="还没有配置任何敏感词"
            empty-hint="可以先「批量导入」一份词表，词条默认启用；过滤总开关需要单独开启。"
            @retry="load"
          />

          <tr v-for="item in filtered" :key="item.id">
            <td data-label="词条">
              <code class="font-mono text-[13px] text-ink-100">{{ item.word }}</code>
            </td>
            <td class="cell-muted" data-label="分类">{{ item.category || '—' }}</td>
            <td data-label="状态">
              <span class="badge" :class="item.enabled ? 'badge-ok' : 'badge-off'">
                {{ item.enabled ? '生效中' : '已停用' }}
              </span>
            </td>
            <td class="cell-muted max-w-[16rem]" data-label="备注">
              <span class="line-clamp-1">{{ item.remark || '—' }}</span>
            </td>
            <td class="cell-actions" data-label="操作">
              <div class="flex items-center justify-end gap-1">
                <button
                  type="button"
                  class="btn-row"
                  :title="item.enabled ? '停用（保留词条，不再拦截）' : '启用'"
                  @click="toggleEnabled(item)"
                >
                  <AppIcon :name="item.enabled ? 'eye-off' : 'eye'" :size="14" />
                </button>
                <button type="button" class="btn-row" title="编辑" @click="openEdit(item)">
                  <AppIcon name="edit" :size="14" />
                </button>
                <button type="button" class="btn-row" title="删除" @click="remove(item)">
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新增 / 编辑 -->
    <Modal
      :open="formOpen"
      :title="editing ? `编辑敏感词「${editing.word}」` : '新增敏感词'"
      subtitle="保存后立即生效；已开启过滤的情况下，命中该词的请求会立刻被拒绝。"
      width="max-w-xl"
      :close-on-backdrop="false"
      @close="formOpen = false"
    >
      <div class="space-y-4">
        <div>
          <label class="label" for="sw-word">词条<span class="text-red-600">*</span></label>
          <input id="sw-word" v-model="form.word" class="input input-mono" type="text" placeholder="要拦截的词或短语" />
          <p class="hint">最长 64 个字符；匹配不区分大小写，无需为不同大小写各加一条。</p>
        </div>

        <div>
          <label class="label" for="sw-category">分类</label>
          <input id="sw-category" v-model="form.category" class="input" type="text" placeholder="如：违法违规 / 广告" />
          <p class="hint">分类只用于提示使用者，不会在拒绝对话中回显具体词条。</p>
        </div>

        <div>
          <label class="label" for="sw-remark">备注</label>
          <input id="sw-remark" v-model="form.remark" class="input" type="text" placeholder="为什么加这个词（可选）" />
        </div>

        <label class="flex items-center gap-2 text-sm text-ink-200">
          <input v-model="form.enabled" class="checkbox" type="checkbox" />
          启用（停用后仍保留词条，但不再参与匹配）
        </label>

        <p v-if="formError" class="field-error">{{ formError }}</p>
      </div>

      <template #footer>
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="formOpen = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>

    <!-- 批量导入 -->
    <Modal
      :open="importOpen"
      title="批量导入敏感词"
      subtitle="每行一个词，也支持逗号、顿号、分号、竖线分隔；已存在的词会被自动跳过。"
      width="max-w-xl"
      :close-on-backdrop="false"
      @close="importOpen = false"
    >
      <div class="space-y-4">
        <div>
          <label class="label" for="sw-import-category">统一分类（可选）</label>
          <input id="sw-import-category" v-model="importCategory" class="input" type="text" placeholder="如：违法违规" />
        </div>

        <div>
          <label class="label" for="sw-import-text">词条列表</label>
          <textarea
            id="sw-import-text"
            v-model="importText"
            class="input h-56 font-mono text-[13px]"
            placeholder="示例：&#10;词条一&#10;词条二&#10;词条三"
          ></textarea>
          <p class="hint">单次最多导入 2000 条；过长的行（超过 64 字符）会被跳过并在结果中提示。</p>
        </div>

        <p v-if="importError" class="field-error">{{ importError }}</p>
      </div>

      <template #footer>
        <button type="button" class="btn btn-secondary" :disabled="importing" @click="importOpen = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="importing" @click="submitImport">
          {{ importing ? '导入中…' : '开始导入' }}
        </button>
      </template>
    </Modal>
  </div>
</template>
