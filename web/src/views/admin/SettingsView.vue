<script setup lang="ts">
/**
 * 管理后台 · 系统设置。
 *
 * 意图（Why）：
 *   站点名称、注册开关、注册是否必须邮箱验证码等运营参数必须由管理员在界面上
 *   调整，而不是改配置文件或重启服务。
 *
 *   本页最关键的设计是「注册开关」与「邮箱验证码校验」的联动提示：
 *   若邮件通道未就绪（SMTP 未配置），开启验证码校验会导致所有用户注册失败，
 *   因此这里会把状态直接展示出来，并在保存时给出明确阻拦。
 *
 * 流转（Flow）：
 *   进入页面 → fetchSettings() 读取 → 表单双向绑定
 *   → 「保存」→ updateSettings(仅变更字段) → toast 反馈 → 重新拉取（校正只读字段）
 *
 * 扩展（Extend）：
 *   新增通用设置项：在 types.ts 的 SiteSettings / UpdateSiteSettingsPayload 加字段，
 *   本页加表单项，后端 LoadSiteSettings / ToMap 同步补映射（三处必须同步）。
 *   SEO 区块（site_url / keywords / 收录码 / geo / sitemap）同样遵循该三处同步约定：
 *   列表字段在界面上用逗号分隔字符串承载，提交时拆成数组、读入时再拼回。
 *   支付通道不在此硬编码：通道与字段由后端 payment_channels 下发，
 *   本页只按 field.kind 触发式渲染（勾选哪个通道才展开它的字段），
 *   因此后端新增支付通道时本页无需改动。
 */
import { computed, onMounted, ref } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import CopyButton from '@/components/CopyButton.vue'
import DataState from '@/components/DataState.vue'
import { fetchSMTP, fetchSettings, testSMTP, updateSMTP, updateSettings } from '@/api/admin'
import { ApiError } from '@/api/client'
import type {
  PaymentChannel,
  SeoSettings,
  SiteSettings,
  SMTPSettings,
  UpdateSeoSettingsPayload,
  UpdateSiteSettingsPayload,
} from '@/api/types'
import { toastError, toastSuccess } from '@/composables/useToast'
import { useSiteStore } from '@/stores/site'

const site = useSiteStore()

const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const settings = ref<SiteSettings | null>(null)

/* 表单字段（与 settings 分离：便于「取消修改」时一键还原） */
const siteName = ref('')
const siteDescription = ref('')
const registrationEnabled = ref(false)
const requireEmailCode = ref(false)
const defaultUserQuota = ref(0)
const defaultGroup = ref('')

/* 充值 / 支付的「通用项」。
   金额与汇率一律用"分"或整数承载：金额用分、汇率用"1 元可兑换的额度"，
   避免浮点在各处来回换算（这是支付类系统最经典的资损来源）。
   通道各自的参数不在这里硬编码 —— 见下方 paymentChannels。 */
const paymentEnabled = ref(false)
const paymentExchangeRate = ref(100)
const paymentCurrency = ref('CNY')
const paymentMinYuan = ref(1)
const paymentMaxYuan = ref(0)
const paymentOrderTTL = ref(30)
const paymentNotifyBase = ref('')

/**
 * 支付通道清单：完全由后端下发（字段描述 + 当前值 + 密钥就绪状态）。
 *
 * 为什么不在前端硬编码：通道与字段是"该支付方式需要什么"的知识，只有后端知道；
 * 放前端会出现"后端加了字段、前端忘了加输入框"的静默漏配。
 * 前端只负责按 kind 触发式渲染（勾选哪个通道才展开它的字段）。
 */
const paymentChannels = ref<PaymentChannel[]>([])
/** 通道勾选态：channel.key -> 是否启用 */
const checkedChannels = ref<Record<string, boolean>>({})
/**
 * setting 字段的本地值：setting_key -> value。
 *
 * 键形如 "epay.gateway"，本身已含通道前缀，因此可全局唯一，无需按通道嵌套；
 * 提交时原样组装成 payment.params 交给后端。
 */
const paymentParams = ref<Record<string, string>>({})

/* SEO 与站点收录。
   keywords 与 sitemap_paths 在接口里是 string[]，但界面上用「逗号分隔的单行输入」承载：
   对站长而言一次改完、一眼看全比逐个增删标签更省事，转换只在本组件内完成。
   sitemap_url / robots_url 是后端算好的只读地址，仅用于展示与复制，绝不回传。 */
const seo = ref<SeoSettings | null>(null)
const seoSiteURL = ref('')
const seoKeywords = ref('')
const seoBing = ref('')
const seoGoogle = ref('')
const seoBaidu = ref('')
const seoGeoRegion = ref('')
const seoGeoPlacename = ref('')
const seoGeoPosition = ref('')
const seoSitemapEnabled = ref(false)
const seoSitemapPaths = ref('')

/** 逗号（兼容中英文）分隔字符串 → 去空数组；同时用于 keywords 与 sitemap_paths */
function splitList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/** site_url：留空合法（后端会按访问请求推导）；非空则必须是带域名的 http(s) 地址 */
const seoSiteURLInvalid = computed(() => {
  const raw = seoSiteURL.value.trim()
  if (!raw) return false
  try {
    const parsed = new URL(raw)
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:'
  } catch {
    return true
  }
})

/** sitemap_paths：每项必须以 / 开头，否则会与站点地址拼成非法 URL */
const seoSitemapPathsInvalid = computed(() =>
  splitList(seoSitemapPaths.value).some((path) => !path.startsWith('/')),
)

/** geo_position：留空合法；非空必须形如「纬度;经度」 */
const seoGeoPositionInvalid = computed(() => {
  const raw = seoGeoPosition.value.trim()
  if (!raw) return false
  return !/^-?\d+(\.\d+)?;\s*-?\d+(\.\d+)?$/.test(raw)
})

/** 前端先拦一道：避免明显不合法的值白跑一次请求（后端仍会做最终校验） */
const seoInvalid = computed(
  () => seoSiteURLInvalid.value || seoSitemapPathsInvalid.value || seoGeoPositionInvalid.value,
)

/** 与 seoInvalid 对应的可读错误文案（取第一条） */
const seoErrorText = computed(() => {
  if (seoSiteURLInvalid.value) return '站点公开访问地址必须是 http:// 或 https:// 开头的完整地址。'
  if (seoSitemapPathsInvalid.value) return '额外的公开路径每一项都必须以 / 开头。'
  if (seoGeoPositionInvalid.value) return '经纬度格式应为「纬度;经度」，如 22.5431;114.0579。'
  return ''
})

/** 只读：完整 sitemap / robots 地址（后端算好，未启用时为空，展示为「—」） */
const seoSitemapURL = computed(() => seo.value?.sitemap_url || '')
const seoRobotsURL = computed(() => seo.value?.robots_url || '')

/** 邮件通道是否就绪（只读，由服务端计算：后台配置或环境变量任一可用即为就绪） */
const emailReady = computed(() => settings.value?.email_service_ready === true)
const emailFrom = computed(() => settings.value?.email_from || '')

/** 兑换比例是否有效：启用充值但比例为 0 会让用户"付钱却不到账" */
const paymentRateInvalid = computed(() => paymentEnabled.value && Number(paymentExchangeRate.value) <= 0)

/** 站点对外基址：优先用管理员填写的回调基址，否则退回浏览器访问地址 */
const siteOrigin = computed(() => {
  const base = paymentNotifyBase.value.trim().replace(/\/+$/, '')
  return base || window.location.origin
})

/** 通道状态文案：即将支持 / 密钥未注入 / 可用 */
function channelStatusText(channel: PaymentChannel): string {
  if (!channel.available) return '即将支持'
  if (channel.missing_env.length > 0) return '密钥未注入'
  return '可用'
}

/** 通道状态配色：可用绿、未就绪黄、未实现灰 */
function channelStatusClass(channel: PaymentChannel): string {
  if (!channel.available) return 'badge badge-off'
  if (channel.missing_env.length > 0) return 'badge badge-warn'
  return 'badge badge-ok'
}

/** 拼出该通道的完整回调地址（配错它是"付了钱不到账"的最常见原因） */
function notifyURL(channel: PaymentChannel): string {
  return channel.notify_path ? `${siteOrigin.value}${channel.notify_path}` : ''
}

/** 通道是否被勾选 */
function isChannelChecked(channel: PaymentChannel): boolean {
  return checkedChannels.value[channel.key] === true
}

/** 勾选 / 取消勾选通道（未实现的通道不允许勾选） */
function toggleChannel(channel: PaymentChannel, checked: boolean): void {
  if (!channel.available) return
  checkedChannels.value[channel.key] = checked
}

/** switch 字段的当前状态（以字符串 "true"/"false" 存，与后端 params 的字符串值一致） */
function isSwitchOn(settingKey: string): boolean {
  return paymentParams.value[settingKey] === 'true'
}

/** 切换 switch 字段 */
function setSwitch(settingKey: string, on: boolean): void {
  paymentParams.value[settingKey] = on ? 'true' : 'false'
}

/**
 * 已勾选通道的配置问题清单。
 *
 * 提前拦截三类"开了也用不了"的配置，避免站长保存后才发现充值页下不了单：
 *   1) 勾选了尚未实现的通道；
 *   2) 密钥未注入（后端也会拒绝）；
 *   3) 必填的 setting 字段为空。
 */
const paymentChannelIssues = computed<string[]>(() => {
  const issues: string[] = []
  for (const channel of paymentChannels.value) {
    if (!isChannelChecked(channel)) continue
    if (!channel.available) {
      issues.push(`「${channel.label}」尚未开放`)
      continue
    }
    if (channel.missing_env.length > 0) {
      issues.push(`「${channel.label}」缺少环境变量 ${channel.missing_env.join('、')}`)
      continue
    }
    const missing = channel.fields
      .filter(
        (field) =>
          field.source === 'setting' &&
          field.required &&
          !(paymentParams.value[field.setting_key] ?? '').trim(),
      )
      .map((field) => field.label)
    if (missing.length > 0) issues.push(`「${channel.label}」还需要填写：${missing.join('、')}`)
  }
  return issues
})

/** 充值配置存在硬错误时禁用保存（避免保存出"能下单却付不了款"的站点） */
const paymentInvalid = computed(
  () => paymentRateInvalid.value || (paymentEnabled.value && paymentChannelIssues.value.length > 0),
)

/**
 * 危险组合：开启了邮箱验证码校验，但邮件通道未配置。
 * 此时任何保存动作都应被阻止，否则会立刻造成"全站无法注册"。
 */
const emailCodeUnavailable = computed(() => requireEmailCode.value && !emailReady.value)

/* ── 邮件通道（SMTP）配置 ──────────────────────────────────
 *
 * 为什么单独维护一套表单状态而不塞进 settings：
 *   SMTP 的读写规则与普通设置项完全不同——口令【只进不出】（后端永不回传），
 *   因此编辑时输入框必须是空的，靠"留空即沿用已保存的口令"来避免误清空。
 *   把它和通用设置混在一起，容易被"整体覆盖保存"的语义坑到。
 */
const smtp = ref<SMTPSettings | null>(null)
const smtpLoading = ref(false)
const smtpSaving = ref(false)
const smtpError = ref('')
const smtpHost = ref('')
const smtpPort = ref(465)
const smtpUsername = ref('')
const smtpFrom = ref('')
const smtpFromName = ref('')
const smtpEnabled = ref(false)
/** 口令输入框：始终以空开始，留空提交表示"沿用已保存的口令" */
const smtpPassword = ref('')
const smtpTestTo = ref('')
const smtpTesting = ref(false)

/** 后台配置是否已被保存过（用于提示"留空即沿用"） */
const smtpPasswordSet = computed(() => smtp.value?.password_set === true)
/** 后台配置是否正在生效（source=database）；否则实际用的是环境变量/默认值 */
const smtpUsingDatabase = computed(() => smtp.value?.source === 'database')

/** 生效来源的中文说明：让站长一眼知道"现在到底用的是哪一套参数" */
const smtpSourceText = computed(() => {
  switch (smtp.value?.source) {
    case 'database':
      return '当前生效：后台配置'
    case 'env':
      return '当前生效：环境变量 / 默认值'
    default:
      return '当前生效：未配置（无法发信）'
  }
})

async function loadSMTP(): Promise<void> {
  smtpLoading.value = true
  smtpError.value = ''
  try {
    const data = await fetchSMTP()
    smtp.value = data
    smtpHost.value = data.host || ''
    smtpPort.value = data.port || 465
    smtpUsername.value = data.username || ''
    smtpFrom.value = data.from || ''
    smtpFromName.value = data.from_name || ''
    smtpEnabled.value = data.enabled === true
    // 口令刻意留空：后端不回传口令，界面只能"重填"
    smtpPassword.value = ''
    smtpTestTo.value = data.from || ''
  } catch (err) {
    smtpError.value = err instanceof ApiError ? err.message : '邮件通道配置加载失败'
  } finally {
    smtpLoading.value = false
  }
}

/** 前端先拦一道明显错误，避免白跑一次请求（后端仍会做最终校验） */
function smtpFormError(): string {
  if (!smtpEnabled.value) return ''
  if (!smtpHost.value.trim()) return '请填写 SMTP 服务器地址'
  if (!Number.isInteger(Number(smtpPort.value)) || Number(smtpPort.value) < 1 || Number(smtpPort.value) > 65535) {
    return 'SMTP 端口必须在 1 ~ 65535 之间'
  }
  if (!smtpUsername.value.trim()) return '请填写 SMTP 登录账号'
  if (!smtpFrom.value.trim() || !smtpFrom.value.includes('@')) return '请填写正确的发件地址（需含 @）'
  if (!smtpPassword.value.trim() && !smtpPasswordSet.value) return '首次配置必须填写 SMTP 登录口令（授权码）'
  return ''
}

async function handleSaveSMTP(): Promise<void> {
  const invalid = smtpFormError()
  if (invalid) {
    toastError(invalid)
    return
  }
  smtpSaving.value = true
  smtpError.value = ''
  try {
    const data = await updateSMTP({
      host: smtpHost.value.trim(),
      port: Number(smtpPort.value) || 465,
      username: smtpUsername.value.trim(),
      from: smtpFrom.value.trim(),
      from_name: smtpFromName.value.trim(),
      enabled: smtpEnabled.value,
      // 留空 = 沿用已保存的口令（后端按此语义处理）
      password: smtpPassword.value.trim(),
    })
    smtp.value = data
    smtpPassword.value = ''
    toastSuccess(data.ready ? '邮件通道已保存并生效' : '邮件通道配置已保存')
    // 邮件通道可能从"未就绪"变成"就绪"，刷新总设置让上方状态徽标同步
    await load()
  } catch (err) {
    const message = err instanceof ApiError ? err.message : '保存失败，请稍后重试'
    smtpError.value = message
    toastError(message)
  } finally {
    smtpSaving.value = false
  }
}

async function handleTestSMTP(): Promise<void> {
  smtpTesting.value = true
  try {
    const to = smtpTestTo.value.trim()
    await testSMTP(to)
    toastSuccess(`测试邮件已发出，请检查 ${to || '发件地址'} 的收件箱`)
  } catch (err) {
    // 发信失败原因（认证失败/端口被拒…）正是站长最需要看到的信息，原样展示
    toastError(err instanceof ApiError ? err.message : '发送测试邮件失败')
  } finally {
    smtpTesting.value = false
  }
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const data = await fetchSettings()
    applyToForm(data)
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : '加载系统设置失败'
  } finally {
    loading.value = false
  }
}

/** 把服务端数据填充到表单 */
function applyToForm(data: SiteSettings): void {
  settings.value = data
  siteName.value = data.site_name
  siteDescription.value = data.site_description
  registrationEnabled.value = data.registration_enabled
  requireEmailCode.value = data.registration_require_email_code
  defaultUserQuota.value = data.default_user_quota
  defaultGroup.value = data.default_group

  // 支付通用参数：分 → 元的换算只在这一处发生（反向换算在 handleSave）
  const payment = data.payment
  paymentEnabled.value = payment?.enabled === true
  paymentExchangeRate.value = payment?.exchange_rate ?? 100
  paymentCurrency.value = payment?.currency || 'CNY'
  paymentMinYuan.value = (payment?.min_cents ?? 0) / 100
  paymentMaxYuan.value = (payment?.max_cents ?? 0) / 100
  paymentOrderTTL.value = payment?.order_ttl_minutes ?? 30
  paymentNotifyBase.value = payment?.notify_base || ''

  // 支付通道：把后端下发的字段描述与当前值复制到本地编辑态。
  // 勾选态以 methods 为准（后端用 methods 表达"启用了哪些通道"），
  // 未实现的通道强制不勾选，避免把"即将支持"的通道带进保存请求。
  const channels = data.payment_channels ?? []
  paymentChannels.value = channels
  const enabledMethods = new Set(Array.isArray(payment?.methods) ? payment.methods : [])
  const checks: Record<string, boolean> = {}
  const params: Record<string, string> = {}
  for (const channel of channels) {
    checks[channel.key] = channel.available && enabledMethods.has(channel.key)
    for (const field of channel.fields) {
      if (field.source === 'setting') params[field.setting_key] = field.value ?? ''
    }
  }
  checkedChannels.value = checks
  paymentParams.value = params

  // SEO 与站点收录：数组字段拼成逗号分隔字符串，方便在单行输入里一次改完。
  // seo 缺失时（后端未升级）保持空态，只读地址展示为「—」，不阻断其余设置。
  const seoData = data.seo
  if (seoData) {
    seo.value = seoData
    seoSiteURL.value = seoData.site_url || ''
    seoKeywords.value = (seoData.keywords ?? []).join(',')
    seoBing.value = seoData.bing_verification || ''
    seoGoogle.value = seoData.google_verification || ''
    seoBaidu.value = seoData.baidu_verification || ''
    seoGeoRegion.value = seoData.geo_region || ''
    seoGeoPlacename.value = seoData.geo_placename || ''
    seoGeoPosition.value = seoData.geo_position || ''
    seoSitemapEnabled.value = seoData.sitemap_enabled === true
    seoSitemapPaths.value = (seoData.sitemap_paths ?? []).join(',')
  }
}

/** 元 → 分：用四舍五入到整数，避免 0.1+0.2 类浮点误差 */
function yuanToCents(yuan: number): number {
  if (!Number.isFinite(yuan) || yuan < 0) return 0
  return Math.round(yuan * 100)
}

/**
 * 组装提交给后端的通道级参数。
 *
 * 键沿用后端下发的 setting_key（形如 "epay.gateway"），值做 trim；
 * 未勾选的通道其参数也一并保留，避免"临时取消勾选"把已配好的值清掉。
 */
function collectPaymentParams(): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(paymentParams.value)) {
    params[key] = (value ?? '').trim()
  }
  return params
}

/**
 * 组装 SEO 提交体。
 *
 * 只取可写字段：sitemap_url / robots_url 由后端按 site_url 计算，回传旧值会把新算结果覆盖掉。
 * 逗号分隔的字符串在这里拆成数组（trim + 去空），与接口的 string[] 对齐。
 */
function collectSeoPayload(): UpdateSeoSettingsPayload {
  return {
    site_url: seoSiteURL.value.trim(),
    keywords: splitList(seoKeywords.value),
    bing_verification: seoBing.value.trim(),
    google_verification: seoGoogle.value.trim(),
    baidu_verification: seoBaidu.value.trim(),
    geo_region: seoGeoRegion.value.trim(),
    geo_placename: seoGeoPlacename.value.trim(),
    geo_position: seoGeoPosition.value.trim(),
    sitemap_enabled: seoSitemapEnabled.value,
    sitemap_paths: splitList(seoSitemapPaths.value),
  }
}

async function handleSave(): Promise<void> {
  if (emailCodeUnavailable.value) {
    toastError('邮件服务未配置，无法开启邮箱验证码校验')
    return
  }
  if (paymentInvalid.value) {
    toastError(
      paymentRateInvalid.value
        ? '充值兑换比例必须大于 0'
        : paymentChannelIssues.value[0] || '支付通道配置不完整',
    )
    return
  }
  // SEO 校验先拦在前端：错误的值会被注入到全站页面，污染收录结果，必须尽早挡住
  if (seoInvalid.value) {
    toastError(seoErrorText.value)
    return
  }

  const payload: UpdateSiteSettingsPayload = {
    site_name: siteName.value.trim(),
    site_description: siteDescription.value.trim(),
    registration_enabled: registrationEnabled.value,
    registration_require_email_code: requireEmailCode.value,
    default_user_quota: Number(defaultUserQuota.value),
    default_group: defaultGroup.value.trim(),
    payment: {
      enabled: paymentEnabled.value,
      // 启用通道集合 = 被勾选（且已实现）的通道 key
      methods: paymentChannels.value.filter((channel) => isChannelChecked(channel)).map((channel) => channel.key),
      exchange_rate: Math.round(Number(paymentExchangeRate.value) || 0),
      currency: paymentCurrency.value.trim() || 'CNY',
      min_cents: yuanToCents(Number(paymentMinYuan.value)),
      max_cents: yuanToCents(Number(paymentMaxYuan.value)),
      order_ttl_minutes: Math.round(Number(paymentOrderTTL.value) || 0),
      notify_base: paymentNotifyBase.value.trim(),
      // 通道级参数：键为 setting_key，值是各输入框的当前内容（trim 后）
      params: collectPaymentParams(),
      // 旧版专用字段不再使用，显式置空，避免与新 params 混淆
      epay_gateway: '',
      epay_pid: '',
      epay_types: [],
      stripe_note: '',
    },
    // 只提交可写字段；只读的 sitemap_url / robots_url 不回传
    seo: collectSeoPayload(),
  }

  saving.value = true
  try {
    await updateSettings(payload)
    toastSuccess('系统设置已保存')
    // 重新拉取：邮箱通道等只读字段由服务端决定，避免前端展示与实际不一致
    await load()
    // 站点名称可能已变化，刷新全局站点信息（页脚/标题等立即生效）
    await site.load(true)
  } catch (error) {
    toastError(error instanceof ApiError ? error.message : '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
  // 邮件通道是独立资源（口令只进不出），因此单独拉取、单独保存
  void loadSMTP()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">系统设置</h1>
        <p class="page-desc">站点名称、注册策略与新用户默认额度。修改后立即生效，无需重启服务。</p>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="saving || loading || emailCodeUnavailable || paymentInvalid || seoInvalid"
        @click="handleSave"
      >
        <span
          v-if="saving"
          class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          aria-hidden="true"
        />
        <AppIcon v-else name="check" :size="16" />
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
    </div>

    <DataState
      v-if="loading || loadError"
      :loading="loading"
      :error="loadError"
      loading-text="正在读取系统设置…"
      @retry="load"
    />

    <div v-else class="grid gap-5 lg:grid-cols-3">
      <!-- 站点信息 -->
      <section class="card lg:col-span-2">
        <div class="card-head">
          <div>
            <h2 class="section-title">站点信息</h2>
            <p class="mt-0.5 text-xs text-ink-400">用于落地页、注册页与页面标题</p>
          </div>
        </div>
        <div class="card-pad space-y-4">
          <div>
            <label class="label" for="setting-site-name">站点名称</label>
            <input id="setting-site-name" v-model="siteName" class="input" type="text" placeholder="AQUA-API" />
          </div>
          <div>
            <label class="label" for="setting-site-desc">站点描述</label>
            <input
              id="setting-site-desc"
              v-model="siteDescription"
              class="input"
              type="text"
              placeholder="一句话说明本站定位"
            />
          </div>
        </div>
      </section>

      <!-- 注册策略 -->
      <section class="card">
        <div class="card-head">
          <h2 class="section-title">注册策略</h2>
        </div>
        <div class="card-pad space-y-4">
          <label class="flex cursor-pointer items-start gap-3">
            <input v-model="registrationEnabled" class="checkbox mt-0.5" type="checkbox" />
            <span>
              <span class="block text-sm text-ink-100">开放自助注册</span>
              <span class="mt-0.5 block text-xs leading-relaxed text-ink-400">
                关闭后注册页会提示"未开放"，只能由管理员在用户管理中创建账号。
              </span>
            </span>
          </label>

          <label class="flex cursor-pointer items-start gap-3 border-t border-ink-800 pt-4">
            <input v-model="requireEmailCode" class="checkbox mt-0.5" type="checkbox" :disabled="!registrationEnabled" />
            <span>
              <span class="block text-sm text-ink-100">注册必须邮箱验证码</span>
              <span class="mt-0.5 block text-xs leading-relaxed text-ink-400">
                用户需先获取邮箱验证码才能完成注册，可有效拦截脚本批量注册。
              </span>
            </span>
          </label>

          <!-- 邮件通道状态：这是"能不能开启验证码"的前置条件，必须显式展示 -->
          <div
            class="rounded-lg border px-3 py-2.5 text-xs leading-relaxed"
            :class="
              emailReady
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-700'
            "
          >
            <p class="flex items-center gap-1.5 font-medium">
              <AppIcon :name="emailReady ? 'check' : 'alert'" :size="14" />
              {{ emailReady ? '邮件通道已就绪' : '邮件通道未配置' }}
            </p>
            <p v-if="emailReady" class="mt-1">发件地址：{{ emailFrom }}</p>
            <p v-else class="mt-1">
              可在下方「邮件通道」里填写自己的 SMTP 参数（保存即生效），
              或用环境变量 AQUA_SMTP_USERNAME / AQUA_SMTP_FROM / AQUA_SMTP_PASSWORD 注入。
            </p>
          </div>
        </div>
      </section>

      <!-- ── 邮件通道（SMTP）─────────────────────────────────────
           为什么单独一张卡片：SMTP 是"每个站长都不一样"的参数（服务商、域名、授权码），
           必须能在后台改；口令只进不出，界面只能重填，因此不能和通用设置混在一起保存。 -->
      <section class="card lg:col-span-3">
        <div class="card-head">
          <div>
            <h2 class="section-title flex items-center gap-2">
              <AppIcon name="mail" :size="16" class="text-brand-700" />
              邮件通道
            </h2>
            <p class="mt-0.5 text-xs text-ink-400">
              用于发送注册验证码等通知邮件。请填写你自己的发信账号，本站不提供公共发信通道。
            </p>
          </div>
          <span
            class="badge"
            :class="smtp?.ready ? 'badge-ok' : 'badge-warn'"
          >
            {{ smtp?.ready ? '可用' : '未就绪' }}
          </span>
        </div>

        <div class="card-pad grid gap-4">
          <p class="text-xs text-ink-300">{{ smtpSourceText }}</p>

          <p v-if="smtpError" class="field-error">{{ smtpError }}</p>

          <label class="flex cursor-pointer items-start gap-3">
            <input v-model="smtpEnabled" class="checkbox mt-0.5" type="checkbox" />
            <span>
              <span class="block text-sm text-ink-100">启用这条后台配置</span>
              <span class="mt-0.5 block text-xs leading-relaxed text-ink-400">
                勾选并保存后，本站将使用下面填写的账号发信（优先于环境变量）；
                不勾选时回退环境变量，两者都没有则邮件功能不可用。
              </span>
            </span>
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="smtp-host">SMTP 服务器</label>
              <input id="smtp-host" v-model="smtpHost" class="input input-mono" type="text" placeholder="smtpdm.aliyun.com" />
              <p class="hint">服务商提供的 SMTP 地址，例如阿里云邮件推送为 smtpdm.aliyun.com。</p>
            </div>
            <div>
              <label class="label" for="smtp-port">端口</label>
              <input id="smtp-port" v-model.number="smtpPort" class="input input-mono tabular-nums" type="number" min="1" max="65535" />
              <p class="hint">465 = SSL 直连（推荐）；587 = STARTTLS；不建议 25（多数云厂商封禁出站）。</p>
            </div>
            <div>
              <label class="label" for="smtp-username">登录账号</label>
              <input id="smtp-username" v-model="smtpUsername" class="input input-mono" type="text" placeholder="noreply@your-domain.com" />
              <p class="hint">多数服务商要求登录账号与发件地址一致（阿里云邮件推送即为发信地址本身）。</p>
            </div>
            <div>
              <label class="label" for="smtp-password">登录口令 / 授权码</label>
              <input
                id="smtp-password"
                v-model="smtpPassword"
                class="input input-mono"
                type="password"
                autocomplete="new-password"
                :placeholder="smtpPasswordSet ? '已配置，留空表示不修改' : '请输入 SMTP 授权码'"
              />
              <p class="hint">
                为安全起见，服务端永不回传已保存的口令；<strong>留空保存即沿用原口令</strong>。
                口令以密文落库（用 AQUA_APP_KEY 加密），数据库备份流出也无法直接读取。
              </p>
            </div>
            <div>
              <label class="label" for="smtp-from">发件地址</label>
              <input id="smtp-from" v-model="smtpFrom" class="input input-mono" type="text" placeholder="noreply@your-domain.com" />
              <p class="hint">收件人看到的发件人地址，必须已在服务商处验证归属。</p>
            </div>
            <div>
              <label class="label" for="smtp-from-name">发件人显示名</label>
              <input id="smtp-from-name" v-model="smtpFromName" class="input" type="text" placeholder="AQUA-API" />
              <p class="hint">收件人看到的发件人名称，可留空（留空则直接显示发件地址）。</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 border-t border-ink-800 pt-4">
            <button type="button" class="btn btn-primary btn-sm" :disabled="smtpSaving" @click="handleSaveSMTP">
              <span
                v-if="smtpSaving"
                class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              <AppIcon v-else name="check" :size="14" />
              {{ smtpSaving ? '保存中…' : '保存邮件通道' }}
            </button>
            <span v-if="smtpUsingDatabase" class="text-xs text-emerald-700">已启用后台配置</span>
          </div>

          <!-- 测试发信：配完当场验证"到底能不能发出去"，是排查发信问题最快的手段 -->
          <div class="rounded-lg border border-ink-800 bg-ink-950/50 p-3">
            <p class="text-sm text-ink-100">发送测试邮件</p>
            <p class="mt-0.5 text-xs leading-relaxed text-ink-400">
              保存配置后点这里会立刻发一封测试邮件。常见失败原因（端口被封、授权码错、发件地址未验证）
              都会原样显示，便于自助排查。
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <input
                v-model="smtpTestTo"
                class="input input-mono max-w-[20rem]"
                type="text"
                placeholder="收件地址（留空则发给发件地址）"
              />
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="smtpTesting || !smtp?.ready"
                @click="handleTestSMTP"
              >
                <span
                  v-if="smtpTesting"
                  class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-500/40 border-t-ink-500"
                  aria-hidden="true"
                />
                <AppIcon v-else name="send" :size="14" />
                {{ smtpTesting ? '发送中…' : '发送测试邮件' }}
              </button>
              <span v-if="!smtp?.ready" class="text-xs text-amber-700">通道未就绪，先保存一份完整配置</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 新用户默认值 -->
      <section class="card lg:col-span-3">
        <div class="card-head">
          <div>
            <h2 class="section-title">新用户默认值</h2>
            <p class="mt-0.5 text-xs text-ink-400">仅对"之后注册"的账号生效，已有账号不受影响</p>
          </div>
        </div>
        <div class="card-pad grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="setting-quota">默认额度</label>
            <input id="setting-quota" v-model.number="defaultUserQuota" class="input input-mono" type="number" min="-1" />
            <p class="hint">-1 表示不限额度；0 表示注册后需管理员分配额度才可调用。</p>
          </div>
          <div>
            <label class="label" for="setting-group">默认分组</label>
            <input id="setting-group" v-model="defaultGroup" class="input input-mono" type="text" placeholder="default" />
            <p class="hint">用于渠道与令牌的分组匹配，通常保持默认即可。</p>
          </div>
        </div>
      </section>

      <!-- 充值 / 支付 -->
      <section class="card lg:col-span-3">
        <div class="card-head">
          <div>
            <h2 class="section-title flex items-center gap-2">
              <AppIcon name="wallet" :size="16" class="text-brand-700" />
              充值 / 支付
            </h2>
            <p class="mt-0.5 text-xs text-ink-400">
              这些参数保存在数据库、修改后立即生效；<strong>密钥只允许通过环境变量注入</strong>，不会落库。
            </p>
          </div>
          <label class="flex items-center gap-2 text-sm text-ink-200">
            <input v-model="paymentEnabled" class="checkbox" type="checkbox" />
            开放充值
          </label>
        </div>

        <div class="card-pad space-y-5">
          <!-- 兑换比例与限额：决定"付多少钱得到多少额度"，必须最醒目 -->
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label class="label" for="payment-rate">兑换比例（1 元 = ? 额度）</label>
              <input id="payment-rate" v-model.number="paymentExchangeRate" class="input input-mono" type="number" min="1" />
              <p class="hint" :class="paymentRateInvalid ? 'text-red-600' : ''">
                例：填 100 表示 1 元兑换 100 额度。
              </p>
            </div>
            <div>
              <label class="label" for="payment-currency">货币代码</label>
              <input id="payment-currency" v-model="paymentCurrency" class="input input-mono" type="text" placeholder="CNY" />
            </div>
            <div>
              <label class="label" for="payment-min">单笔最小金额（元）</label>
              <input id="payment-min" v-model.number="paymentMinYuan" class="input input-mono" type="number" min="0" step="0.01" />
            </div>
            <div>
              <label class="label" for="payment-max">单笔最大金额（元）</label>
              <input id="payment-max" v-model.number="paymentMaxYuan" class="input input-mono" type="number" min="0" step="0.01" />
              <p class="hint">填 0 表示不限上限。</p>
            </div>
          </div>

          <!-- 支付通道清单：字段由后端下发，勾选后才展开该通道的配置项 -->
          <div>
            <p class="label">支付通道</p>
            <p class="hint mb-2">
              勾选某个通道后，才会展开它需要的配置项。密钥类字段只显示注入状态，密钥本身不会下发到页面。
            </p>

            <div class="space-y-2">
              <div
                v-for="channel in paymentChannels"
                :key="channel.key"
                class="rounded-lg border transition-colors"
                :class="isChannelChecked(channel) ? 'border-brand-500/60 bg-brand-500/5' : 'border-ink-800'"
              >
                <label
                  class="flex items-start gap-3 px-3 py-2.5"
                  :class="channel.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
                >
                  <input
                    class="checkbox mt-0.5"
                    type="checkbox"
                    :checked="isChannelChecked(channel)"
                    :disabled="!channel.available"
                    @change="toggleChannel(channel, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-center gap-1.5 text-sm text-ink-100">
                      {{ channel.label }}
                      <span class="badge" :class="channelStatusClass(channel)">
                        {{ channelStatusText(channel) }}
                      </span>
                    </span>
                    <span class="mt-0.5 block text-xs leading-relaxed text-ink-400">
                      {{ channel.description }}
                    </span>

                    <!-- 回调地址：这一步配错是"付了钱不到账"最常见的原因，故直接给出可复制地址 -->
                    <span v-if="notifyURL(channel)" class="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span class="text-xs text-ink-400">回调地址</span>
                      <code class="chip max-w-full truncate" :title="notifyURL(channel)">{{ notifyURL(channel) }}</code>
                      <CopyButton :value="notifyURL(channel)" small outline success-text="回调地址已复制" />
                    </span>

                    <span v-if="channel.missing_env.length" class="mt-1 block text-xs text-amber-700">
                      启用前请注入环境变量：{{ channel.missing_env.join('、') }}
                    </span>
                  </span>
                </label>

                <!-- 触发式展开：仅当该通道被勾选且适配器已实现时才渲染 -->
                <div
                  v-if="isChannelChecked(channel) && channel.available"
                  class="border-t border-ink-800/60 px-3 py-3"
                >
                  <div class="grid gap-4 sm:grid-cols-2">
                    <div v-for="field in channel.fields" :key="field.setting_key || field.key">
                      <!-- 密钥字段：只读状态行，绝不渲染输入框（值不出服务端） -->
                      <template v-if="field.source === 'secret'">
                        <p class="label">
                          {{ field.label }}
                          <span v-if="field.required" class="text-red-600">*</span>
                        </p>
                        <p
                          class="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs"
                          :class="
                            field.ready
                              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                              : 'border-amber-500/25 bg-amber-500/10 text-amber-700'
                          "
                        >
                          <AppIcon :name="field.ready ? 'check' : 'alert'" :size="14" />
                          <span v-if="field.ready">已就绪</span>
                          <span v-else>
                            未注入，请设置环境变量 <code class="chip">{{ field.env_var }}</code>
                          </span>
                        </p>
                        <p v-if="field.help" class="hint">{{ field.help }}</p>
                      </template>

                      <!-- 可编辑字段：按 kind 渲染（text/number/list/select/switch） -->
                      <template v-else>
                        <label class="label" :for="`pf-${channel.key}-${field.key}`">
                          {{ field.label }}
                          <span v-if="field.required" class="text-red-600">*</span>
                        </label>

                        <select
                          v-if="field.kind === 'select'"
                          :id="`pf-${channel.key}-${field.key}`"
                          v-model="paymentParams[field.setting_key]"
                          class="input"
                        >
                          <option v-for="option in field.options || []" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>

                        <label
                          v-else-if="field.kind === 'switch'"
                          class="flex items-center gap-2 text-sm text-ink-200"
                        >
                          <input
                            class="checkbox"
                            type="checkbox"
                            :checked="isSwitchOn(field.setting_key)"
                            @change="setSwitch(field.setting_key, ($event.target as HTMLInputElement).checked)"
                          />
                          {{ isSwitchOn(field.setting_key) ? '已开启' : '已关闭' }}
                        </label>

                        <input
                          v-else
                          :id="`pf-${channel.key}-${field.key}`"
                          v-model="paymentParams[field.setting_key]"
                          class="input input-mono"
                          :type="field.kind === 'number' ? 'number' : 'text'"
                          :placeholder="field.placeholder || undefined"
                        />
                        <p v-if="field.help" class="hint">{{ field.help }}</p>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 订单与回调 -->
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label class="label" for="payment-ttl">订单有效期（分钟）</label>
              <input id="payment-ttl" v-model.number="paymentOrderTTL" class="input input-mono" type="number" min="1" />
              <p class="hint">超时未支付的订单会被自动关闭。</p>
            </div>
            <div class="sm:col-span-1 lg:col-span-3">
              <label class="label" for="payment-notify">回调基址（公网地址）</label>
              <input
                id="payment-notify"
                v-model="paymentNotifyBase"
                class="input input-mono"
                type="url"
                placeholder="https://api.example.com"
              />
              <p class="hint">
                支付平台必须能回调到本网关。留空时按浏览器访问地址推导；
                若本站经过反向代理或使用内网地址，请显式填写公网地址。
                各通道的完整回调地址见上方通道清单。
              </p>
            </div>
          </div>

          <p v-if="paymentInvalid" class="field-error">
            {{
              paymentRateInvalid
                ? '充值兑换比例必须大于 0，否则用户付钱后不会到账。'
                : paymentChannelIssues.join('；')
            }}
          </p>
        </div>
      </section>

      <!-- SEO 与站点收录 -->
      <section class="card lg:col-span-3">
        <div class="card-head">
          <div>
            <h2 class="section-title flex items-center gap-2">
              <AppIcon name="globe" :size="16" class="text-brand-700" />
              SEO 与站点收录
            </h2>
            <p class="mt-0.5 text-xs text-ink-400">
              这些值由后端注入到页面 &lt;head&gt;，并据此生成 sitemap.xml 与 robots.txt；保存后立即生效。
            </p>
          </div>
          <label class="flex items-center gap-2 text-sm text-ink-200">
            <input v-model="seoSitemapEnabled" class="checkbox" type="checkbox" />
            输出 sitemap.xml 与 robots.txt
          </label>
        </div>

        <div class="card-pad space-y-5">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div class="sm:col-span-2 lg:col-span-3">
              <label class="label" for="seo-site-url">站点公开访问地址</label>
              <input
                id="seo-site-url"
                v-model="seoSiteURL"
                class="input input-mono"
                type="url"
                placeholder="https://aqua.ltzy.top"
              />
              <p class="hint" :class="seoSiteURLInvalid ? 'text-red-600' : ''">
                sitemap、robots 与 canonical 都用它生成绝对地址。留空时按访问请求自动推导；
                但反向代理后推导出的往往是内网地址，不利于收录，建议显式填写。
              </p>
            </div>

            <div class="sm:col-span-2 lg:col-span-3">
              <label class="label" for="seo-keywords">SEO 关键词</label>
              <input
                id="seo-keywords"
                v-model="seoKeywords"
                class="input"
                type="text"
                placeholder="LLM API 网关,大模型中转,OpenAI 兼容"
              />
              <p class="hint">多个关键词用逗号分隔，会写入页面的 keywords 标记。</p>
            </div>

            <div>
              <label class="label" for="seo-bing">必应站长验证码（msvalidate.01）</label>
              <input id="seo-bing" v-model="seoBing" class="input input-mono" type="text" />
            </div>
            <div>
              <label class="label" for="seo-google">Google Search Console 验证码</label>
              <input id="seo-google" v-model="seoGoogle" class="input input-mono" type="text" />
            </div>
            <div>
              <label class="label" for="seo-baidu">百度站长验证码</label>
              <input id="seo-baidu" v-model="seoBaidu" class="input input-mono" type="text" />
            </div>

            <div>
              <label class="label" for="seo-geo-region">地域代码</label>
              <input id="seo-geo-region" v-model="seoGeoRegion" class="input input-mono" type="text" placeholder="CN-44" />
            </div>
            <div>
              <label class="label" for="seo-geo-placename">地名</label>
              <input id="seo-geo-placename" v-model="seoGeoPlacename" class="input input-mono" type="text" placeholder="Shenzhen" />
            </div>
            <div>
              <label class="label" for="seo-geo-position">经纬度</label>
              <input
                id="seo-geo-position"
                v-model="seoGeoPosition"
                class="input input-mono"
                type="text"
                placeholder="22.5431;114.0579"
              />
              <p class="hint" :class="seoGeoPositionInvalid ? 'text-red-600' : ''">
                格式为「纬度;经度」，如 22.5431;114.0579。
              </p>
            </div>

            <div class="sm:col-span-2 lg:col-span-3">
              <label class="label" for="seo-sitemap-paths">额外的公开路径</label>
              <input
                id="seo-sitemap-paths"
                v-model="seoSitemapPaths"
                class="input input-mono"
                type="text"
                placeholder="/, /models, /docs"
              />
              <p class="hint" :class="seoSitemapPathsInvalid ? 'text-red-600' : ''">
                以 / 开头、逗号分隔。只填公开页面：登录后才能看的页面写进来会被搜索引擎反复抓取，
                却永远只能拿到跳转或空页，反而产生大量无效索引。
              </p>
            </div>
          </div>

          <!-- 只读输出地址：站长提交给搜索引擎时直接复制，无需自己拼域名 -->
          <div class="rounded-lg border border-ink-800 px-3 py-3">
            <p class="label mb-2">输出地址（只读）</p>
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="w-24 shrink-0 text-xs text-ink-400">sitemap.xml</span>
                <code class="chip max-w-full truncate" :title="seoSitemapURL || ''">
                  {{ seoSitemapURL || '—' }}
                </code>
                <CopyButton
                  v-if="seoSitemapURL"
                  :value="seoSitemapURL"
                  small
                  outline
                  success-text="sitemap 地址已复制"
                />
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="w-24 shrink-0 text-xs text-ink-400">robots.txt</span>
                <code class="chip max-w-full truncate" :title="seoRobotsURL || ''">
                  {{ seoRobotsURL || '—' }}
                </code>
                <CopyButton
                  v-if="seoRobotsURL"
                  :value="seoRobotsURL"
                  small
                  outline
                  success-text="robots 地址已复制"
                />
              </div>
            </div>
            <p class="hint mt-2">未开启「输出 sitemap.xml 与 robots.txt」时这两项为空。</p>
          </div>

          <p v-if="seoInvalid" class="field-error">{{ seoErrorText }}</p>
        </div>
      </section>
    </div>
  </div>
</template>
