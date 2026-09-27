/**
 * 额度 → 人民币 的展示换算（用户门户统一口径）。
 *
 * 意图（Why）：
 *   额度是站内计费单位：默认 1 元 = 100 额度（即 1 额度 ≈ 1 分）。
 *   这个单位对站长是必要的（模型单价是「每百万 token 多少额度」，
 *   用比"元"更细的单位才能把便宜模型写成整数、避免浮点误差），
 *   但用户只认人民币 —— 充了 1 元、余额显示「100」会被当成算错。
 *   因此用户门户一律把额度折算成 ¥ 展示，额度只在需要精确整数的地方出现
 *   （如后台价格表、令牌额度上限的输入框）。
 *
 * 为什么比例只能来自后端：
 *   1 元 = 多少额度由后台「系统设置 → 充值 → 兑换比例」决定，站长随时可改。
 *   前端硬编码 100 会在站长改成 97 之后把余额显示成错的金额。
 *   比例由站点信息（GET /api/status 的 quota_per_yuan）提供，见 stores/site.ts。
 *
 * 比例拿不到时**不猜**：退回显示原始额度 ——
 *   显示一个假金额比显示原始单位危险得多。
 *
 * 流转（Flow）：
 *   stores/site（启动时预取 /api/status）→ quotaPerYuan → yuanText(额度) → 「¥1.00」
 *   OverviewView / RechargeView / LogTable / TokensView / 模型广场 共用本文件
 *
 * 扩展（Extend）：
 *   新增"钱"的展示位置时直接调 yuanText；不要自己写 quota / 100。
 *   若将来支持多币种，在此按币种扩参（目前全站单一货币，取自支付设置）。
 */
import { computed } from 'vue'

import { EMPTY, formatCurrency, formatNumber } from '@/utils/format'
import { useSiteStore } from '@/stores/site'

/**
 * 额度换算工具。
 *
 * 用法：`const { yuanText } = useQuotaUnit()` → `yuanText(user.quota)`。
 */
export function useQuotaUnit() {
  const site = useSiteStore()
  // 站点信息由 main.ts 启动时预取；若尚未就绪（或预取失败）这里兜底再拉一次，
  // fetchSiteStatus 内部有 60s 缓存，重复调用不会产生额外请求压力。
  if (!site.status) void site.load()

  const quotaPerYuan = computed(() => site.quotaPerYuan)

  /** 是否已具备折算能力（可用于决定是否显示"折算自 X 额度"这类补充说明） */
  const convertible = computed(() => quotaPerYuan.value > 0)

  /**
   * 额度 → 「¥1.00」。
   *
   * 比例未知时退回「100 额度」：这是唯一不会误导用户的降级方式。
   */
  function yuanText(quota: number | null | undefined): string {
    if (quota === null || quota === undefined || Number.isNaN(quota)) return EMPTY
    if (quotaPerYuan.value <= 0) return `${formatNumber(quota)} 额度`
    return formatCurrency(quota / quotaPerYuan.value)
  }

  /**
   * 额度 → 「¥0.09」：用于金额极小、需要保留两位以上小数的场景
   * （如单次调用的费用、每百万 token 的单价，¥0.00 会看不出差别）。
   */
  function yuanTextPrecise(quota: number | null | undefined): string {
    if (quota === null || quota === undefined || Number.isNaN(quota)) return EMPTY
    if (quotaPerYuan.value <= 0) return `${formatNumber(quota)} 额度`
    const yuan = quota / quotaPerYuan.value
    // 小于 0.01 元的金额固定保留 4 位小数，避免统一显示成 ¥0.00
    if (yuan !== 0 && Math.abs(yuan) < 0.01) {
      return `¥${yuan.toFixed(4)}`
    }
    return formatCurrency(yuan)
  }

  /** 额度 → 「100 额度」（需要在钱旁边保留原始数值时使用） */
  function quotaText(quota: number | null | undefined): string {
    if (quota === null || quota === undefined || Number.isNaN(quota)) return EMPTY
    return `${formatNumber(quota)} 额度`
  }

  /** 比例说明文案，如「1 元 = 100 额度」；比例未知时为空串 */
  const rateText = computed(() =>
    quotaPerYuan.value > 0 ? `1 元 = ${formatNumber(quotaPerYuan.value)} 额度` : '',
  )

  return { quotaPerYuan, convertible, rateText, yuanText, yuanTextPrecise, quotaText }
}
