<script setup lang="ts">
/**
 * 管理后台 · 模型分组：维护分组与其计费倍率。
 *
 * 意图（Why）：
 *   分组是运营抓手——渠道归属于分组、计价规则按分组区分，
 *   因此「给不同人群不同的价格与上游」只需改分组配置。
 *   本页要回答管理员三个问题：
 *     1) 现在有哪些分组？各自倍率多少？
 *     2) 这个分组被多少渠道/价格使用？（决定能不能删）
 *     3) 改倍率会立刻生效吗？（会——后端改完即清计费缓存）
 *
 * 流转（Flow）：
 *   进入页面 → listGroups() → 表格（含引用统计）
 *   新建/编辑 → Modal 表单 → createGroup / updateGroup → 重新加载
 *   删除 → 二次确认 → deleteGroup（被引用或默认分组会被后端拒绝）
 *
 * 扩展（Extend）：
 *   新增分组属性（如"仅管理员可见"）：在 types.ts 的 ModelGroup 加字段，
 *   在本页表格与表单各补一处。
 */
import { computed, onMounted, ref } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import DataState from '@/components/DataState.vue'
import Modal from '@/components/Modal.vue'
import { ApiError } from '@/api/client'
import { createGroup, deleteGroup, listGroups, updateGroup } from '@/api/admin'
import type { ModelGroup } from '@/api/types'
import { confirmDialog } from '@/composables/useConfirm'
import { toastError, toastSuccess } from '@/composables/useToast'
import { formatCurrency, formatDateTime, centsToYuan, yuanToCents } from '@/utils/format'

const groups = ref<ModelGroup[]>([])
const loading = ref(true)
const error = ref('')

/** 表单弹窗状态：editing 为 null 表示新建 */
const formOpen = ref(false)
const editing = ref<ModelGroup | null>(null)
const saving = ref(false)
const formError = ref('')

const form = ref({
  name: '',
  display_name: '',
  /** 用百分比整数：100 = 1.0 倍；界面用字符串承载，提交前转数字 */
  ratioText: '100',
  description: '',
  enabled: true,
  /**
   * 解锁门槛（元，字符串承载）。0 = 无门槛；大于 0 时，只有累计充值达标的用户
   * 才能把访问令牌挂到该分组。这是"低价分组只给大客户"唯一能被强制执行的配置
   * （令牌分组是用户自选的，不设门槛等于对所有人开放最低折扣）。
   */
  unlockYuanText: '0',
  /**
   * 仅后台可分发的分组（批发价）。
   *
   * 与解锁门槛解决的是两件不同的事：
   *   解锁门槛 = "谁够格买"（客户资格，看累计充值）；
   *   本开关   = "谁来发"（分发授权，只有管理员能建这种令牌）。
   * 批发价分组（如代理拿货）靠本开关落地：门户不下发该分组，
   * 普通用户即使直接调接口指定也会被 403，只有管理员在后台代建才放行。
   */
  adminOnly: false,
})

/** 仅后台开关的提示语：把"会发生什么"讲清楚，避免误开导致代理拿不到货 */
const adminOnlyPreview = computed(() => {
  if (!form.value.adminOnly) return '所有符合条件的用户都可以自助选择该分组'
  return '门户不显示该分组，只有管理员在后台代客户建令牌时才可用'
})

/** 倍率预览：把百分比换算成人话，避免管理员填错单位 */
const ratioPreview = computed(() => {
  const ratio = Number(form.value.ratioText)
  if (!Number.isFinite(ratio) || ratio <= 0) return '请输入大于 0 的数字'
  return `实际扣费 = 基础额度 × ${(ratio / 100).toFixed(2)}`
})

/** 解锁门槛预览：明确 0 的含义，避免管理员把"0 元"误读成"充 0 元才能用" */
const unlockPreview = computed(() => {
  const cents = yuanToCents(form.value.unlockYuanText || '0')
  if (cents === null) return '请输入不小于 0 的金额（元）'
  if (cents === 0) return '不设门槛：所有用户都能把令牌挂到该分组'
  return `累计充值满 ${formatCurrency(centsToYuan(cents))} 的用户才能把令牌挂到该分组`
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await listGroups()
    groups.value = result.items ?? []
  } catch (err) {
    groups.value = []
    error.value = err instanceof ApiError ? err.message : '分组加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** 打开新建表单 */
function openCreate(): void {
  editing.value = null
  formError.value = ''
  form.value = {
    name: '',
    display_name: '',
    ratioText: '100',
    description: '',
    enabled: true,
    unlockYuanText: '0',
    // 新建时默认"可自助选择"：只有明确要开批发价分组才勾上，
    // 避免因为漏看这个开关而意外做出一批"用户看不见的分组"。
    adminOnly: false,
  }
  formOpen.value = true
}

/** 打开编辑表单 */
function openEdit(group: ModelGroup): void {
  editing.value = group
  formError.value = ''
  form.value = {
    name: group.name,
    display_name: group.display_name,
    ratioText: String(group.ratio),
    description: group.description,
    enabled: group.enabled,
    unlockYuanText: String(centsToYuan(group.unlock_min_recharge_cents)),
    adminOnly: group.admin_only,
  }
  formOpen.value = true
}

async function submit(): Promise<void> {
  const ratio = Number(form.value.ratioText)
  if (!Number.isFinite(ratio) || ratio <= 0) {
    formError.value = '计费倍率必须是大于 0 的数字（100 表示 1.0 倍）'
    return
  }
  if (!editing.value && !form.value.name.trim()) {
    formError.value = '分组标识不能为空'
    return
  }
  // 门槛以「分」提交：金额一旦经过浮点就可能出现 99.99999 < 100 的假性未达标，
  // 因此换算只在这里做一次，之后全链路都是整数分。
  const unlockCents = yuanToCents(form.value.unlockYuanText || '0')
  if (unlockCents === null) {
    formError.value = '解锁门槛必须是不小于 0 的金额（元），0 表示无门槛'
    return
  }

  saving.value = true
  formError.value = ''
  try {
    if (editing.value) {
      await updateGroup(editing.value.id, {
        display_name: form.value.display_name.trim(),
        ratio: Math.round(ratio),
        description: form.value.description.trim(),
        enabled: form.value.enabled,
        unlock_min_recharge_cents: unlockCents,
        admin_only: form.value.adminOnly,
      })
      toastSuccess(`分组「${editing.value.label}」已更新，新倍率立即生效`)
    } else {
      const created = await createGroup({
        name: form.value.name.trim().toLowerCase(),
        display_name: form.value.display_name.trim(),
        ratio: Math.round(ratio),
        description: form.value.description.trim(),
        enabled: form.value.enabled,
        unlock_min_recharge_cents: unlockCents,
        admin_only: form.value.adminOnly,
      })
      toastSuccess(`分组「${created.label}」已创建`)
    }
    formOpen.value = false
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

/**
 * 分组是否仍被引用（渠道 / 计价规则）。
 *
 * 被引用时不允许删除：此前按钮可点，确认框里写着"后端会拒绝删除"，
 * 等于让管理员完整走一遍注定失败的流程，最后拿到一条报错。
 * 现在直接置灰并用 title 说明原因与解除办法。
 */
function isGroupInUse(group: ModelGroup): boolean {
  return group.channel_count + group.price_count > 0
}

async function remove(group: ModelGroup): Promise<void> {
  // 模板上已置灰，这里再拦一道，避免将来从别处调用绕过按钮状态
  if (isGroupInUse(group)) {
    toastError('该分组仍被渠道或计价规则使用，请先调整这些配置的分组归属。')
    return
  }

  const ok = await confirmDialog({
    title: `删除分组「${group.label}」`,
    message: '删除后无法恢复。仅在没有任何渠道或计价规则引用该分组时才能删除。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return

  try {
    await deleteGroup(group.id)
    toastSuccess('分组已删除')
    await load()
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '删除失败')
  }
}

/** 倍率徽标：1.0 倍用中性色，非 1.0 倍用强调色（异常定价需要被一眼看到） */
function ratioBadgeClass(ratio: number): string {
  return ratio === 100 ? 'badge badge-off' : 'badge badge-warn'
}

function ratioText(ratio: number): string {
  return `${(ratio / 100).toFixed(2)}x`
}

/** 解锁门槛展示：0 显示为「无门槛」，否则显示金额，让管理员一眼看出哪个分组在挡人 */
function unlockText(group: ModelGroup): string {
  // 仅后台分发的分组：门槛对它已无意义（根本不给用户自助选），
  // 必须单独标出来——否则管理员看到"无门槛"会误以为所有人都能选到它。
  if (group.admin_only) return '仅后台分发'
  if (group.unlock_min_recharge_cents <= 0) return '无门槛'
  return `充值满 ${formatCurrency(centsToYuan(group.unlock_min_recharge_cents))}`
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">模型分组</h2>
        <p class="page-desc">
          渠道与计价规则都归属于分组。为分组设置倍率即可实现差异化定价：
          实际扣费 = 基础额度 × 倍率（例如 150 表示 1.5 倍）。倍率修改后立即生效。
        </p>
      </div>
      <div class="toolbar">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="load">
          <AppIcon name="refresh" :size="14" />
          刷新
        </button>
        <button type="button" class="btn btn-primary btn-sm" @click="openCreate">
          <AppIcon name="plus" :size="14" />
          新建分组
        </button>
      </div>
    </div>

    <div class="table-wrap table-cards">
      <table class="data-table">
        <thead>
          <tr>
            <th>分组</th>
            <th>倍率</th>
            <th>解锁门槛</th>
            <th>说明</th>
            <th>引用情况</th>
            <th>状态</th>
            <th>更新时间</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <DataState
            :loading="loading"
            :error="error"
            :empty="!loading && !error && groups.length === 0"
            :colspan="8"
            loading-text="正在读取分组…"
            empty-text="还没有任何分组"
            empty-hint="默认分组由系统初始化。点击「新建分组」可以创建面向不同人群的分组。"
            @retry="load"
          />

          <tr v-for="group in groups" :key="group.id">
            <td data-label="分组">
              <div class="flex items-center gap-2">
                <span class="font-medium text-ink-100">{{ group.label }}</span>
                <code class="chip">{{ group.name }}</code>
              </div>
            </td>
            <td data-label="倍率">
              <span :class="ratioBadgeClass(group.ratio)">{{ ratioText(group.ratio) }}</span>
            </td>
            <td class="cell-muted" data-label="解锁门槛">{{ unlockText(group) }}</td>
            <td class="cell-muted max-w-[16rem]" data-label="说明">
              <span class="line-clamp-2">{{ group.description || '—' }}</span>
            </td>
            <td class="cell-muted" data-label="引用情况">
              {{ group.channel_count }} 渠道 / {{ group.price_count }} 规则
            </td>
            <td data-label="状态">
              <span class="badge" :class="group.enabled ? 'badge-ok' : 'badge-off'">
                {{ group.enabled ? '启用' : '停用' }}
              </span>
            </td>
            <td class="cell-muted" data-label="更新时间">{{ formatDateTime(group.updated_at) }}</td>
            <td class="cell-actions" data-label="操作">
              <div class="flex items-center justify-end gap-1">
                <button type="button" class="btn-row" title="编辑" @click="openEdit(group)">
                  <AppIcon name="edit" :size="14" />
                </button>
                <button
                  type="button"
                  class="btn-row"
                  :disabled="group.name === 'default' || isGroupInUse(group)"
                  :title="
                    group.name === 'default'
                      ? '默认分组不可删除'
                      : isGroupInUse(group)
                        ? `仍被 ${group.channel_count} 个渠道与 ${group.price_count} 条计价规则使用，需先解除引用`
                        : '删除'
                  "
                  @click="remove(group)"
                >
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal
      :open="formOpen"
      :title="editing ? `编辑分组「${editing.label}」` : '新建分组'"
      :subtitle="
        editing
          ? '分组标识不可修改（渠道与计价规则通过它关联）。倍率修改后立即生效。'
          : '标识用于关联渠道与计价规则，创建后不可修改，请使用小写字母。'
      "
      width="max-w-xl"
      :close-on-backdrop="false"
      @close="formOpen = false"
    >
      <div class="space-y-4">
        <div>
          <label class="label" for="group-name">分组标识<span class="text-red-600">*</span></label>
          <input
            id="group-name"
            v-model="form.name"
            class="input input-mono"
            type="text"
            :disabled="Boolean(editing)"
            placeholder="如 vip、internal、trial"
          />
          <p class="hint">
            只允许小写字母，不能包含空格、逗号或斜杠。渠道与计价规则填的就是这个值。
          </p>
        </div>

        <div>
          <label class="label" for="group-display">展示名</label>
          <input
            id="group-display"
            v-model="form.display_name"
            class="input"
            type="text"
            placeholder="如 VIP 用户（留空则显示标识）"
          />
        </div>

        <div>
          <label class="label" for="group-ratio">计费倍率（百分比）</label>
          <input id="group-ratio" v-model="form.ratioText" class="input" type="number" min="1" step="1" />
          <p class="hint">{{ ratioPreview }}（倍率只影响扣费，不改变上游实际用量）</p>
        </div>

        <div>
          <label class="label" for="group-unlock">解锁门槛（元）</label>
          <input id="group-unlock" v-model="form.unlockYuanText" class="input" type="number" min="0" step="0.01" />
          <p class="hint">{{ unlockPreview }}</p>
        </div>

        <div>
          <label class="label" for="group-desc">说明</label>
          <textarea
            id="group-desc"
            v-model="form.description"
            class="input"
            rows="2"
            placeholder="这个分组面向谁？为什么这么定价？"
          />
        </div>

        <div>
          <label class="flex items-center gap-2 text-sm text-ink-200">
            <input v-model="form.adminOnly" class="checkbox" type="checkbox" />
            仅后台分发（批发价分组）
          </label>
          <p class="hint">{{ adminOnlyPreview }}</p>
        </div>

        <label class="flex items-center gap-2 text-sm text-ink-200">
          <input v-model="form.enabled" class="checkbox" type="checkbox" />
          启用该分组
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
  </div>
</template>
