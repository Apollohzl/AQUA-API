<script setup lang="ts">
/**
 * 管理后台 · 渠道管理：列表 + 新建/编辑抽屉 + 测活 + 启停 + 删除。
 *
 * 意图（Why）：
 *   渠道是网关的「上游能力来源」，配置项最多（协议、地址、密钥、模型、分组、优先级、权重），
 *   因此用右侧抽屉承载表单，让管理员在填表时仍能看到列表上下文；
 *   测活则直接内联在表格里展示延迟与结果，避免「点一下、跳个提示、不知道成功没」。
 *
 * 流转（Flow）：
 *   列表：listChannels({page,size}) → 表格
 *   新建：抽屉表单 → createChannel(payload) → 重新拉取列表
 *   编辑：打开抽屉时先 GET /channels/{id} 取详情（列表里没有明文密钥，但需最新配置）→ updateChannel
 *   测活：testChannel(id) → 结果写入 testResults 映射（含延迟）→ 就地更新该行状态
 *   启停：updateChannel(id, { status })（契约中更新使用 PUT，这里提交完整对象以免字段被清空）
 *
 * 扩展（Extend）：
 *   新增渠道字段：同步 api/types.ts 的 ChannelPayload 与此处表单（两处必须一致）。
 *   上游类型差异（默认地址、鉴权方式、能力、额外参数）不写死在本页：
 *   由 /admin/channel-types 目录下发，本页按选中类型触发式渲染，
 *   因此后端新增一种上游时本页无需改动。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import DataState from '@/components/DataState.vue'
import Drawer from '@/components/Drawer.vue'
import Pagination from '@/components/Pagination.vue'
import { ApiError } from '@/api/client'
import {
  createChannel,
  deleteChannel,
  fetchChannelTypes,
  fetchKeyFailurePolicies,
  fetchKeyStrategies,
  fetchUpstreamModels,
  getChannel,
  listChannelMappings,
  listChannels,
  listGroups,
  replaceChannelMappings,
  testChannel,
  updateChannel,
  updateChannelKey,
} from '@/api/admin'
import {
  listChannelKeysWithBalance,
  probeChannelKeyQuota,
  updateChannelKeyBalance,
  type ChannelKeyWithBalance,
} from '@/api/channel'
import { fetchChannelKeyUsage, listChannelCosts, saveChannelCosts } from '@/api/cost'
import {
  KEY_STATUS_AUTO_REMOVED,
  KEY_STATUS_DISABLED,
  KEY_STATUS_ENABLED,
  STATUS_DISABLED,
  STATUS_ENABLED,
  type Channel,
  type ChannelKeyUsage,
  type ChannelModelCostPayload,
  type ChannelModelRetryRule,
  type ChannelPayload,
  type ChannelTestResult,
  type ChannelType,
  type ChannelTypeCategory,
  type FetchModelsPayload,
  type KeyFailurePolicyCatalog,
  type KeyStrategyOption,
  type ModelGroup,
} from '@/api/types'
import { confirmDialog } from '@/composables/useConfirm'
import { toastError, toastSuccess } from '@/composables/useToast'
import { useSiteStore } from '@/stores/site'
import { channelStatusBadgeClass, channelStatusLabel, channelTypeLabel } from '@/utils/display'
import { formatDateTime, formatNumber, joinModelList, parseModelList } from '@/utils/format'

const site = useSiteStore()
const route = useRoute()

const channels = ref<Channel[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(true)
const error = ref('')

/** 行级操作忙碌标记（避免同一行被重复点击） */
const busyId = ref<number | null>(null)
/** 测活结果：按渠道 id 缓存，用于在表格内展示延迟与结论 */
const testResults = ref<Record<number, ChannelTestResult>>({})
const testingId = ref<number | null>(null)
/** 展开查看测活详情的渠道 id（同一时刻只展开一个，避免表格被撑乱） */
const testDetailId = ref<number | null>(null)

/* ── 上游模型拉取状态 ─────────────────────────────────── */
/** 是否正在拉取模型清单 */
const fetchingModels = ref(false)
/** 上游返回的模型清单（用于勾选） */
const upstreamModels = ref<string[]>([])
/** 拉取失败原因 */
const upstreamError = ref('')

/* ── 模型 ID 映射状态 ─────────────────────────────────── */
/**
 * 模型 ID 映射的编辑行。
 *
 * 这是本页最容易让人困惑的地方，因此把两个名字的职责写死在这里：
 *   publicModel —— 平台模型 ID（对外）：客户端/SDK 调用时使用的名字，
 *                  也是模型广场与 /v1/models 里展示的名字；
 *   upstreamModel —— 上游模型 ID：网关转发时【真正发给上游】的名字。
 * 例：用户调 vendor/model-a，上游收到 model-a。
 *
 * 不配置任何映射时，两个名字相同（原样透传），行为与没有本功能时完全一致。
 */
interface MappingRow {
  publicModel: string
  upstreamModel: string
  enabled: boolean
}

const mappingRows = ref<MappingRow[]>([])
/** 映射读取状态（编辑已有渠道时才会去后端取） */
const mappingLoading = ref(false)
const mappingError = ref('')

/**
 * 「批量生成映射」用的平台前缀。
 *
 * 为什么需要它：上游一次返回几十上百个模型，逐个手填平台名不现实。
 * 站长只想表达"这批上游模型在我的平台上统一叫 AQUA/xxx"，
 * 前缀 + 上游名即可一次性生成全部映射行。
 */
const mappingPrefix = ref('')

/** 追加一行空白映射 */
function addMappingRow(): void {
  mappingRows.value = [...mappingRows.value, { publicModel: '', upstreamModel: '', enabled: true }]
}

/** 删除一行映射 */
function removeMappingRow(index: number): void {
  mappingRows.value = mappingRows.value.filter((_, i) => i !== index)
}

/**
 * 用「前缀 + 上游模型名」批量生成映射行。
 *
 * 覆盖语义：生成结果会替换掉「上游模型 ID 已存在于上游清单」的旧行，保留手写的其它行，
 * 这样重复点击不会产生重复行（后端对同一渠道内的上游名有唯一约束，重复会整组保存失败）。
 */
function generateMappingsFromUpstream(): void {
  if (!upstreamModels.value.length) {
    mappingError.value = '请先点「从上游拉取」获取上游模型清单'
    return
  }
  mappingError.value = ''
  const prefix = mappingPrefix.value.trim()
  const generated: MappingRow[] = upstreamModels.value.map((upstream) => ({
    publicModel: prefix ? `${prefix}${upstream}` : upstream,
    upstreamModel: upstream,
    enabled: true,
  }))
  // 保序：先保留管理员手写（上游名不在清单里）的行，再追加生成的行
  const generatedUpstreams = new Set(upstreamModels.value)
  const manual = mappingRows.value.filter((row) => row.upstreamModel.trim() && !generatedUpstreams.has(row.upstreamModel.trim()))
  mappingRows.value = [...manual, ...generated]
}

/**
 * 把映射里填好的「平台模型 ID」并入"声明支持的模型"清单。
 *
 * 为什么必须自动并入：渠道的 models 清单决定了"路由时该渠道能不能接住这个模型"，
 * 若平台模型 ID 只写在映射里却没进清单，映射永远不会被命中——
 * 表现就是"配了映射却完全不生效"，且没有任何报错。自动并入消除这类静默失败。
 */
function syncMappingPublicModels(): void {
  const declared = parseModelList(form.value.modelText)
  const additions = mappingRows.value
    .map((row) => row.publicModel.trim())
    .filter((name) => name && !declared.includes(name))
  if (additions.length) {
    form.value.modelText = [...declared, ...additions].join(', ')
  }
}

/** 读取某渠道已保存的映射，填入编辑行 */
async function loadChannelMappings(channelId: number): Promise<void> {
  mappingLoading.value = true
  mappingError.value = ''
  try {
    const result = await listChannelMappings(channelId)
    mappingRows.value = (result.items ?? []).map((item) => ({
      publicModel: item.public_model,
      upstreamModel: item.upstream_model,
      enabled: item.enabled,
    }))
  } catch (err) {
    mappingRows.value = []
    mappingError.value = err instanceof ApiError ? err.message : '模型映射加载失败'
  } finally {
    mappingLoading.value = false
  }
}

/**
 * 校验映射行，返回错误文案（null 表示通过）。
 *
 * 两道检查对应后端的两个硬约束，提前拦住能给出可操作的提示：
 *   1) 平台模型 ID 与上游模型 ID 都不能为空（半填的行几乎必然是误操作）；
 *   2) 同一渠道内「上游模型 ID」不能重复（后端唯一索引，重复会让整组保存失败）。
 */
function validateMappings(): string | null {
  const seen = new Set<string>()
  for (const row of mappingRows.value) {
    const publicModel = row.publicModel.trim()
    const upstreamModel = row.upstreamModel.trim()
    if (!publicModel && !upstreamModel) continue
    if (!publicModel) return `映射「${upstreamModel}」缺少平台模型 ID（用户调用时用的名字）`
    if (!upstreamModel) return `映射「${publicModel}」缺少上游模型 ID（实际发给上游的名字）`
    if (seen.has(upstreamModel)) return `上游模型 ID「${upstreamModel}」在同一渠道内重复，请合并为一条`
    seen.add(upstreamModel)
  }
  return null
}

/** 把编辑行转成提交载荷（跳过完全空白的行） */
function mappingPayload(): MappingRow[] {
  return mappingRows.value.filter((row) => row.publicModel.trim() && row.upstreamModel.trim())
}

/* ── 上游错误重试（渠道级 + 模型级覆盖）──────────────────── */

/** 重试次数上限，与后端 model.MaxRetryMaxAttempts 保持一致（超出会被 400 拒绝） */
const MAX_RETRY_ATTEMPTS = 10

/**
 * 模型级重试规则编辑行。
 *
 * 字段与提交载荷同形（model / enabled / maxAttempts）：这一层是"渠道配置的一部分"，
 * 不需要像映射那样做命名转换，少一层映射就少一处出错的地方。
 */
interface RetryRuleRow {
  model: string
  enabled: boolean
  maxAttempts: number
}

const retryRuleRows = ref<RetryRuleRow[]>([])

/**
 * 把接口返回的模型级规则转成编辑行。
 *
 * 做一次深拷贝而不是直接引用响应对象：编辑行会被就地修改，
 * 直接引用会让"取消编辑"变得无法回滚（原对象已被改）。
 */
function toRetryRuleRows(rules: ChannelModelRetryRule[] | undefined): RetryRuleRow[] {
  return (rules ?? []).map((rule) => ({
    model: rule.model,
    enabled: rule.enabled,
    maxAttempts: rule.max_attempts ?? 0,
  }))
}

/** 新增一行空规则，由管理员填写模型名 */
function addRetryRule(): void {
  retryRuleRows.value = [...retryRuleRows.value, { model: '', enabled: true, maxAttempts: 0 }]
}

/** 删除一行规则 */
function removeRetryRule(index: number): void {
  retryRuleRows.value = retryRuleRows.value.filter((_, i) => i !== index)
}

/**
 * 用"已勾选的模型"批量生成规则行。
 *
 * 为什么需要：一个渠道常有几十个模型，逐个手打模型名既慢又容易打错，
 * 而打错的模型名永远不会命中——表现为"规则配了却完全没生效"。
 */
function fillRetryRulesFromModels(): void {
  const models = parseModelList(form.value.modelText)
  if (!models.length) {
    formError.value = '请先在上方勾选该渠道支持的模型'
    return
  }
  const existing = new Set(retryRuleRows.value.map((row) => row.model.trim()))
  const additions = models.filter((name) => !existing.has(name))
  if (!additions.length) {
    formError.value = '已勾选的模型都在规则列表里了'
    return
  }
  formError.value = ''
  // 新行默认"开启重试 + 次数留空（用默认值）"：最常见的诉求单独给某几个模型
  // 调次数或单独关掉，先用默认值占位，管理员再按需改。
  retryRuleRows.value = [
    ...retryRuleRows.value,
    ...additions.map((name) => ({ model: name, enabled: true, maxAttempts: 0 })),
  ]
}

/** 校验模型级重试规则，返回错误文案（null 表示通过） */
function validateRetryRules(): string | null {
  const seen = new Set<string>()
  for (const row of retryRuleRows.value) {
    const model = row.model.trim()
    if (!model) return '模型级重试规则里的模型名不能为空'
    if (/\s/.test(model)) return `模型名「${model}」不能包含空白字符（否则永远匹配不上）`
    if (seen.has(model)) return `模型名「${model}」重复，请合并为一条`
    seen.add(model)

    const attempts = Number(row.maxAttempts)
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > MAX_RETRY_ATTEMPTS) {
      return `模型「${model}」的重试次数必须在 0 ~ ${MAX_RETRY_ATTEMPTS} 之间（0 表示用默认次数）`
    }
  }
  return null
}

/** 把编辑行转成提交载荷（模型名去空白） */
function retryRulesPayload(): ChannelModelRetryRule[] {
  return retryRuleRows.value.map((row) => ({
    model: row.model.trim(),
    enabled: row.enabled,
    max_attempts: Number(row.maxAttempts) || 0,
  }))
}

/* ── 密钥池明细状态 ───────────────────────────────────── */
const keysDrawerOpen = ref(false)
/** 当前查看密钥池的渠道 */
const keysOfChannel = ref<Channel | null>(null)
/**
 * 按密钥 ID 索引的用量核算结果（已消耗 / 估算剩余）。
 *
 * 加载失败时保持为空：核算只是增强信息，不能因为它取不到就把密钥列表也废掉。
 * 后端只返回"仍在池内"的密钥，因此这里的键一定能和 channelKeys 对上。
 */
const keyUsage = ref<Record<number, ChannelKeyUsage>>({})
const channelKeys = ref<ChannelKeyWithBalance[]>([])
const keysLoading = ref(false)
const keysError = ref('')
/** 正在切换状态的密钥 id（避免重复点击） */
const keyBusyId = ref<number | null>(null)
/** 正在保存调度参数的密钥 id */
const savingKeyId = ref<number | null>(null)
/** 正在保存余额的密钥 id */
const savingBalanceId = ref<number | null>(null)
/**
 * 是否显示凭据原文。
 *
 * 默认关闭：一个渠道可能有几百把密钥，默认下发等于把整池明文灌进浏览器内存、
 * 前端日志与截图里。开启时后端会写一条操作审计（谁在什么时候看过密钥原文）。
 */
const keysReveal = ref(false)
/** 每把密钥的调度参数草稿（id → {weight, priority, rpm_limit, balance}），支持内联编辑 */
const keyDrafts = ref<Record<number, KeySchedulingDraft>>({})
/** 冷却剩余时间的参照时刻：每秒刷新，让"剩余 xx 分 xx 秒"实时递减 */
const now = ref(Date.now())
let clockTimer: number | undefined

/** 单把凭据的可编辑参数（调度参数 + 余额 + 路由分叉） */
interface KeySchedulingDraft {
  weight: number
  priority: number
  rpm_limit: number
  /** 余额草稿：-1 表示未录入（与后端 BalanceUnknown 一致） */
  balance: number
  /**
   * 可服务分组草稿（文本形态，逗号或空格分隔）。
   *
   * 留空 = 不限分组（继承渠道级路由）。用文本而不是多选控件：
   * 分组名可由运营方自定义，且一个渠道通常只涉及少数几个分组，
   * 手写比先拉分组清单再勾选更直接。
   */
  groupsText: string
  /** 可服务模型草稿（文本形态，支持尾部通配符 *）；留空 = 不限模型 */
  modelsText: string
}

/* ── 列表 ─────────────────────────────────────────────── */

async function loadChannels(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await listChannels({ page: page.value, size: size.value })
    channels.value = result.items ?? []
    total.value = result.total ?? 0
  } catch (err) {
    channels.value = []
    total.value = 0
    error.value = err instanceof ApiError ? err.message : '渠道列表加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadChannels()
  void loadGroupOptions()
  void loadChannelTypes()
  void loadKeyStrategies()
  void loadFailurePolicies()
  // 冷却剩余时间需要"随时间推进"的当前时刻，否则展示会一直停在打开抽屉那一刻。
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)

  // 深链：其他页面（如「模型映射」总览）可以带 ?edit={渠道ID} 跳进来，
  // 直接打开该渠道的编辑抽屉，省掉"先搜索再点编辑"这一步。
  // 必须放在 loadChannels 之后：编辑抽屉的初值取自列表行。
  const editID = Number(route.query.edit ?? '')
  if (Number.isInteger(editID) && editID > 0) {
    const target = channels.value.find((item) => item.id === editID)
    if (target) await openEdit(target)
  }
})

onBeforeUnmount(() => {
  if (clockTimer !== undefined) window.clearInterval(clockTimer)
})

/* ── 凭据调度策略目录 ─────────────────────────────────── */
/**
 * 调度策略目录：由后端下发每种策略的标识、中文名与一句话说明。
 *
 * 为什么不在前端硬编码：策略是稳定枚举，但"有哪些策略、各自什么意思"
 * 的知识属于后端领域层；后端新增策略时前端无需改动即可展示。
 * 加载失败只影响便利性，故不阻断页面。
 */
const keyStrategies = ref<KeyStrategyOption[]>([])

async function loadKeyStrategies(): Promise<void> {
  try {
    const data = await fetchKeyStrategies()
    keyStrategies.value = data.items ?? []
  } catch {
    keyStrategies.value = []
  }
}

/** 当前选中策略的说明文案（在下拉下方展示） */
const selectedStrategyDesc = computed(
  () => keyStrategies.value.find((item) => item.key === form.value.key_strategy)?.description ?? '',
)

/* ── 密钥失败处置策略目录 ─────────────────────────────── */
/**
 * 失败策略目录：由后端下发两种策略的名称与说明，以及冷却时长上限。
 *
 * 为什么连"上限"一起下发：冷却时长过长等价于"事实摘除"，
 * 与"只冷却不摘除"的承诺相矛盾；界面上限与后端夹取规则取自同一处，
 * 避免前端自己写一个数字而后端是另一个。
 */
const failurePolicies = ref<KeyFailurePolicyCatalog | null>(null)

async function loadFailurePolicies(): Promise<void> {
  try {
    failurePolicies.value = await fetchKeyFailurePolicies()
  } catch {
    // 目录加载失败只影响帮助文案与上限提示，不阻断表单
    failurePolicies.value = null
  }
}

/** 当前选中失败策略的说明文案 */
const selectedFailurePolicyDesc = computed(
  () => failurePolicies.value?.items.find((item) => item.key === form.value.key_failure_policy)?.description ?? '',
)

/** 冷却时长上限（秒）：目录未加载时退回 24 小时（与后端常量一致） */
const maxCooldownSeconds = computed(() => failurePolicies.value?.max_cooldown_seconds ?? 86400)

/** 冷却时长是否越界（越界时前端先提示，不必白跑一次请求） */
const cooldownSecondsInvalid = computed(
  () =>
    !Number.isInteger(Number(form.value.keyCooldownSeconds)) ||
    Number(form.value.keyCooldownSeconds) < 0 ||
    Number(form.value.keyCooldownSeconds) > maxCooldownSeconds.value,
)

/** 把秒数换成"人话"（如 3600 → 1 小时），便于站长核对填写值 */
function humanizeSeconds(seconds: number): string {
  const value = Number(seconds) || 0
  if (value <= 0) return '系统默认（按失败类型分级退避）'
  if (value % 3600 === 0) return `${value / 3600} 小时`
  if (value % 60 === 0) return `${value / 60} 分钟`
  return `${value} 秒`
}

/* ── 渠道分组（多选）──────────────────────────────────── */

/** 新增分组的输入草稿：既可从已有分组里选，也可手打一个尚未在「模型分组」页建的分组名 */
const newGroupName = ref('')

/** 追加一个分组（去空白、去重；已存在则只清空输入框） */
function addGroup(name: string): void {
  const value = name.trim()
  if (!value) return
  if (!form.value.groups.some((item) => item.trim() === value)) {
    form.value.groups = [...form.value.groups, value]
  }
  newGroupName.value = ''
}

/** 移除一个分组；至少保留一项（不属于任何分组的渠道永远不会被选中） */
function removeGroup(index: number): void {
  if (form.value.groups.length <= 1) return
  form.value.groups = form.value.groups.filter((_, i) => i !== index)
}

/**
 * 分组候选：来源于「模型分组」页。
 *
 * 为什么需要它：分组名写错时，渠道不会报错，只是再也不会被任何请求选中
 * （分组匹配不上），属于最难定位的一类配置事故。给出候选能大幅降低误填概率。
 * 加载失败只影响便利性，因此静默忽略。
 */
const groupOptions = ref<ModelGroup[]>([])

async function loadGroupOptions(): Promise<void> {
  try {
    const result = await listGroups()
    groupOptions.value = result.items ?? []
  } catch {
    groupOptions.value = []
  }
}

/* ── 上游渠道类型目录 ─────────────────────────────────── */
/**
 * 渠道类型目录：由后端下发每种上游的默认地址、鉴权方式、能力位与额外参数。
 *
 * 为什么不在前端写死一份"厂商列表"：上游厂商会不断增加，每家的差异
 * （默认地址、鉴权头、必填的额外参数）只有后端注册表知道；前端只认这份目录，
 * 因此后端新增一种上游时前端无需改动。加载失败只影响便利性，故不阻断页面。
 */
const channelTypes = ref<ChannelType[]>([])
const channelCategories = ref<ChannelTypeCategory[]>([])
const channelTypesError = ref('')

async function loadChannelTypes(): Promise<void> {
  try {
    const data = await fetchChannelTypes()
    channelTypes.value = data.items ?? []
    channelCategories.value = data.categories ?? []
    channelTypesError.value = ''
  } catch (err) {
    channelTypes.value = []
    channelCategories.value = []
    channelTypesError.value = err instanceof ApiError ? err.message : '渠道类型加载失败'
  }
}

/**
 * 按大类分组后的类型清单（供下拉的 optgroup 渲染）。
 *
 * 用后端下发的 categories 保序与中文名，避免前端再硬编码一套中英映射；
 * 计数为 0 的大类不展示（否则下拉里会出现空分组）。
 */
const groupedChannelTypes = computed(() =>
  channelCategories.value
    .map((category) => ({
      key: category.key,
      label: category.label,
      items: channelTypes.value.filter((item) => item.category === category.key),
    }))
    .filter((group) => group.items.length > 0),
)

/** 当前选中的接入类型（未选时为 null） */
const selectedTypeKey = ref('')
const selectedChannelType = computed<ChannelType | null>(
  () => channelTypes.value.find((item) => item.key === selectedTypeKey.value) ?? null,
)

/** 选中类型后填写的额外参数：field.key -> value */
const extraValues = ref<Record<string, string>>({})

/** 选中的类型是否尚未实现（不允许保存） */
const typeUnavailable = computed(
  () => selectedChannelType.value !== null && !selectedChannelType.value.available,
)

/**
 * 选中某个接入类型：套用默认地址、重置额外参数。
 *
 * 地址填充规则分两种：
 *   - 允许覆盖（base_url_editable）：仅在用户尚未填写时填入，避免冲掉手填内容；
 *   - 不允许覆盖：强制使用该类型的固定端点。
 */
function applyChannelType(key: string): void {
  selectedTypeKey.value = key
  const type = channelTypes.value.find((item) => item.key === key)
  if (!type) {
    extraValues.value = {}
    return
  }

  if (type.default_base_url) {
    if (!type.base_url_editable) form.value.base_url = type.default_base_url
    else if (!form.value.base_url.trim()) form.value.base_url = type.default_base_url
  }

  const values: Record<string, string> = {}
  for (const field of type.extra_fields) values[field.key] = field.default ?? ''
  extraValues.value = values
}

/** 一键填入该类型（或当前类型）的默认地址 */
function fillDefaultBaseURL(): void {
  const type = selectedChannelType.value
  if (type?.default_base_url) form.value.base_url = type.default_base_url
}

/** 清空类型选择（新建/编辑切换时调用），避免把上一次的类型提示带到下一个渠道 */
function resetChannelType(): void {
  selectedTypeKey.value = ''
  extraValues.value = {}
}

function changePage(next: number): void {
  page.value = next
  void loadChannels()
}

function changeSize(next: number): void {
  size.value = next
  page.value = 1
  void loadChannels()
}

/* ── 表单（新建 / 编辑共用抽屉）───────────────────────── */

interface ChannelForm {
  name: string
  type: number
  base_url: string
  /** 明文密钥：新建时必填；编辑时留空表示不修改 */
  api_key: string
  /**
   * 批量密钥文本：每行一把，支持行内备注（空格或逗号分隔）。
   *
   * 与 api_key 的关系：两者都填时以密钥池为准（池化优先）；
   * 只填 api_key 走单密钥模式；只填批量密钥走池化轮询模式。
   */
  keysText: string
  /**
   * 批量订阅账号凭据文本（订阅类渠道用）。
   *
   * 可直接粘贴 Codex CLI 导出的 auth.json，或每行一条 refresh_token；
   * 留空表示不修改已有订阅账号池。
   */
  oauthTokensText: string
  modelText: string
  /**
   * 本渠道可服务的分组清单（多选，至少一项；第一项是「主分组」）。
   *
   * 为什么是多选：同一上游常要同时服务免费用户与付费用户；只能选一个分组时，
   * 拿着另一个分组的令牌调用会因"没有候选渠道"直接 503（线上实测过）。
   * 主分组只影响展示与统计口径，路由匹配看整个清单。
   */
  groups: string[]
  priority: number
  weight: number
  status: number
  /** 凭据池调度策略标识（来自 GET /api/admin/key-strategies） */
  key_strategy: string
  /**
   * 密钥失败处置策略标识（来自 GET /api/admin/key-failure-policies）。
   *
   * cooldown_only（默认）= 失败只进冷却池、到期自动回池，永不自动摘除；
   * auto_remove = 连续失败达阈值或上游明确判定永久无效时摘除。
   */
  key_failure_policy: string
  /** 密钥失败后的统一冷却时长（秒）；0 表示用系统内置的分级退避 */
  keyCooldownSeconds: number
  /**
   * 上游错误重试总开关。
   *
   * 关闭 = 对上游只尝试一次（不换密钥、不换渠道），适合怕重复扣费的上游；
   * 开启则按下面的次数在站内重试，把可恢复的失败消化掉。
   */
  retryEnabled: boolean
  /** 渠道级重试次数上限（含首次尝试） */
  retryMaxAttempts: number
}

/** 表单默认值：优先级 10、权重 1、启用、最少在途调度，符合常见「默认可用」预期 */
function emptyChannelForm(): ChannelForm {
  return {
    name: '',
    type: 1,
    base_url: '',
    api_key: '',
    keysText: '',
    oauthTokensText: '',
    modelText: '',
    groups: ['default'],
    priority: 10,
    weight: 1,
    status: STATUS_ENABLED,
    // 与后端默认策略一致（least_in_flight）：新建渠道时默认就选中它。
    key_strategy: 'least_in_flight',
    // 与后端默认策略一致（cooldown_only）：失败只进冷却池，避免好密钥被误杀。
    key_failure_policy: 'cooldown_only',
    // 0 = 使用系统内置的分级退避（限流/5xx/鉴权失败各有一档时长）
    keyCooldownSeconds: 0,
    // 与后端默认一致：开启重试、次数用内置默认（3 次）。
    // 站长不改这两项时，行为与升级前完全一致。
    retryEnabled: true,
    retryMaxAttempts: 3,
  }
}

const drawerOpen = ref(false)
const editing = ref<Channel | null>(null)
const form = ref<ChannelForm>(emptyChannelForm())
const formError = ref('')
const saving = ref(false)

const drawerTitle = computed(() => (editing.value ? `编辑渠道 · ${editing.value.name}` : '新建渠道'))

/**
 * 已选模型的集合（用于勾选清单的高亮判断）。
 *
 * 用 computed + Set 而不是在模板里每次 parseModelList：
 * 上游可能有几百个模型，若每次渲染都对文本框做一次解析，
 * 勾选时会明显卡顿。
 */
const selectedModelSet = computed(() => new Set(parseModelList(form.value.modelText)))

/**
 * 已选模型清单（数组形式）。
 *
 * 供重试规则的模型名下拉复用：与上面的 Set 同源，因此模板里不必再解析一次
 * 上百个模型名（那会让每次输入都触发一轮解析）。
 */
const selectedModels = computed(() => Array.from(selectedModelSet.value))

/** 打开新建抽屉 */
function openCreate(): void {
  editing.value = null
  form.value = emptyChannelForm()
  formError.value = ''
  // 清空上一次的上游模型缓存，避免把 A 上游的模型误选到 B 渠道
  upstreamModels.value = []
  upstreamError.value = ''
  // 映射同样必须清空：否则会把上一个渠道的映射误提交到新渠道
  mappingRows.value = []
  mappingError.value = ''
  mappingPrefix.value = ''
  // 模型级重试规则同理：残留行会被误当成新渠道的配置提交
  retryRuleRows.value = []
  resetChannelType()
  drawerOpen.value = true
}

/**
 * 打开编辑抽屉：先取详情再填充。
 * 为什么不用列表行数据：列表可能被其他管理员改过，取详情能确保编辑的是最新配置。
 */
async function openEdit(channel: Channel): Promise<void> {
  editing.value = channel
  // 编辑现有渠道时渠道里没有类型标识（后端只存数字 type），因此类型选择器留空，
  // 由管理员按需重新选择；这样既不臆造映射，也不影响原有编辑功能。
  resetChannelType()
  form.value = {
    name: channel.name,
    type: channel.type,
    base_url: channel.base_url,
    api_key: '',
    keysText: '',
    oauthTokensText: '',
    modelText: joinModelList(channel.models),
    groups: channel.groups?.length ? [...channel.groups] : [channel.group || 'default'],
    priority: channel.priority,
    weight: channel.weight,
    status: channel.status,
    key_strategy: channel.key_strategy || 'least_in_flight',
    key_failure_policy: channel.key_failure_policy || 'cooldown_only',
    keyCooldownSeconds: channel.key_cooldown_seconds ?? 0,
    retryEnabled: channel.retry_enabled ?? true,
    retryMaxAttempts: channel.retry_max_attempts ?? 3,
  }
  formError.value = ''
  // 先清空映射并置为加载中，避免残留上一个渠道的映射行被误提交
  mappingRows.value = []
  mappingError.value = ''
  mappingLoading.value = true
  // 重试规则随渠道详情下发，先用列表数据填一次，取到详情后再覆盖
  retryRuleRows.value = toRetryRuleRows(channel.model_retry_rules)
  drawerOpen.value = true

  try {
    const detail = await getChannel(channel.id)
    editing.value = detail
    form.value = {
      name: detail.name,
      type: detail.type,
      base_url: detail.base_url,
      api_key: '',
      keysText: '',
      oauthTokensText: '',
      modelText: joinModelList(detail.models),
      groups: detail.groups?.length ? [...detail.groups] : [detail.group || 'default'],
      priority: detail.priority,
      weight: detail.weight,
      status: detail.status,
      key_strategy: detail.key_strategy || 'least_in_flight',
      key_failure_policy: detail.key_failure_policy || 'cooldown_only',
      keyCooldownSeconds: detail.key_cooldown_seconds ?? 0,
      retryEnabled: detail.retry_enabled ?? true,
      retryMaxAttempts: detail.retry_max_attempts ?? 3,
    }
    retryRuleRows.value = toRetryRuleRows(detail.model_retry_rules)
  } catch (err) {
    // 取详情失败不阻断编辑：至少列表数据可用，但提示用户
    toastError(err instanceof ApiError ? err.message : '渠道详情加载失败，已使用列表数据')
  }
  // 映射是独立资源（渠道详情里不含），单独取一次；失败只影响这一个区块
  await loadChannelMappings(channel.id)
}

function validateForm(): string | null {
  if (typeUnavailable.value) return '该接入类型的适配器尚未实现，暂不可选用'
  if (!form.value.name.trim()) return '请填写渠道名称'
  if (!form.value.base_url.trim()) return '请填写上游 Base URL'
  if (!/^https?:\/\//i.test(form.value.base_url.trim())) return 'Base URL 需以 http:// 或 https:// 开头'
  // 新建时必须至少提供一种凭据：单密钥 / 批量密钥池 / 订阅账号
  if (
    !editing.value &&
    !form.value.api_key.trim() &&
    !form.value.keysText.trim() &&
    !form.value.oauthTokensText.trim()
  ) {
    return '新建渠道必须填写凭据（单密钥、批量密钥或订阅账号至少填一项）'
  }
  if (form.value.priority < 0) return '优先级不能为负数'
  if (form.value.weight <= 0) return '权重必须大于 0'
  // 分组：至少一项且不能为空串。不属于任何分组的渠道既不会被选中，
  // 也不会出现在任何分组页面里，属于"配了但永远不生效"的静默失效。
  const groups = form.value.groups.map((name) => name.trim()).filter(Boolean)
  if (groups.length === 0) return '请至少填写一个分组'
  if (groups.length !== form.value.groups.length) return '分组名不能为空'
  if (cooldownSecondsInvalid.value) {
    return `密钥冷却时长必须在 0 ~ ${maxCooldownSeconds.value} 秒之间（当前 ${form.value.keyCooldownSeconds}）`
  }
  // 重试次数与模型级规则：越界值后端会 400，提前拦住能给出更具体的提示
  const attempts = Number(form.value.retryMaxAttempts)
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_RETRY_ATTEMPTS) {
    return `重试次数必须在 1 ~ ${MAX_RETRY_ATTEMPTS} 之间（当前 ${form.value.retryMaxAttempts}）`
  }
  const retryInvalid = validateRetryRules()
  if (retryInvalid) return retryInvalid
  return null
}

/**
 * 从表单里推测一把可用于上游鉴权的密钥。
 *
 * 为什么要"推测"：拉取模型清单需要真实密钥，而用户可能只填了批量密钥框
 * （还没保存渠道）。这里取第一行有效密钥的首个字段作为探测用密钥。
 */
function firstKeyFromText(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // 与后端解析规则保持一致：优先按逗号/制表符切分，其次按空格
    const [head] = trimmed.split(/[,，\t\s]/, 1)
    if (head) return head
  }
  return ''
}

/** 从上游拉取模型列表，并展示为可勾选清单 */
async function pullModels(): Promise<void> {
  upstreamError.value = ''
  const baseURL = form.value.base_url.trim()
  const apiKey = form.value.api_key.trim() || firstKeyFromText(form.value.keysText)

  const payload: FetchModelsPayload = {}
  if (editing.value && !apiKey) {
    // 编辑已有渠道且表单里没有新密钥：让后端用库里保存的地址与密钥池
    payload.channel_id = editing.value.id
  } else {
    if (!baseURL) {
      upstreamError.value = '请先填写上游 Base URL'
      return
    }
    payload.base_url = baseURL
    if (apiKey) payload.api_key = apiKey
  }

  fetchingModels.value = true
  try {
    const result = await fetchUpstreamModels(payload)
    upstreamModels.value = result.models ?? []
    toastSuccess(`已从上游拉取 ${result.count} 个模型`)
  } catch (err) {
    upstreamModels.value = []
    upstreamError.value = err instanceof ApiError ? err.message : '拉取模型列表失败'
  } finally {
    fetchingModels.value = false
  }
}

/** 勾选/取消勾选某个模型 */
function toggleModel(name: string): void {
  const current = parseModelList(form.value.modelText)
  form.value.modelText = current.includes(name)
    ? current.filter((item) => item !== name).join(', ')
    : [...current, name].join(', ')
}

/** 一键选中上游返回的全部模型 */
function selectAllModels(): void {
  form.value.modelText = upstreamModels.value.join(', ')
}

/** 清空模型声明（等价于"支持全部模型"） */
function clearModels(): void {
  form.value.modelText = ''
}

/* ── 上游计费（渠道 × 模型进价）──────────────────────────── */

/**
 * 抽屉里的一行进价草稿。
 *
 * 价格用字符串保存：输入过程中会出现空串与半成品（如 "1."），
 * 用 number 会因为 v-model.number 把空串变成 NaN，界面显示成 "NaN"。
 */
interface CostRowDraft {
  model: string
  promptPrice: string
  cachePrice: string
  completionPrice: string
  perCallPrice: string
  remark: string
}

const costDrawerOpen = ref(false)
const costOfChannel = ref<Channel | null>(null)
const costRows = ref<CostRowDraft[]>([])
/** 该渠道声明的模型清单，用于「补入渠道模型」一键预填（避免手敲模型名敲错） */
const declaredModels = ref<string[]>([])
const costLoading = ref(false)
const costSaving = ref(false)
const costError = ref('')

/** 打开某渠道的上游计费抽屉 */
async function openCosts(channel: Channel): Promise<void> {
  costOfChannel.value = channel
  costDrawerOpen.value = true
  await loadCosts(channel.id)
}

/** 读取该渠道的上游进价 */
async function loadCosts(channelId: number): Promise<void> {
  costLoading.value = true
  costError.value = ''
  try {
    const result = await listChannelCosts(channelId)
    costRows.value = (result.items ?? []).map((item) => ({
      model: item.model,
      promptPrice: String(item.prompt_price),
      cachePrice: String(item.cache_price),
      completionPrice: String(item.completion_price),
      perCallPrice: String(item.per_call_price),
      remark: item.remark,
    }))
    declaredModels.value = result.declared_models ?? []
  } catch (err) {
    costRows.value = []
    declaredModels.value = []
    costError.value = err instanceof ApiError ? err.message : '上游成本加载失败'
  } finally {
    costLoading.value = false
  }
}

/** 把价格输入转成非负整数（空串与非法值一律当 0） */
function toCostNumber(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed)
}

/** 新增一行空白草稿（模型名留空，保存时会被忽略） */
function addCostRow(): void {
  costRows.value.push({
    model: '',
    promptPrice: '0',
    cachePrice: '0',
    completionPrice: '0',
    perCallPrice: '0',
    remark: '',
  })
}

/** 删除一行 */
function removeCostRow(index: number): void {
  costRows.value.splice(index, 1)
}

/**
 * 补入该渠道声明的模型（已存在的跳过）。
 *
 * 存在的意义：手敲模型名敲错一个字符，成本规则会静默不生效——
 * 核算时表现为"这个模型未录进价"，而站长会以为"已经配过了"。
 */
function fillDeclaredModels(): void {
  const existing = new Set(costRows.value.map((row) => row.model.trim()))
  let added = 0
  for (const name of declaredModels.value) {
    if (!name || existing.has(name)) continue
    costRows.value.push({
      model: name,
      promptPrice: '0',
      cachePrice: '0',
      completionPrice: '0',
      perCallPrice: '0',
      remark: '',
    })
    added += 1
  }
  if (added === 0) {
    toastSuccess('渠道声明的模型已全部在列表中')
  } else {
    toastSuccess(`已补入 ${added} 个渠道声明的模型`)
  }
}

/** 保存整批进价（整体替换语义：表里没有的行会被删除） */
async function submitCosts(): Promise<void> {
  const channel = costOfChannel.value
  if (!channel) return

  const items: ChannelModelCostPayload[] = []
  for (const row of costRows.value) {
    const modelName = row.model.trim()
    // 空行直接忽略：界面上的"新增一行"会先给空行，若因此整批拒绝，
    // 站长每次保存前都要先删空行。
    if (!modelName) continue
    items.push({
      model: modelName,
      prompt_price: toCostNumber(row.promptPrice),
      cache_price: toCostNumber(row.cachePrice),
      completion_price: toCostNumber(row.completionPrice),
      per_call_price: toCostNumber(row.perCallPrice),
      remark: row.remark.trim(),
    })
  }

  // 清空是合法但危险的动作用：确认一次，避免点错按钮把整张成本表清掉
  if (items.length === 0) {
    const ok = await confirmDialog({
      title: '清空上游进价',
      message: '当前没有任何有效行，保存后将清空该渠道的全部进价配置（密钥余额核算会因此失去依据）。',
      confirmText: '确认清空',
      danger: true,
    })
    if (!ok) return
  }

  costSaving.value = true
  costError.value = ''
  try {
    const result = await saveChannelCosts(channel.id, items)
    toastSuccess(`上游进价已保存：新增 ${result.created} 条，更新 ${result.updated} 条`)
    await loadCosts(channel.id)
  } catch (err) {
    costError.value = err instanceof ApiError ? err.message : '保存失败'
  } finally {
    costSaving.value = false
  }
}

/* ── 密钥池明细 ───────────────────────────────────────── */

/** 打开某渠道的密钥池抽屉 */
async function openKeys(channel: Channel): Promise<void> {
  keysOfChannel.value = channel
  keysDrawerOpen.value = true
  // 每次打开都回到"只显示掩码"的安全默认，避免上一次的明文状态被带进来
  keysReveal.value = false
  await loadChannelKeys(channel.id)
}

/** 切换"显示明文"：开启前二次确认，避免误触把整池明文摊在屏幕上 */
async function toggleReveal(): Promise<void> {
  if (keysReveal.value) {
    keysReveal.value = false
    if (keysOfChannel.value) await loadChannelKeys(keysOfChannel.value.id)
    return
  }
  const ok = await confirmDialog({
    title: '显示密钥原文',
    message:
      '将在页面上显示该渠道全部凭据的原文（包含订阅账号的 refresh token）。' +
      '请确认当前没有第三方在旁观看或录屏。本次查看会被记入「操作审计」。',
    confirmText: '显示明文',
    danger: true,
  })
  if (!ok) return
  keysReveal.value = true
  if (keysOfChannel.value) await loadChannelKeys(keysOfChannel.value.id)
}

/** 读取密钥池明细（默认只含掩码，开启显示明文时含原文），并重置每把密钥的调度参数草稿 */
async function loadChannelKeys(channelId: number): Promise<void> {
  keysLoading.value = true
  keysError.value = ''
  try {
    // 用量核算与密钥列表并行取：核算失败只让"已用/剩余"缺省，不影响密钥池本身。
    const [result, usageResult] = await Promise.all([
      listChannelKeysWithBalance(channelId, keysReveal.value),
      fetchChannelKeyUsage(channelId).catch(() => null),
    ])
    channelKeys.value = result.items ?? []
    syncKeyDrafts(channelKeys.value)

    const usageMap: Record<number, ChannelKeyUsage> = {}
    for (const item of usageResult?.items ?? []) {
      usageMap[item.channel_key_id] = item
    }
    keyUsage.value = usageMap
  } catch (err) {
    channelKeys.value = []
    keyDrafts.value = {}
    keyUsage.value = {}
    keysError.value = err instanceof ApiError ? err.message : '密钥列表加载失败'
  } finally {
    keysLoading.value = false
  }
}

/** 密钥用量摘要的视图模型（永不返回 null，模板中可直接取字段） */
interface KeyUsageView {
  /** 是否取到了核算数据（取不到时不显示"已用/剩余"） */
  known: boolean
  /** 已消耗（按上游进价估算），已是展示用字符串 */
  used: string
  /** 估算剩余；未录入余额时为空串（不显示） */
  remaining: string
  /** 剩余是否已归零或为负（超支） */
  overdue: boolean
  /** 未录进价的模型数量（>0 时提示站长去补录） */
  unpricedCount: number
}

/**
 * 取某把密钥的用量摘要。
 *
 * 返回视图模型而不是原始对象：模板里无法安全访问可能为 undefined 的字段
 *（Vue 模板不支持非空断言），返回一个字段齐全的对象最省心。
 */
function usageView(keyId: number): KeyUsageView {
  const usage = keyUsage.value[keyId]
  if (!usage) {
    return { known: false, used: '', remaining: '', overdue: false, unpricedCount: 0 }
  }
  return {
    known: true,
    used: formatNumber(usage.estimated_cost),
    remaining: usage.balance_known ? formatNumber(usage.remaining) : '',
    overdue: usage.balance_known && usage.remaining <= 0,
    unpricedCount: usage.unpriced_models.length,
  }
}

/** 用最新读到的密钥数据重置草稿，避免上一次编辑残留在界面上 */
function syncKeyDrafts(keys: ChannelKeyWithBalance[]): void {
  const drafts: Record<number, KeySchedulingDraft> = {}
  for (const key of keys) {
    drafts[key.id] = {
      weight: key.weight,
      priority: key.priority,
      rpm_limit: key.rpm_limit,
      balance: key.balance,
      groupsText: joinModelList(key.groups),
      modelsText: joinModelList(key.models),
    }
  }
  keyDrafts.value = drafts
}

/**
 * 保存某把凭据的调度参数与路由分叉（weight / priority / rpm_limit / groups / models）。
 *
 * 为什么把分叉与调度参数放在同一个保存动作里：它们都是"这把凭据怎么被选中"的配置，
 * 分成两个按钮只会让站长多点一次、且容易只改一半；后端也支持一次请求提交全部字段。
 * 注意分叉两项必须同时提交（后端整组覆盖，缺项会被误写成"不限"）。
 */
async function saveKeyScheduling(key: ChannelKeyWithBalance): Promise<void> {
  const draft = keyDrafts.value[key.id]
  if (!draft) return
  // 前端先做一次校验：避免把负数提交给后端再拿回一条错误
  if (draft.weight < 0 || draft.priority < 0 || draft.rpm_limit < 0) {
    toastError('权重 / 优先级 / 每分钟上限不能为负数')
    return
  }
  const groups = parseModelList(draft.groupsText)
  const models = parseModelList(draft.modelsText)
  // 模型名含空白时后端会 400；这里提前拦住并给出更具体的提示（多半是误用了中文逗号之外的空白）
  if (models.some((name) => /\s/.test(name))) {
    toastError('模型名不能包含空白字符（多个模型请用逗号分隔）')
    return
  }
  savingKeyId.value = key.id
  try {
    await updateChannelKey(key.id, {
      weight: Number(draft.weight) || 0,
      priority: Number(draft.priority) || 0,
      rpm_limit: Number(draft.rpm_limit) || 0,
      groups,
      models,
    })
    toastSuccess('凭据配置已保存')
    if (keysOfChannel.value) await loadChannelKeys(keysOfChannel.value.id)
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '保存凭据配置失败')
  } finally {
    savingKeyId.value = null
  }
}

/**
 * 保存某把密钥的余额。
 *
 * 约定：-1 表示"未录入"（清空），>=0 为实际余额（0 表示已用尽，会自动退出调度）。
 * 前端做一次下限校验，避免把 < -1 的值提交给后端。
 */
async function saveKeyBalance(key: ChannelKeyWithBalance): Promise<void> {
  const draft = keyDrafts.value[key.id]
  if (!draft) return
  const balance = Number(draft.balance)
  if (!Number.isFinite(balance) || balance < -1) {
    toastError('余额不能小于 -1（-1 表示未录入）')
    return
  }
  savingBalanceId.value = key.id
  try {
    await updateChannelKeyBalance(key.id, { balance })
    toastSuccess('凭据余额已保存')
    if (keysOfChannel.value) await loadChannelKeys(keysOfChannel.value.id)
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '保存余额失败')
  } finally {
    savingBalanceId.value = null
  }
}

/**
 * 把冷却截止时间换算成"剩余多久"的文案。
 *
 * 后端下发的是 Unix 秒；`now` 每秒刷新，因此文案会实时递减。
 * 未冷却（0 或已到期）显示 "—"，避免用"0 秒"造成仍在冷却的误解。
 */
function cooldownText(key: ChannelKeyWithBalance): string {
  if (!key.cooldown_until) return '—'
  const remainMs = key.cooldown_until * 1000 - now.value
  if (remainMs <= 0) return '—'

  const remainSeconds = Math.ceil(remainMs / 1000)
  const hours = Math.floor(remainSeconds / 3600)
  const minutes = Math.floor((remainSeconds % 3600) / 60)
  const seconds = remainSeconds % 60
  if (hours > 0) return `冷却中 ${hours} 时 ${minutes} 分`
  if (minutes > 0) return `冷却中 ${minutes} 分 ${seconds} 秒`
  return `冷却中 ${seconds} 秒`
}

/** 启用 / 禁用 / 恢复某把密钥 */
async function setKeyStatus(key: ChannelKeyWithBalance, status: number): Promise<void> {
  keyBusyId.value = key.id
  try {
    await updateChannelKey(key.id, { status })
    toastSuccess(`密钥已${status === KEY_STATUS_ENABLED ? '启用' : '禁用'}`)
    if (keysOfChannel.value) await loadChannelKeys(keysOfChannel.value.id)
    // 池内可用密钥数会影响列表展示，一并刷新
    await loadChannels()
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    keyBusyId.value = null
  }
}

/** 密钥池按状态统计（抽屉顶部概览用） */
const keyStats = computed(() => {
  const stats = { enabled: 0, disabled: 0, removed: 0, cooling: 0, exhausted: 0 }
  for (const key of channelKeys.value) {
    if (key.status === KEY_STATUS_AUTO_REMOVED) stats.removed += 1
    else if (key.status === KEY_STATUS_DISABLED) stats.disabled += 1
    else stats.enabled += 1
    // 冷却与余额耗尽是"运行态"，与持久状态无关：
    // 一把"启用"的密钥此刻也可能因冷却/余额耗尽而完全不参与调度，
    // 分开统计才能解释"池里显示可用很多把，实际却总失败"。
    if (key.cooldown_until * 1000 > now.value) stats.cooling += 1
    if (key.balance_exhausted) stats.exhausted += 1
  }
  return stats
})

/**
 * 单把密钥的【综合可用性】。
 *
 * 为什么不能只看持久状态：一把 status=启用 的密钥可能正在冷却或余额已耗尽，
 * 此刻完全不参与调度。只看 status 会得到"池里可用 500 把"这种与实际不符的结论，
 * 站长据此排查必然找错方向。
 */
function keyUsabilityText(key: ChannelKeyWithBalance): string {
  if (key.status === KEY_STATUS_DISABLED) return '已禁用'
  if (key.status === KEY_STATUS_AUTO_REMOVED) return '已摘除'
  if (key.balance_exhausted) return '余额耗尽'
  if (key.cooldown_until * 1000 > now.value) return '冷却中'
  return '可用'
}

/** 综合可用性对应的徽标样式 */
function keyUsabilityClass(key: ChannelKeyWithBalance): string {
  const text = keyUsabilityText(key)
  if (text === '可用') return 'badge badge-ok'
  if (text === '冷却中') return 'badge badge-warn'
  if (text === '余额耗尽') return 'badge badge-warn'
  if (text === '已摘除') return 'badge badge-err'
  return 'badge badge-off'
}

/** 渠道在表格"密钥"列展示的文案 */
function keyColumnText(channel: Channel): string {
  const pool = channel.key_pool
  if (pool && pool.total > 0) {
    return `池 ${pool.total} 把（可用 ${pool.enabled}）`
  }
  return channel.masked_key || '未配置'
}

/* ── 订阅账号额度（ChatGPT/Codex 等） ───────────────────────────── */

/** 正在查询额度的凭据 ID；0 表示没有进行中的查询 */
const probingQuotaId = ref(0)

/**
 * 订阅账号的额度文案。
 *
 * 三态必须分开显示："未探测"与"已用 0%"含义完全不同——
 * 前者是"我们没问过"，后者是"额度充足"。混在一起会让站长误判。
 */
function quotaText(key: ChannelKeyWithBalance): string {
  if (!key.quota_known) return '未探测'
  return `${key.quota_used_percent}%`
}

/** 额度文案的徽标样式：用满高亮告警，未探测保持中性 */
function quotaClass(key: ChannelKeyWithBalance): string {
  if (!key.quota_known) return 'badge badge-off'
  if (key.quota_exhausted) return 'badge badge-warn'
  if (key.quota_used_percent >= 80) return 'badge badge-warn'
  return 'badge badge-ok'
}

/** 额度窗口的恢复时间提示（仅在已用满且已知重置时间时有意义） */
function quotaResetText(key: ChannelKeyWithBalance): string {
  if (!key.quota_reset_at) return ''
  return `${formatDateTime(key.quota_reset_at)} 恢复`
}

/**
 * 查询该账号的上游额度并就地刷新那一行。
 *
 * 为什么只刷一行而不是重拉整表：查询是按需触发的，重拉整表会打断
 * 站长正在做的其它编辑（比如刚输入的余额草稿）。
 */
async function probeQuota(key: ChannelKeyWithBalance): Promise<void> {
  const channel = keysOfChannel.value
  if (!channel || probingQuotaId.value) return
  probingQuotaId.value = key.id
  try {
    const result = await probeChannelKeyQuota(channel.id, key.id)
    if (result.used_percent >= 0) {
      key.quota_used_percent = result.used_percent
      key.quota_known = true
    }
    key.quota_reset_at = result.reset_at || 0
    key.quota_checked_at = Math.floor(Date.now() / 1000)
    // 与后端 QuotaExhausted 的口径保持一致：已用满且重置时间未到才算耗尽
    key.quota_exhausted = result.used_percent >= 100 && key.quota_reset_at * 1000 > Date.now()
    if (result.plan_type) key.plan_type = result.plan_type
    toastSuccess(result.note || '额度快照已更新')
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '额度查询失败')
  } finally {
    probingQuotaId.value = 0
  }
}

async function submitForm(): Promise<void> {
  const invalid = validateForm()
  if (invalid) {
    formError.value = invalid
    return
  }
  const mappingInvalid = validateMappings()
  if (mappingInvalid) {
    formError.value = mappingInvalid
    return
  }

  // 先把映射里的平台模型 ID 并入声明清单，再据此提交渠道。
  // 顺序很重要：渠道的 models 清单决定"路由时该渠道能否接住这个模型"，
  // 平台名若不在清单里，映射永远不会被命中（静默失效，最难排查）。
  syncMappingPublicModels()

  const payload: ChannelPayload = {
    name: form.value.name.trim(),
    type: Number(form.value.type) || 1,
    base_url: form.value.base_url.trim(),
    models: parseModelList(form.value.modelText),
    // 多分组：groups 为准，同时带上主分组 group（= 清单首项）便于旧接口/脚本读取
    groups: form.value.groups.map((name) => name.trim()).filter(Boolean),
    group: form.value.groups[0]?.trim() || 'default',
    priority: Number(form.value.priority) || 0,
    weight: Number(form.value.weight) || 1,
    status: form.value.status,
    key_strategy: form.value.key_strategy,
    key_failure_policy: form.value.key_failure_policy,
    // 始终提交冷却时长：后端用"字段缺失 = 不修改"的语义，
    // 若因为值为 0 就省略，站长将永远改不回"使用系统默认退避"。
    key_cooldown_seconds: Number(form.value.keyCooldownSeconds) || 0,
    // 重试策略：始终提交，让"界面上看到的"就是"实际生效的"。
    // 次数显式提交（后端把 0 解释为"用内置默认"，且用指针区分"未提交"）。
    retry_enabled: form.value.retryEnabled,
    retry_max_attempts: Number(form.value.retryMaxAttempts) || 0,
    // 模型级规则同样始终整组提交：显式提交 [] 表示"清空"，
    // 否则删掉最后一行规则后旧规则会一直留在库里（静默失效的反面）。
    model_retry_rules: retryRulesPayload(),
  }
  // 编辑时密钥留空表示「不修改」，因此不发送该字段（避免把密钥覆盖为空）
  if (form.value.api_key.trim()) payload.api_key = form.value.api_key.trim()
  // 批量密钥同理：留空即不动密钥池，防止"只改个名字却清空了 500 把密钥"
  if (form.value.keysText.trim()) payload.keys_text = form.value.keysText
  // 订阅账号与 API Key 分开提交：后端按类型分别做差集增删，
  // 因此导入订阅账号不会影响已有密钥池，反之亦然。
  if (form.value.oauthTokensText.trim()) payload.oauth_tokens_text = form.value.oauthTokensText

  saving.value = true
  formError.value = ''
  try {
    // 新建渠道要先拿到 id 才能写映射（映射挂在渠道下），因此分两步：
    // 保存渠道 → 拿到 id/或复用已有 id → 整组替换映射。
    let channelID = editing.value?.id ?? 0
    if (editing.value) {
      await updateChannel(channelID, payload)
    } else {
      const created = await createChannel(payload)
      channelID = created?.id ?? 0
    }

    // 映射单独提交：失败时渠道本身已保存成功，必须明确告知"哪一半失败了"，
    // 否则管理员会以为整次保存都失败而反复重试。
    const rows = mappingPayload()
    try {
      await replaceChannelMappings(
        channelID,
        rows.map((row) => ({
          public_model: row.publicModel.trim(),
          upstream_model: row.upstreamModel.trim(),
          enabled: row.enabled,
        })),
      )
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : '未知错误'
      formError.value = `渠道已保存，但模型 ID 映射保存失败：${reason}`
      toastError('渠道已保存，模型映射未保存')
      await loadChannels()
      return
    }

    toastSuccess(editing.value ? '渠道已更新' : '渠道已创建')
    drawerOpen.value = false
    await loadChannels()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

/* ── 测活 / 启停 / 删除 ───────────────────────────────── */

async function runTest(channel: Channel): Promise<void> {
  testingId.value = channel.id
  try {
    const result = await testChannel(channel.id)
    testResults.value = { ...testResults.value, [channel.id]: result }
    // 无论成功失败都自动展开详情：成功时能核对"用的哪把密钥、池里还剩多少"，
    // 失败时能立刻看到上游原话，省掉"再点一次看原因"。
    testDetailId.value = channel.id
    if (result.ok) {
      toastSuccess(`「${channel.name}」连通正常，延迟 ${result.latency_ms} ms`)
    } else {
      toastError(`「${channel.name}」测活失败：${result.message || `HTTP ${result.status_code}`}`)
    }
    // 测活会更新渠道的测试时间与状态，重新拉取以保证表格与后端一致
    await loadChannels()
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '测活请求失败')
  } finally {
    testingId.value = null
  }
}

async function toggleStatus(channel: Channel): Promise<void> {
  const nextStatus = channel.status === STATUS_ENABLED ? STATUS_DISABLED : STATUS_ENABLED
  busyId.value = channel.id
  try {
    // 契约中渠道更新为 PUT（全量），因此提交当前渠道的完整配置，仅替换 status
    await updateChannel(channel.id, {
      name: channel.name,
      type: channel.type,
      base_url: channel.base_url,
      models: channel.models,
      groups: channel.groups,
      group: channel.group,
      priority: channel.priority,
      weight: channel.weight,
      status: nextStatus,
    })
    toastSuccess(nextStatus === STATUS_ENABLED ? '渠道已启用' : '渠道已停用')
    await loadChannels()
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

async function removeChannel(channel: Channel): Promise<void> {
  const ok = await confirmDialog({
    title: '删除渠道',
    message: `删除「${channel.name}」后，该渠道不再参与请求调度；依赖该渠道的模型可能因此不可用。`,
    confirmText: '删除渠道',
    danger: true,
  })
  if (!ok) return

  busyId.value = channel.id
  try {
    await deleteChannel(channel.id)
    toastSuccess('渠道已删除')
    if (channels.value.length === 1 && page.value > 1) page.value -= 1
    await loadChannels()
  } catch (err) {
    toastError(err instanceof ApiError ? err.message : '删除失败')
  } finally {
    busyId.value = null
  }
}

const isEmpty = computed(() => !loading.value && !error.value && channels.value.length === 0)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">渠道管理</h2>
        <p class="page-desc">渠道决定请求可以转发到哪些上游。密钥仅在提交时发送，列表只显示掩码。</p>
      </div>
      <div class="toolbar">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="loadChannels">
          <AppIcon name="refresh" :size="14" />
          刷新
        </button>
        <button type="button" class="btn btn-primary btn-sm" @click="openCreate">
          <AppIcon name="plus" :size="15" />
          新建渠道
        </button>
      </div>
    </div>

    <!-- 滑动提示只在桌面端出现：窄屏已切换为卡片视图（.table-cards），不需要左右滑动 -->
    <p class="mb-2 hidden text-xs text-ink-400 lg:block">表格列较多，可左右滑动查看完整内容。</p>

    <div class="table-wrap table-cards">
      <table class="data-table min-w-[1220px]">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>Base URL</th>
            <th>密钥</th>
            <th class="text-right">模型</th>
            <th>分组</th>
            <th class="text-right">优先级</th>
            <th class="text-right">权重</th>
            <th>状态</th>
            <th>最近测活</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>

        <tbody>
          <DataState
            :loading="loading"
            :error="error"
            :empty="isEmpty"
            :colspan="11"
            loading-text="正在加载渠道列表…"
            empty-text="还没有配置渠道"
            empty-hint="添加第一个上游渠道后，平台才能对外提供模型服务。"
            @retry="loadChannels"
          >
            <template #action>
              <button type="button" class="btn btn-primary btn-sm" @click="openCreate">
                <AppIcon name="plus" :size="14" />
                新建渠道
              </button>
            </template>
          </DataState>

          <template v-if="!loading && !error && channels.length">
            <template v-for="channel in channels" :key="channel.id">
              <tr>
              <td class="font-medium text-ink-100" data-label="名称">
                <span class="flex items-center gap-2">
                  {{ channel.name }}
                  <span v-if="channel.last_test_ok === false" class="text-amber-700" title="上次测活失败">
                    <AppIcon name="alert" :size="14" />
                  </span>
                </span>
              </td>

              <td class="whitespace-nowrap text-ink-300" data-label="类型">{{ channelTypeLabel(channel.type) }}</td>

              <td class="max-w-[16rem]" data-label="Base URL">
                <span class="block truncate font-mono text-xs text-ink-300" :title="channel.base_url">
                  {{ channel.base_url }}
                </span>
              </td>

              <td data-label="密钥">
                <!-- 配了密钥池的渠道：显示池概况并可点开看明细（含失效密钥） -->
                <button
                  v-if="channel.key_pool && channel.key_pool.total > 0"
                  type="button"
                  class="chip transition hover:border-brand-500/40 hover:text-brand-700"
                  title="查看密钥池明细"
                  @click="openKeys(channel)"
                >
                  {{ keyColumnText(channel) }}
                </button>
                <code v-else class="chip">{{ channel.masked_key || '未配置' }}</code>
              </td>

              <td class="cell-num" data-label="模型">
                <span v-if="channel.models && channel.models.length" :title="channel.models.join(', ')">
                  {{ channel.models.length }}
                </span>
                <span v-else class="text-xs text-ink-400">全部</span>
              </td>

              <td class="whitespace-nowrap text-ink-300" data-label="分组">
                <!-- 多分组渠道逐个展示：只显示主分组会让站长误判"这个渠道没服务另一个分组" -->
                <span class="flex flex-wrap gap-1">
                  <span v-for="name in channel.groups?.length ? channel.groups : [channel.group]" :key="name" class="chip">
                    {{ name }}
                  </span>
                </span>
              </td>
              <td class="cell-num" data-label="优先级">{{ channel.priority }}</td>
              <td class="cell-num" data-label="权重">{{ channel.weight }}</td>

              <td data-label="状态">
                <!-- 用共享的三态口径（启用 / 手动停用 / 自动停用），
                     不再各页自写文案：同一个渠道在不同页面显示不同状态会让站长找错原因 -->
                <span :class="channelStatusBadgeClass(channel.status)">
                  <span class="dot" />
                  {{ channelStatusLabel(channel.status) }}
                </span>
              </td>

              <td class="whitespace-nowrap" data-label="最近测活">
                <!-- 测活完成后即时展示延迟与结论，并可点开看详情（失败原因/用的哪把密钥） -->
                <button
                  v-if="testResults[channel.id]"
                  type="button"
                  class="flex items-center gap-1.5"
                  :title="testResults[channel.id].message"
                  @click="testDetailId = testDetailId === channel.id ? null : channel.id"
                >
                  <span :class="testResults[channel.id].ok ? 'badge badge-ok' : 'badge badge-err'">
                    {{ testResults[channel.id].ok ? '通过' : '失败' }}
                  </span>
                  <span class="font-mono text-[11px] text-ink-300">{{ testResults[channel.id].latency_ms }} ms</span>
                  <span class="text-[11px] text-brand-700">{{ testDetailId === channel.id ? '收起' : '详情' }}</span>
                </button>
                <span v-else-if="channel.last_test_at" class="cell-muted">
                  {{ channel.last_test_ok === false ? '上次失败' : '上次通过' }}
                </span>
                <span v-else class="cell-muted">未测活</span>
              </td>

              <td class="cell-actions" data-label="操作">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="btn btn-row"
                    title="测活（真实发起一次请求）"
                    :disabled="testingId === channel.id"
                    @click="runTest(channel)"
                  >
                    <span
                      v-if="testingId === channel.id"
                      class="mx-auto block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400"
                    />
                    <AppIcon v-else name="play" :size="14" />
                  </button>

                  <button type="button" class="btn btn-row" title="编辑" @click="openEdit(channel)">
                    <AppIcon name="edit" :size="14" />
                  </button>

                  <!-- 上游计费：录入「上游每个模型怎么收我的钱」，是成本核算与密钥余额的依据 -->
                  <button
                    type="button"
                    class="btn btn-row"
                    title="上游计费（每个模型的上游进价）"
                    @click="openCosts(channel)"
                  >
                    <AppIcon name="quota" :size="14" />
                  </button>

                  <button
                    type="button"
                    class="btn btn-row"
                    :title="channel.status === STATUS_ENABLED ? '停用' : '启用'"
                    :disabled="busyId === channel.id"
                    @click="toggleStatus(channel)"
                  >
                    <AppIcon :name="channel.status === STATUS_ENABLED ? 'lock' : 'bolt'" :size="14" />
                  </button>

                  <button
                    type="button"
                    class="btn btn-row text-ink-400 hover:text-red-700"
                    title="删除"
                    :disabled="busyId === channel.id"
                    @click="removeChannel(channel)"
                  >
                    <AppIcon name="trash" :size="14" />
                  </button>
                </div>
              </td>
            </tr>

            <!-- 测活详情：结论、上游原话、本次使用的凭据与池内状况。
                 单看"通过/失败"无法行动，这些细节才是排查依据。 -->
            <tr v-if="testDetailId === channel.id && testResults[channel.id]" class="bg-ink-950/60">
              <td :colspan="11" class="text-xs leading-relaxed">
                <div class="space-y-1.5 py-1">
                  <p class="text-ink-200">
                    <span class="font-medium">测活结论：</span>{{ testResults[channel.id].message }}
                  </p>
                  <p v-if="testResults[channel.id].model" class="text-ink-400">
                    探测模型：<code>{{ testResults[channel.id].model }}</code>
                    <span v-if="testResults[channel.id].upstream_model && testResults[channel.id].upstream_model !== testResults[channel.id].model">
                      　上游实际收到：<code>{{ testResults[channel.id].upstream_model }}</code>
                    </span>
                    <span v-if="testResults[channel.id].status_code">
                      　HTTP 状态：<code>{{ testResults[channel.id].status_code }}</code>
                    </span>
                    　耗时 {{ testResults[channel.id].latency_ms }} ms
                  </p>
                  <p v-if="testResults[channel.id].key_source === 'pool'" class="text-ink-400">
                    本次凭据：<code>{{ testResults[channel.id].key_masked || '无' }}</code>
                    　池内可用 {{ testResults[channel.id].pool_available }}/{{ testResults[channel.id].pool_total }}
                    <span v-if="testResults[channel.id].pool_cooling">　冷却中 {{ testResults[channel.id].pool_cooling }}</span>
                    <span v-if="testResults[channel.id].pool_exhausted">　余额耗尽 {{ testResults[channel.id].pool_exhausted }}</span>
                  </p>
                  <p v-else-if="testResults[channel.id].key_source === 'single'" class="text-ink-400">
                    本次凭据：渠道单密钥 <code>{{ testResults[channel.id].key_masked || '未配置' }}</code>
                  </p>
                  <p v-if="testResults[channel.id].upstream_body" class="text-ink-400">
                    <span class="font-medium">上游返回：</span>
                    <code class="break-all">{{ testResults[channel.id].upstream_body }}</code>
                  </p>
                </div>
              </td>
            </tr>
          </template>
          </template>
        </tbody>
      </table>

      <Pagination
        v-if="total > 0"
        :page="page"
        :size="size"
        :total="total"
        :disabled="loading"
        @update:page="changePage"
        @update:size="changeSize"
      />
    </div>

    <!-- 新建 / 编辑抽屉 -->
    <Drawer
      :open="drawerOpen"
      :title="drawerTitle"
      subtitle="密钥仅用于上游鉴权，保存后接口只返回掩码。"
      @close="drawerOpen = false"
    >
      <div class="space-y-5">
        <div>
          <label class="label" for="channel-name">渠道名称 <span class="text-red-600">*</span></label>
          <input id="channel-name" v-model="form.name" class="input" type="text" placeholder="例如：OpenAI 官方" />
        </div>

        <!-- 接入类型：由后端目录下发，选中后才展开该类型的默认地址/鉴权/能力与额外参数 -->
        <div>
          <label class="label" for="channel-type-catalog">接入类型</label>
          <select
            id="channel-type-catalog"
            class="input"
            :value="selectedTypeKey"
            @change="applyChannelType(($event.target as HTMLSelectElement).value)"
          >
            <option value="">（不指定，按下方协议编号接入）</option>
            <optgroup
              v-for="group in groupedChannelTypes"
              :key="group.key"
              :label="group.label"
            >
              <option
                v-for="item in group.items"
                :key="item.key"
                :value="item.key"
                :disabled="!item.available"
              >
                {{ item.label }}{{ item.available ? '' : '（即将支持）' }}
              </option>
            </optgroup>
          </select>
          <p v-if="channelTypesError" class="field-error">{{ channelTypesError }}</p>
          <p v-else class="hint">
            选择上游类型后会自动填入默认地址，并展示该类上游的鉴权方式与所需参数。
            「即将支持」的类型暂不可选。
          </p>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <div>
            <label class="label" for="channel-type">协议编号（兼容字段）</label>
            <input
              id="channel-type"
              v-model.number="form.type"
              class="input tabular-nums"
              type="number"
              min="1"
              list="channel-type-options"
            />
            <datalist id="channel-type-options">
              <option value="1">OpenAI 兼容</option>
            </datalist>
            <p class="hint">提交给后端的 type 编号；当前版本仅支持 1（OpenAI 兼容协议）。</p>
          </div>

          <div>
            <label class="label" for="channel-group-new">服务分组（可多选）</label>
            <!--
              多分组编辑：每行一个分组，第一项是「主分组」。
              为什么不做成单选：同一上游常要同时服务免费用户与付费用户，
              只能选一个分组时，拿着另一个分组的令牌调用会因"没有候选渠道"直接 503。
            -->
            <div class="space-y-1.5">
              <div v-for="(name, index) in form.groups" :key="index" class="flex flex-wrap items-center gap-2">
                <span class="chip" :class="index === 0 ? 'border-brand-500/50 text-brand-700' : ''">{{ name }}</span>
                <span v-if="index === 0" class="text-[11px] text-ink-500">主分组（用于展示与统计）</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="form.groups.length <= 1"
                  :title="form.groups.length <= 1 ? '至少保留一个分组' : '移除该分组'"
                  @click="removeGroup(index)"
                >
                  <AppIcon name="close" :size="13" />
                </button>
              </div>
            </div>

            <div class="mt-2 flex flex-wrap gap-2">
              <input
                id="channel-group-new"
                v-model="newGroupName"
                class="input input-mono max-w-[14rem]"
                type="text"
                list="channel-group-options"
                placeholder="选择已有分组或输入新分组名"
                @keydown.enter.prevent="addGroup(newGroupName)"
              />
              <!-- 下拉候选来自「模型分组」页：分组名写错会让渠道静默地从路由中消失，
                   因此优先让管理员从已有分组里选，而不是凭记忆手打。 -->
              <datalist id="channel-group-options">
                <option v-for="group in groupOptions" :key="group.name" :value="group.name">
                  {{ group.label }}（{{ (group.ratio / 100).toFixed(2) }}x）
                </option>
              </datalist>
              <button type="button" class="btn btn-secondary" @click="addGroup(newGroupName)">
                <AppIcon name="plus" :size="14" />
                添加分组
              </button>
            </div>
            <p class="hint">
              请求按<strong>令牌的分组</strong>匹配渠道：列在这里的分组都能路由到本渠道。
              倍率在「模型分组」页配置；不确定时保持 default。主分组仅影响展示与分组统计口径。
            </p>
          </div>
        </div>

        <!-- 选中类型的只读提示 + 该类型的额外参数（触发式渲染） -->
        <div v-if="selectedChannelType" class="rounded-lg border border-ink-800 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <p class="section-title">{{ selectedChannelType.label }}</p>
            <span v-if="selectedChannelType.available" class="badge badge-ok">可用</span>
            <span v-else class="badge badge-off">即将支持</span>
          </div>

          <p v-if="selectedChannelType.notes" class="hint mt-1">{{ selectedChannelType.notes }}</p>

          <div class="mt-3 flex flex-wrap items-center gap-1.5">
            <span class="text-xs text-ink-400">鉴权方式</span>
            <span class="chip">{{ selectedChannelType.auth_label }}</span>
            <template v-if="selectedChannelType.capabilities.length">
              <span class="text-xs text-ink-400">能力</span>
              <span
                v-for="cap in selectedChannelType.capabilities"
                :key="cap"
                class="badge badge-info"
              >
                {{ cap }}
              </span>
            </template>
          </div>

          <p v-if="!selectedChannelType.available" class="mt-3 text-xs text-amber-700">
            该类型适配器尚未实现，暂不可选用（保存会被拒绝）。
          </p>

          <!-- 额外参数：只属于少数类型（如部署名/api-version），因此按选中类型动态展开 -->
          <div v-if="selectedChannelType.extra_fields.length" class="mt-4 grid gap-4 sm:grid-cols-2">
            <div v-for="field in selectedChannelType.extra_fields" :key="field.key">
              <label class="label" :for="`ct-${field.key}`">
                {{ field.label }}
                <span v-if="field.required" class="text-red-600">*</span>
              </label>
              <input
                :id="`ct-${field.key}`"
                v-model="extraValues[field.key]"
                class="input input-mono"
                :type="field.secret ? 'password' : 'text'"
                autocomplete="new-password"
                :placeholder="field.placeholder || undefined"
              />
              <p v-if="field.help" class="hint">{{ field.help }}</p>
              <p v-if="field.secret" class="hint text-amber-700">
                敏感值请通过环境变量注入，避免写入代码库或日志。
              </p>
              <p v-else-if="field.default" class="hint">默认值：{{ field.default }}</p>
            </div>
          </div>

          <p class="hint mt-3">
            该类型的专用参数：当前版本后端仅保存通用渠道字段，这些参数会在对应适配器接入后随渠道保存。
          </p>
        </div>

        <div>
          <label class="label" for="channel-base-url">Base URL <span class="text-red-600">*</span></label>
          <div class="flex gap-2">
            <input
              id="channel-base-url"
              v-model="form.base_url"
              class="input input-mono flex-1"
              type="url"
              :placeholder="selectedChannelType?.default_base_url || 'https://api.openai.com'"
            />
            <!-- 选中类型后给出默认地址的一键填充，减少手抄端点出错 -->
            <button
              v-if="selectedChannelType?.default_base_url"
              type="button"
              class="btn btn-secondary shrink-0"
              title="填入该类型的默认上游地址"
              @click="fillDefaultBaseURL"
            >
              <AppIcon name="check" :size="15" />
              填入默认地址
            </button>
          </div>
          <p class="hint">
            只填到域名根：如 <code>https://integrate.api.nvidia.com</code>、<code>https://api.openai.com</code>。
            <strong>不要</strong>带 <code>/v1</code> 或 <code>/chat/completions</code>——
            版本前缀与端点路径由系统自动拼接（填多了会拼出 /v1/v1 而返回 404）。
          </p>
        </div>

        <div>
          <label class="label" for="channel-key">
            上游密钥
            <span v-if="!editing" class="text-red-600">*</span>
          </label>
          <input
            id="channel-key"
            v-model="form.api_key"
            class="input input-mono"
            type="password"
            autocomplete="new-password"
            :placeholder="editing ? '留空表示不修改现有密钥' : 'sk-...'"
          />
          <p class="hint">
            <template v-if="editing">
              当前密钥：<code class="chip">{{ editing.masked_key || '未配置' }}</code>。为避免误改，留空即保持原密钥不变。
            </template>
            <template v-else>单个密钥。需要多把密钥轮询时用下面的「批量密钥」。</template>
          </p>
        </div>

        <!-- 批量密钥池：支持一次粘贴几百把密钥并轮询使用 -->
        <div>
          <label class="label" for="channel-keys">批量密钥（密钥池）</label>
          <textarea
            id="channel-keys"
            v-model="form.keysText"
            class="input input-mono h-32 resize-y"
            placeholder="每行一把密钥，可粘贴数百行。&#10;例：&#10;nvapi-xxxxxxxxxxxx&#10;nvapi-yyyyyyyyyyyy 备注文字"
          />
          <p class="hint">
            每行一把，行内可用空格或逗号附加备注；以 <code>#</code> 开头的行会被忽略。
            填了本项即启用池化轮询：请求会在池内轮换，某把失效会被自动摘除并换下一把。
            <span v-if="editing" class="text-amber-700">编辑时留空表示不修改现有密钥池。</span>
          </p>

          <!-- 余额标记写法说明：上游密钥池“每把余额不同”时按段粘贴 -->
          <div class="mt-2 rounded-lg border border-ink-800 bg-ink-950/60 p-2.5 text-xs text-ink-400">
            <p class="mb-1.5">
              若每把密钥余额不同，可先写一行「余额标记」再写该余额下的密钥；同一标记下的密钥共用该余额：
            </p>
            <pre class="input input-mono overflow-x-auto whitespace-pre leading-relaxed">49余额
sk-xxxxxxxxxxxx
62余额
sk-yyyyyyyyyyyy</pre>
            <p class="mt-1.5">
              余额标记支持 <code>49余额</code> / <code>余额 49</code> / <code>余额: 49</code> 三种写法；
              <strong>不写余额标记则为"未录入"</strong>（不限制调度）。余额耗尽的密钥会自动退出调度，补录后自动恢复。
            </p>
          </div>
          <p v-if="editing && editing.key_pool && editing.key_pool.total > 0" class="mt-1 text-xs text-ink-300">
            当前池：
            共 {{ editing.key_pool.total }} 把 ·
            可用 {{ editing.key_pool.enabled }} ·
            已禁用 {{ editing.key_pool.disabled }} ·
            已摘除 {{ editing.key_pool.auto_removed }}
            <button type="button" class="ml-1 text-brand-700 underline hover:text-brand-800" @click="openKeys(editing)">
              查看明细
            </button>
          </p>
        </div>

        <!-- 订阅账号（ChatGPT/Codex 等）：与 API Key 分开导入。
             两类凭据的增删互不影响，因此"补一批账号"不会动到密钥池。 -->
        <div>
          <label class="label" for="channel-oauth-tokens">订阅账号（OAuth 凭据）</label>
          <textarea
            id="channel-oauth-tokens"
            v-model="form.oauthTokensText"
            class="input input-mono h-32 resize-y"
            placeholder="直接粘贴 Codex 的 auth.json 即可（也支持 JSON 数组 / 每行一个 JSON）。&#10;或每行一条 refresh_token 备注文字"
          />
          <p class="hint">
            适用于 <strong>ChatGPT / Codex 订阅账号</strong>这类需要 OAuth 的渠道：
            粘贴官方 CLI 导出的 <code>auth.json</code> 就会自动识别 access_token / refresh_token / 账号标识与套餐，
            过期时由网关自动续期——你不需要知道 token 端点或客户端 ID。
            以 <code>#</code> 开头的行会被忽略。
            <span v-if="editing" class="text-amber-700">编辑时留空表示不修改已有订阅账号。</span>
          </p>
        </div>

        <!-- ── 模型与模型 ID 映射（两块）────────────────────────────
             把两个名字的职责直接写在界面上，避免"到底哪个名字会发给上游"这类误解：
               平台模型 ID（对外）= 用户 / SDK 调用时使用的名字，也是模型广场展示的名字；
               上游模型 ID      = 网关转发时【真正发给上游】的名字。
        -->
        <div class="rounded-lg border border-ink-800 bg-ink-950/40 p-3.5">
          <label class="label" for="channel-models">平台模型 ID（对外）</label>
          <div class="flex gap-2">
            <input
              id="channel-models"
              v-model="form.modelText"
              class="input input-mono flex-1"
              type="text"
              placeholder="留空表示支持全部模型"
            />
            <button type="button" class="btn btn-secondary shrink-0" :disabled="fetchingModels" @click="pullModels">
              <span
                v-if="fetchingModels"
                class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-500/40 border-t-ink-500"
                aria-hidden="true"
              />
              <AppIcon v-else name="refresh" :size="15" />
              {{ fetchingModels ? '拉取中…' : '从上游拉取' }}
            </button>
          </div>

          <p class="hint">
            这里是<strong>用户 / 客户端调用时使用的名字</strong>，也是模型广场与
            <code>/v1/models</code> 里展示的名字。留空表示该渠道支持全部模型；多个用英文逗号分隔。
          </p>

          <p v-if="upstreamError" class="field-error">{{ upstreamError }}</p>

          <!-- 上游模型勾选清单：把真实模型名一键勾进来，避免手抄出错 -->
          <div v-if="upstreamModels.length" class="mt-2 rounded-lg border border-ink-800 bg-ink-950/60 p-2.5">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs text-ink-400">
                上游共 {{ upstreamModels.length }} 个模型；点击即按<strong>同名</strong>加入平台模型 ID（不改变发给上游的名字）
              </span>
              <span class="flex gap-2">
                <button type="button" class="text-xs text-brand-700 hover:text-brand-800" @click="selectAllModels">
                  全选
                </button>
                <button type="button" class="text-xs text-ink-400 hover:text-ink-200" @click="clearModels">
                  清空
                </button>
              </span>
            </div>
            <div class="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
              <button
                v-for="model in upstreamModels"
                :key="model"
                type="button"
                class="chip transition"
                :class="selectedModelSet.has(model) ? 'border-brand-500/50 text-brand-700' : 'hover:border-brand-500/40'"
                @click="toggleModel(model)"
              >
                {{ model }}
              </button>
            </div>
          </div>

          <!-- 未拉取上游时的快捷补全：用站点已有模型 -->
          <div v-else-if="site.models.length" class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="model in site.models.slice(0, 8)"
              :key="model"
              type="button"
              class="chip transition hover:border-brand-500/40 hover:text-brand-700"
              @click="toggleModel(model)"
            >
              {{ model }}
            </button>
          </div>
        </div>

        <!-- ── 模型 ID 映射 ─────────────────────────────────────── -->
        <div class="rounded-lg border border-ink-800 bg-ink-950/40 p-3.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="label mb-0">模型 ID 映射（可选）</label>
            <button type="button" class="btn btn-ghost btn-sm" @click="addMappingRow">
              <AppIcon name="plus" :size="14" />
              添加一行
            </button>
          </div>

          <p class="hint">
            网关转发时把左边的<strong>平台模型 ID</strong>换成右边的<strong>上游模型 ID</strong>再发给上游；
            上游回包里的模型名也会改回平台名。例：用户调用 <code>vendor/model-a</code>，
            上游实际收到 <code>model-a</code>。
            <strong>不配映射时两个名字相同（原样透传）</strong>，与没有本功能时完全一致。
          </p>

          <!-- 批量生成：上游模型多的时候逐个手填不现实 -->
          <div class="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-ink-800 bg-ink-950/60 p-2.5">
            <div>
              <label class="label" for="mapping-prefix">平台前缀（批量生成用）</label>
              <input
                id="mapping-prefix"
                v-model="mappingPrefix"
                class="input input-mono w-40"
                type="text"
                placeholder="如 AQUA/"
              />
            </div>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="!upstreamModels.length"
              @click="generateMappingsFromUpstream"
            >
              用上游清单生成映射（{{ upstreamModels.length }}）
            </button>
            <span class="pb-2 text-xs text-ink-400">
              生成规则：<code>前缀 + 上游模型名</code> 作为平台模型 ID。前缀留空则同名映射（等于不映射）。
            </span>
          </div>

          <p v-if="mappingError" class="field-error">{{ mappingError }}</p>

          <p v-if="mappingLoading" class="mt-2 text-xs text-ink-400">正在读取已保存的映射…</p>

          <!-- 映射表：左右两列就是"用户用的名字"与"发给上游的名字" -->
          <div v-else-if="mappingRows.length" class="mt-2 overflow-x-auto">
            <table class="w-full min-w-[34rem] text-sm">
              <thead>
                <tr class="text-left text-xs text-ink-400">
                  <th class="py-1.5 font-medium">平台模型 ID（用户调用这个）</th>
                  <th class="w-6 py-1.5" />
                  <th class="py-1.5 font-medium">上游模型 ID（实际发给上游）</th>
                  <th class="w-16 py-1.5 font-medium">启用</th>
                  <th class="w-10 py-1.5" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in mappingRows" :key="index">
                  <td class="py-1 pe-2">
                    <input v-model="row.publicModel" class="input input-mono" type="text" placeholder="如 vendor/model-a" />
                  </td>
                  <td class="py-1 text-center text-ink-500">→</td>
                  <td class="py-1">
                    <input
                      v-model="row.upstreamModel"
                      class="input input-mono"
                      type="text"
                      list="upstream-model-options"
                      placeholder="如 model-a"
                    />
                  </td>
                  <td class="py-1 text-center">
                    <input v-model="row.enabled" type="checkbox" class="h-4 w-4 align-middle" />
                  </td>
                  <td class="py-1 text-right">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      :title="`删除该映射`"
                      @click="removeMappingRow(index)"
                    >
                      <AppIcon name="trash" :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <datalist id="upstream-model-options">
              <option v-for="model in upstreamModels" :key="model" :value="model" />
            </datalist>
            <p v-if="form.modelText.trim()" class="mt-1.5 text-xs text-ink-400">
              保存时会自动把映射中的「平台模型 ID」并入上方声明清单，避免"配了映射却不生效"。
            </p>
          </div>

          <p v-else class="mt-2 text-xs text-ink-400">
            暂无映射。点「添加一行」手工配置，或先「从上游拉取」再用前缀一键生成。
          </p>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <div>
            <label class="label" for="channel-priority">优先级</label>
            <input id="channel-priority" v-model.number="form.priority" class="input tabular-nums" type="number" min="0" />
            <p class="hint">数值越大越优先被选中（路由会先用高优先级层）。</p>
          </div>

          <div>
            <label class="label" for="channel-weight">权重</label>
            <input id="channel-weight" v-model.number="form.weight" class="input tabular-nums" type="number" min="1" />
            <p class="hint">同优先级下按权重分配流量。</p>
          </div>
        </div>

        <!-- 凭据调度策略：决定密钥池里"挑哪一把"的规则 -->
        <div>
          <label class="label" for="channel-key-strategy">凭据调度策略</label>
          <select id="channel-key-strategy" v-model="form.key_strategy" class="input max-w-[20rem]">
            <option v-for="strategy in keyStrategies" :key="strategy.key" :value="strategy.key">
              {{ strategy.label }}
            </option>
          </select>
          <p v-if="selectedStrategyDesc" class="hint">{{ selectedStrategyDesc }}</p>
          <p v-else class="hint">决定该渠道的密钥池按什么规则选取凭据。</p>
        </div>

        <!-- 密钥失败处置策略：决定"密钥失败后是回池子，还是永久退出" -->
        <div class="rounded-lg border border-ink-800 bg-ink-950/40 p-3.5">
          <label class="label" for="channel-key-failure-policy">密钥失败后怎么办</label>
          <select
            id="channel-key-failure-policy"
            v-model="form.key_failure_policy"
            class="input max-w-[20rem]"
          >
            <option v-for="policy in failurePolicies?.items ?? []" :key="policy.key" :value="policy.key">
              {{ policy.label }}
            </option>
            <!-- 目录尚未加载时至少保证默认项可选中，避免下拉为空 -->
            <option v-if="!failurePolicies" value="cooldown_only">只冷却不摘除</option>
          </select>
          <p v-if="selectedFailurePolicyDesc" class="hint">{{ selectedFailurePolicyDesc }}</p>
          <p v-else class="hint">
            「只冷却不摘除」适合密钥不会失效的上游（如免费额度池）：失败后到期自动回池，
            避免好密钥被瞬时故障误杀导致可用密钥越来越少。
          </p>

          <div class="mt-3">
            <label class="label" for="channel-key-cooldown">冷却时长（秒）</label>
            <div class="flex flex-wrap items-center gap-2">
              <input
                id="channel-key-cooldown"
                v-model.number="form.keyCooldownSeconds"
                class="input input-mono w-40 tabular-nums"
                type="number"
                min="0"
                :max="maxCooldownSeconds"
              />
              <span class="text-xs text-ink-400">
                当前：{{ humanizeSeconds(form.keyCooldownSeconds) }}
              </span>
            </div>
            <p class="hint">
              留 <code>0</code> 使用系统内置的分级退避（限流 / 上游 5xx / 鉴权失败各有一档时长）；
              填正数则<strong>所有失败统一冷却该时长</strong>——即"进冷却池多久由你决定"。
              上限 {{ maxCooldownSeconds }} 秒：再长就等价于把密钥摘掉了，与"只冷却"的承诺相矛盾。
            </p>
            <p v-if="cooldownSecondsInvalid" class="field-error">
              冷却时长必须在 0 ~ {{ maxCooldownSeconds }} 秒之间。
            </p>
          </div>

          <p class="mt-2 text-xs leading-relaxed text-ink-400">
            说明：无论选哪种策略，<strong>手动禁用/下架</strong>始终有效，
            是让密钥退出调度的最终手段；被摘除的密钥也可在「密钥池明细」里手动恢复。
          </p>
        </div>

        <!-- 上游错误重试：决定"上游报错后要不要在站内再试一次" -->
        <div class="rounded-lg border border-ink-800 bg-ink-950/40 p-3.5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-[15rem] flex-1">
              <label class="label" for="channel-retry-enabled">上游错误重试</label>
              <p class="hint">
                开启后：上游报错时先在站内<strong>换密钥 / 换渠道</strong>重试，
                可恢复的失败不会直接丢给下游（这是降低下游错误率的主要手段）。
                关闭后：对上游<strong>只请求一次</strong>，失败即按本站定制错误码回给下游——
                适合"重复请求会重复扣费"的上游。
              </p>
            </div>
            <label class="flex cursor-pointer items-center gap-2 pt-6 text-sm text-ink-200">
              <input id="channel-retry-enabled" v-model="form.retryEnabled" class="checkbox" type="checkbox" />
              {{ form.retryEnabled ? '已开启' : '已关闭' }}
            </label>
          </div>

          <div class="mt-3">
            <label class="label" for="channel-retry-attempts">重试次数（含首次尝试）</label>
            <input
              id="channel-retry-attempts"
              v-model.number="form.retryMaxAttempts"
              class="input input-mono w-40 tabular-nums"
              type="number"
              min="1"
              :max="MAX_RETRY_ATTEMPTS"
              :disabled="!form.retryEnabled"
            />
            <p class="hint">
              填 <code>3</code> 表示"本次请求最多尝试 3 个渠道"（首次 + 2 次重试）。
              同一渠道内<strong>换密钥</strong>重试的预算另计（上限 8 次）——
              它毫秒级返回、代价低，正是密钥池的价值所在。关闭上面的开关时此项不生效。
            </p>
          </div>

          <!-- 模型级覆盖：只给个别模型改次数，或单独关掉 -->
          <div class="mt-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-medium text-ink-300">
                模型级覆盖（不填则全部沿用上面的渠道配置）
              </span>
              <div class="flex gap-2">
                <button type="button" class="btn btn-ghost btn-sm" @click="fillRetryRulesFromModels">
                  <AppIcon name="plus" :size="14" />
                  用已选模型批量添加
                </button>
                <button type="button" class="btn btn-ghost btn-sm" @click="addRetryRule">
                  <AppIcon name="plus" :size="14" />
                  添加一行
                </button>
              </div>
            </div>

            <table v-if="retryRuleRows.length" class="mt-2 w-full text-xs">
              <thead>
                <tr class="text-left text-ink-500">
                  <th class="py-1.5 font-medium">平台模型 ID（支持尾部 * 通配）</th>
                  <th class="w-20 py-1.5 font-medium">重试</th>
                  <th class="w-28 py-1.5 font-medium">次数</th>
                  <th class="w-10 py-1.5" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in retryRuleRows" :key="index">
                  <td class="py-1 pe-2">
                    <input
                      v-model="row.model"
                      class="input input-mono"
                      type="text"
                      list="retry-rule-model-options"
                      placeholder="如 gpt-4o 或 gpt-4*"
                    />
                  </td>
                  <td class="py-1 text-center">
                    <input v-model="row.enabled" type="checkbox" class="h-4 w-4 align-middle" />
                  </td>
                  <td class="py-1">
                    <input
                      v-model.number="row.maxAttempts"
                      class="input input-mono tabular-nums"
                      type="number"
                      min="0"
                      :max="MAX_RETRY_ATTEMPTS"
                    />
                  </td>
                  <td class="py-1 text-right">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      title="删除该规则"
                      @click="removeRetryRule(index)"
                    >
                      <AppIcon name="trash" :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <datalist id="retry-rule-model-options">
              <option v-for="model in selectedModels" :key="model" :value="model" />
            </datalist>
            <p class="hint">
              命中规则的模型不再沿用渠道级配置；次数填 <code>0</code> 表示用默认次数。
              匹配顺序为「精确匹配 → 最长前缀」，例如 <code>gpt-4*</code> 覆盖同族模型。
            </p>
          </div>
        </div>

        <div>
          <label class="label" for="channel-status">状态</label>
          <select id="channel-status" v-model.number="form.status" class="input max-w-[12rem]">
            <option :value="STATUS_ENABLED">启用</option>
            <option :value="STATUS_DISABLED">停用</option>
          </select>
        </div>

        <p
          v-if="formError"
          class="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-800"
        >
          <AppIcon name="alert" :size="14" class="mt-0.5 shrink-0" />
          {{ formError }}
        </p>
      </div>

      <template #footer>
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="drawerOpen = false">取消</button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="saving || typeUnavailable"
          @click="submitForm"
        >
          <span
            v-if="saving"
            class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          <AppIcon v-else name="check" :size="16" />
          {{ saving ? '保存中…' : editing ? '保存修改' : '创建渠道' }}
        </button>
      </template>
    </Drawer>

    <!-- 密钥池明细抽屉 -->
    <Drawer
      :open="keysDrawerOpen"
      :title="`密钥池 · ${keysOfChannel?.name ?? ''}`"
      :subtitle="
        keysReveal
          ? '正在显示凭据原文，请勿录屏或截图；本次查看已记入操作审计。'
          : '默认只显示掩码；需要原文时点「显示明文」（会记入操作审计）。'
      "
      @close="keysDrawerOpen = false"
    >
      <DataState
        :loading="keysLoading"
        :error="keysError"
        :empty="!keysLoading && !keysError && channelKeys.length === 0"
        loading-text="正在读取密钥池…"
        empty-text="该渠道没有配置密钥池"
        empty-hint="在渠道表单的「批量密钥」里粘贴密钥即可启用池化轮询。"
        @retry="keysOfChannel && loadChannelKeys(keysOfChannel.id)"
      />

      <div v-if="!keysLoading && !keysError && channelKeys.length" class="space-y-3">
        <!-- 池内概览：把"持久状态"与"此刻是否真的可用"分开呈现。
             只看持久状态会得出"可用 500 把"的错觉，而其中可能一大半正在冷却。 -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
          <span>共 <strong class="text-ink-100">{{ channelKeys.length }}</strong> 把</span>
          <span class="text-emerald-700">启用 {{ keyStats.enabled }}</span>
          <span v-if="keyStats.cooling" class="text-amber-700">冷却中 {{ keyStats.cooling }}</span>
          <span v-if="keyStats.exhausted" class="text-amber-700">余额耗尽 {{ keyStats.exhausted }}</span>
          <span v-if="keyStats.disabled">已禁用 {{ keyStats.disabled }}</span>
          <span v-if="keyStats.removed" class="text-amber-700">已摘除 {{ keyStats.removed }}</span>
          <button type="button" class="btn btn-secondary btn-sm ms-auto" @click="toggleReveal">
            <AppIcon :name="keysReveal ? 'eye' : 'key'" :size="14" />
            {{ keysReveal ? '隐藏明文' : '显示明文' }}
          </button>
        </div>

        <p class="text-xs leading-relaxed text-ink-400">
          「可服务分组 / 可服务模型」留空表示<strong>不限</strong>（跟随渠道配置）；
          填了就只在这些范围内被选中——同一上游里"能调 A 模型的账号"与"能调 B 模型的账号"
          因此可以挂在同一个渠道下，各自分流。改完点右侧对勾保存。
        </p>

        <div class="table-wrap table-cards">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ keysReveal ? '密钥原文' : '密钥（掩码）' }}</th>
                <th>备注</th>
                <th>可用性</th>
                <th>余额</th>
                <th>套餐 / 额度</th>
                <th class="text-right">连续失败</th>
                <th class="text-right">权重</th>
                <th class="text-right">优先级</th>
                <th class="text-right">每分钟上限</th>
                <th>可服务分组</th>
                <th>可服务模型</th>
                <th class="text-right">在途</th>
                <th>冷却</th>
                <th>最近使用</th>
                <th class="cell-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="key in channelKeys" :key="key.id">
                <td data-label="密钥">
                  <!-- 明文只在管理员显式开启时展示；平时一律掩码 -->
                  <code v-if="keysReveal && key.secret" class="chip max-w-[22rem] truncate" :title="key.secret">
                    {{ key.secret }}
                  </code>
                  <code v-else class="chip">{{ key.masked_key }}</code>
                </td>
                <td class="cell-muted" data-label="备注">{{ key.label || '—' }}</td>
                <td data-label="可用性">
                  <!-- 综合可用性：启用但正在冷却 / 余额耗尽也如实反映，
                       这样"池里有 500 把却总失败"就有了解释 -->
                  <span
                    :class="keyUsabilityClass(key)"
                    :title="`持久状态：${key.status_text}${key.last_error ? '；最近错误：' + key.last_error : ''}`"
                  >
                    {{ keyUsabilityText(key) }}
                  </span>
                </td>

                <!-- 余额：可内联编辑，-1 表示未录入；耗尽的密钥会自动退出调度 -->
                <td data-label="余额">
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-1.5">
                      <input
                        v-model.number="keyDrafts[key.id].balance"
                        class="input w-24 px-2 py-1 text-right tabular-nums"
                        type="number"
                        title="-1 表示未录入；0 及以上为实际余额（0 视为已用尽）"
                      />
                      <button
                        type="button"
                        class="btn btn-row"
                        title="保存余额"
                        :disabled="savingBalanceId === key.id"
                        @click="saveKeyBalance(key)"
                      >
                        <span
                          v-if="savingBalanceId === key.id"
                          class="mx-auto block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400"
                        />
                        <AppIcon v-else name="check" :size="14" />
                      </button>
                    </div>
                    <span v-if="key.balance_exhausted" class="badge badge-err">余额已耗尽</span>
                    <span v-else-if="key.balance_unknown" class="text-xs text-ink-300">未录入</span>
                    <span v-else class="text-xs text-ink-400">余额 {{ key.balance }}</span>
                    <span class="text-xs text-ink-300">
                      {{ key.balance_updated_at ? '更新于 ' + formatDateTime(key.balance_updated_at) : '未录入' }}
                    </span>

                    <!-- 用量核算：把"余额"这个静态快照变成"还剩多少"。
                         口径：已用 = 按「上游计费」里录的进价估算的累计消耗；
                         剩余 = 余额 − 已用（可为负，代表按进价估算已用超）。 -->
                    <template v-if="usageView(key.id).known">
                      <span class="text-xs text-ink-300">
                        已用 <span class="font-mono">{{ usageView(key.id).used }}</span>
                        <template v-if="usageView(key.id).remaining !== ''">
                          · 剩余
                          <span
                            class="font-mono"
                            :class="usageView(key.id).overdue ? 'text-red-600' : 'text-ink-200'"
                          >
                            {{ usageView(key.id).remaining }}
                          </span>
                        </template>
                      </span>
                      <span
                        v-if="usageView(key.id).unpricedCount > 0"
                        class="text-xs text-amber-700"
                        title="这些模型没有录入上游进价，其消耗无法估算，因此未计入「已用」"
                      >
                        有 {{ usageView(key.id).unpricedCount }} 个模型未录上游进价，未计入消耗
                      </span>
                    </template>
                  </div>
                </td>

                <!-- 套餐 / 额度：只对订阅账号有意义（API Key 没有上游额度窗口）。
                     "未探测"与"已用 0%"必须区分显示——前者是没问过，后者是额度充足。 -->
                <td data-label="套餐 / 额度">
                  <div v-if="key.kind === 'oauth'" class="flex flex-col gap-1">
                    <div class="flex items-center gap-1.5">
                      <span :class="quotaClass(key)">{{ quotaText(key) }}</span>
                      <span v-if="key.plan_type" class="chip">{{ key.plan_type }}</span>
                      <button
                        type="button"
                        class="btn btn-row"
                        title="向上游查询该账号的额度窗口（已用满的账号会自动退出调度）"
                        :disabled="probingQuotaId === key.id"
                        @click="probeQuota(key)"
                      >
                        <span
                          v-if="probingQuotaId === key.id"
                          class="mx-auto block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400"
                        />
                        <AppIcon v-else name="refresh" :size="14" />
                      </button>
                    </div>
                    <span v-if="key.quota_exhausted && quotaResetText(key)" class="text-xs text-amber-700">
                      {{ quotaResetText(key) }}
                    </span>
                    <span v-else-if="key.quota_checked_at" class="text-xs text-ink-300">
                      查询于 {{ formatDateTime(key.quota_checked_at) }}
                    </span>
                    <!-- 账号标识缺失时上游会直接拒绝请求，提前提示比等 401 更好 -->
                    <span v-if="!key.account_id" class="text-xs text-amber-700">
                      缺少账号标识，请重新导入该账号
                    </span>
                  </div>
                  <span v-else class="text-ink-400">—</span>
                </td>

                <td class="cell-num" data-label="连续失败">{{ key.fail_count }}</td>

                <!-- 调度参数：可直接内联编辑，改完点右侧「保存调度参数」 -->
                <td data-label="权重">
                  <input
                    v-model.number="keyDrafts[key.id].weight"
                    class="input w-20 px-2 py-1 text-right tabular-nums"
                    type="number"
                    min="0"
                  />
                </td>
                <td data-label="优先级">
                  <input
                    v-model.number="keyDrafts[key.id].priority"
                    class="input w-20 px-2 py-1 text-right tabular-nums"
                    type="number"
                    min="0"
                  />
                </td>
                <td data-label="每分钟上限">
                  <input
                    v-model.number="keyDrafts[key.id].rpm_limit"
                    class="input w-24 px-2 py-1 text-right tabular-nums"
                    type="number"
                    min="0"
                    title="0 表示不限速"
                  />
                </td>

                <!--
                  路由分叉（迁移 0038）：这把凭据服务哪些分组与模型。
                  留空 = 不限（继承渠道级路由），因此不填不会改变任何既有行为。
                -->
                <td data-label="可服务分组">
                  <input
                    v-model="keyDrafts[key.id].groupsText"
                    class="input input-mono w-40 px-2 py-1"
                    type="text"
                    placeholder="不限"
                    title="留空 = 不限分组；多个分组用逗号分隔"
                  />
                </td>
                <td data-label="可服务模型">
                  <input
                    v-model="keyDrafts[key.id].modelsText"
                    class="input input-mono w-44 px-2 py-1"
                    type="text"
                    placeholder="不限"
                    title="留空 = 不限模型；支持尾部通配符 *（如 gpt-4*），多个用逗号分隔"
                  />
                </td>

                <!-- 运行态：只读展示，供判断当前是否可用 -->
                <td class="cell-num" data-label="在途">{{ key.in_flight }}</td>
                <td class="cell-muted whitespace-nowrap" data-label="冷却" :title="key.last_error || undefined">
                  {{ cooldownText(key) }}
                </td>

                <td class="cell-muted" data-label="最近使用">
                  {{ key.last_used_at ? formatDateTime(key.last_used_at) : '未使用' }}
                </td>
                <td class="cell-actions" data-label="操作">
                  <button
                    type="button"
                    class="btn btn-row"
                    title="保存该凭据的调度参数与可服务范围"
                    :disabled="savingKeyId === key.id"
                    @click="saveKeyScheduling(key)"
                  >
                    <span
                      v-if="savingKeyId === key.id"
                      class="mx-auto block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400"
                    />
                    <AppIcon v-else name="check" :size="14" />
                  </button>
                  <button
                    v-if="key.status !== KEY_STATUS_ENABLED"
                    type="button"
                    class="btn btn-row"
                    title="启用 / 恢复该密钥"
                    :disabled="keyBusyId === key.id"
                    @click="setKeyStatus(key, KEY_STATUS_ENABLED)"
                  >
                    <AppIcon name="bolt" :size="14" />
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn btn-row"
                    title="禁用该密钥"
                    :disabled="keyBusyId === key.id"
                    @click="setKeyStatus(key, KEY_STATUS_DISABLED)"
                  >
                    <AppIcon name="lock" :size="14" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>

    <!-- 上游计费抽屉：录入「上游每个模型怎么收我的钱」 -->
    <Drawer
      :open="costDrawerOpen"
      :title="`上游计费 · ${costOfChannel?.name ?? ''}`"
      subtitle="口径与售价一致（每 100 万 token 的额度），所以毛利 = 售价 − 进价；密钥池的「已用 / 剩余」也按这里的进价估算。"
      @close="costDrawerOpen = false"
    >
      <div class="space-y-4">
        <p class="text-xs leading-relaxed text-ink-400">
          按<strong>上游模型名</strong>录入（不是对外模型名：钱是上游按上游名收的），支持前缀通配如
          <code class="chip">qwen-*</code>。
          <strong>四个价格都填 0 表示「上游免费」</strong>——这是一个明确结论；
          若某个模型在这里没有规则，它与"免费"不同：消耗无法估算，密钥池会提示你补录。
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="costLoading || !costOfChannel"
            @click="costOfChannel && loadCosts(costOfChannel.id)"
          >
            <AppIcon name="refresh" :size="14" />
            刷新
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="declaredModels.length === 0"
            :title="declaredModels.length ? '按渠道声明的模型补入空行，避免手敲模型名出错' : '该渠道未声明模型'"
            @click="fillDeclaredModels"
          >
            <AppIcon name="layers" :size="14" />
            补入渠道模型（{{ declaredModels.length }}）
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="addCostRow">
            <AppIcon name="plus" :size="14" />
            添加一行
          </button>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>上游模型名</th>
                <th class="text-right">输入 / 1M</th>
                <th class="text-right">缓存 / 1M</th>
                <th class="text-right">输出 / 1M</th>
                <th class="text-right">每次</th>
                <th>备注</th>
                <th class="cell-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <DataState
                :loading="costLoading"
                :error="costError"
                :empty="!costLoading && !costError && costRows.length === 0"
                :colspan="7"
                loading-text="正在读取上游进价…"
                empty-text="还没有录入任何上游进价"
                empty-hint="可以点「补入渠道模型」按渠道声明的模型批量生成空行，再逐个填价格。"
                @retry="costOfChannel && loadCosts(costOfChannel.id)"
              />

              <tr v-for="(row, index) in costRows" :key="index">
                <td data-label="上游模型名">
                  <input
                    v-model="row.model"
                    class="input input-mono w-full min-w-[10rem]"
                    type="text"
                    placeholder="如 qwen-long 或 qwen-*"
                  />
                </td>
                <td data-label="输入 / 1M">
                  <input
                    v-model="row.promptPrice"
                    class="input w-24 text-right tabular-nums"
                    type="number"
                    min="0"
                  />
                </td>
                <td data-label="缓存 / 1M">
                  <input
                    v-model="row.cachePrice"
                    class="input w-24 text-right tabular-nums"
                    type="number"
                    min="0"
                    title="命中缓存的输入单价；0 表示按输入价计"
                  />
                </td>
                <td data-label="输出 / 1M">
                  <input
                    v-model="row.completionPrice"
                    class="input w-24 text-right tabular-nums"
                    type="number"
                    min="0"
                  />
                </td>
                <td data-label="每次">
                  <input
                    v-model="row.perCallPrice"
                    class="input w-24 text-right tabular-nums"
                    type="number"
                    min="0"
                    title="按次计费的上游（图像/视频）用这一列"
                  />
                </td>
                <td data-label="备注">
                  <input
                    v-model="row.remark"
                    class="input w-full min-w-[8rem]"
                    type="text"
                    placeholder="定价依据（可选）"
                  />
                </td>
                <td class="cell-actions" data-label="操作">
                  <button type="button" class="btn btn-row" title="删除该行" @click="removeCostRow(index)">
                    <AppIcon name="trash" :size="14" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="hint">
          保存采用<strong>整体替换</strong>：表里没有的模型会被删除（保存空表 = 清空该渠道全部进价）。
          进价只用于核算与展示，<strong>不会自动改动密钥余额</strong>——网关无法得知上游真实扣费，
          自动写回只会产生对不上账的数字。
        </p>
      </div>

      <template #footer>
        <button type="button" class="btn btn-secondary" :disabled="costSaving" @click="costDrawerOpen = false">
          关闭
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="costSaving || costLoading"
          @click="submitCosts"
        >
          <span
            v-if="costSaving"
            class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          <AppIcon v-else name="check" :size="16" />
          {{ costSaving ? '保存中…' : '保存进价' }}
        </button>
      </template>
    </Drawer>
  </div>
</template>
