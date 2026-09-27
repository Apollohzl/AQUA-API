/**
 * 站点信息状态（Pinia）。
 *
 * 意图（Why）：
 *   站点名称/描述/是否开放注册/可用模型列表，被落地页、登录页、注册页、侧边栏多处使用；
 *   放在 store 里做一次性加载 + 全局共享，避免每个页面重复请求 /api/status。
 *
 * 流转（Flow）：
 *   main.ts → useSiteStore().load()（启动时预取）
 *   LandingView / RegisterView / AppShell → 读取 state
 *
 * 扩展（Extend）：
 *   后端新增站点级开关（如「是否允许注册」之外的 feature flag），
 *   在 api/types.ts 的 SiteStatus 加字段后，这里无需改动（整体透传）。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchSiteStatus } from '@/api/site'
import { ApiError } from '@/api/client'
import type { SiteStatus } from '@/api/types'

export const useSiteStore = defineStore('site', () => {
  const status = ref<SiteStatus | null>(null)
  const loading = ref(false)
  const error = ref('')

  /** 站点显示名（未加载完成时回退为品牌名，避免标题闪空） */
  const siteName = computed(() => status.value?.name || 'AQUA-API')
  const siteDescription = computed(() => status.value?.site_description || '')
  const version = computed(() => status.value?.version || '')
  const models = computed(() => status.value?.models ?? [])
  /** 注册开关：未拿到站点信息时按「关闭」处理（保守策略，避免注册页误导用户） */
  const registrationEnabled = computed(() => status.value?.registration_enabled === true)
  /**
   * 注册是否需要邮箱验证码。
   *
   * 未拿到站点信息时按 false 处理：注册页此时会显示骨架屏，
   * 不会渲染表单，因此不会造成"少显示一个必填项"的问题。
   */
  const emailCodeRequired = computed(() => status.value?.email_code_required === true)
  /** 邮件通道是否就绪：未就绪时注册页提前给出"请联系管理员"的提示 */
  const emailServiceReady = computed(() => status.value?.email_service_ready !== false)
  /**
   * 1 元可兑换的额度数（额度 ↔ 人民币 的展示折算比例）。
   *
   * 未拿到站点信息时为 0：调用方（useQuotaUnit）据此退回显示原始额度，
   * 而不是用一个假设的比例把余额算成错的金额。
   */
  const quotaPerYuan = computed(() => status.value?.quota_per_yuan ?? 0)

  /**
   * 合规信息（主体名称、备案号、客服邮箱）。
   *
   * 为什么从站点信息里读而不是前端写死：这些值会随备案变更、
   * 主体改名、换客服邮箱而变化，写死就意味着每次都要改代码发版。
   * 未配置时返回空串，页脚据此不展示该项（而不是显示一个空白占位）。
   */
  const operatorName = computed(() => status.value?.operator_name || '')
  const icpLicense = computed(() => status.value?.icp_license || '')
  const policeLicense = computed(() => status.value?.police_license || '')
  const contactEmail = computed(() => status.value?.contact_email || '')

  /**
   * 服务性质声明：全站页脚与协议页共用一句。
   *
   * 为什么固定在前端而不是做成设置项：它是一句"法律性质的定性说明"，
   * 措辞不应当被随手改动（改错了反而制造风险），因此固化并集中在此处，
   * 任何页面引用同一份文案，避免多处表述不一致。
   */
  const serviceNatureNotice =
    '本服务为第三方 AI 模型接口接入服务，与各模型厂商无隶属、代理或授权关系；' +
    '模型输出由 AI 生成，仅供参考，请自行核验并遵守相关法律法规。'

  /**
   * 拉取站点信息。
   * @param force 忽略缓存强制刷新（用户点击「重试」时使用）
   */
  async function load(force = false): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      status.value = await fetchSiteStatus(force)
    } catch (err) {
      // 站点信息失败不应阻断页面渲染：记录错误，由页面显示可重试的提示条
      error.value = err instanceof ApiError ? err.message : '站点信息加载失败'
    } finally {
      loading.value = false
    }
  }

  return {
    status,
    loading,
    error,
    siteName,
    siteDescription,
    version,
    models,
    registrationEnabled,
    emailCodeRequired,
    emailServiceReady,
    quotaPerYuan,
    operatorName,
    icpLicense,
    policeLicense,
    contactEmail,
    serviceNatureNotice,
    load,
  }
})
