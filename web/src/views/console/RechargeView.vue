<script setup lang="ts">
/**
 * 用户门户 · 账户充值：下单、支付与充值记录。
 *
 * 意图（Why）：
 *   充值链路的体验关键在于"钱付出去了，额度到了没有"。因此本页做三件事：
 *     1) 下单前把口径讲清楚：1 元 = 多少额度（由后端配置决定），避免到账后才发现不符预期；
 *     2) 支付后回到本页自动轮询订单状态，直到入账或关闭；
 *     3) 保留完整充值记录（含"已入账"标记），让用户能自查。
 *
 * 为什么额度由服务端算：前端只提交"金额"，额度一律由后端按当前汇率计算，
 *   否则用户改一个数字就能给自己加天文数字的额度（这是最直接的资损漏洞）。
 *
 * 流转（Flow）：
 *   onMounted → fetchPaymentInfo() + listMyOrders()
 *   下单 → createOrder() → 若有 pay_url 则新窗口打开收银台 → 轮询 getMyOrder()
 *   从收银台返回（?trade_no=xxx）→ 直接轮询该订单
 *
 * 扩展（Extend）：
 *   新增支付方式时无需改动本页：通道与"子方式（支付宝/微信）"都由后端下发，
 *   本页只负责把 sub_methods 展开成一行行选项（见 choices 计算属性）；
 *   需要"自定义金额输入键盘"等交互优化时，改 amount 相关一段即可。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import DataState from '@/components/DataState.vue'
import Pagination from '@/components/Pagination.vue'
import { ApiError } from '@/api/client'
import { createOrder, fetchFinanceSummary, getMyOrder, listMyOrders } from '@/api/portal'
import { fetchPaymentInfo } from '@/api/site'
import type { PaymentOrder, PublicPaymentInfo } from '@/api/types'
import { ORDER_STATUS_PAID, ORDER_STATUS_PENDING } from '@/api/types'
import { toastError, toastSuccess } from '@/composables/useToast'
import { useQuotaUnit } from '@/composables/useQuotaUnit'
import { formatDateTime } from '@/utils/format'

const route = useRoute()

/** 余额 / 到账 / 消费一律折算成人民币展示（比例来自后端设置，见 useQuotaUnit） */
const { yuanText, quotaText: rawQuotaText, rateText, quotaPerYuan } = useQuotaUnit()

const info = ref<PublicPaymentInfo | null>(null)
const infoLoading = ref(true)
const infoError = ref('')

/** 表单：金额用"元"字符串承载，提交前换算成"分" */
const amountYuan = ref('10')

/**
 * 一个"可选中"的支付选项。
 *
 * 为什么要把通道展开成选项列表：易支付这类聚合通道只有一个通道名（epay），
 * 但用户在收银台上真正要选的是"支付宝还是微信"。若直接渲染通道，
 * 页面上就只出现一行「在线支付」，用户既看不出能选微信，也无从表达自己的选择。
 * 所以这里把后端下发的 sub_methods 展开成"每个子方式一行"。
 */
interface PayChoice {
  /** 选中键：无子方式即通道名（epay），有子方式为「通道:子方式」（epay:wxpay） */
  key: string
  method: string
  subMethod: string
  label: string
  hint: string
  ready: boolean
}

/** 选中的选项键（用 key 而不是分别存 method/subMethod，避免两者不同步） */
const choiceKey = ref('')
const submitting = ref(false)
const formError = ref('')

/** 由后端配置推导出的全部可选支付方式 */
const choices = computed<PayChoice[]>(() => {
  const result: PayChoice[] = []
  for (const item of info.value?.methods ?? []) {
    const isManual = item.name === 'manual'
    const hint = isManual ? '向站长付款后由管理员确认入账' : '跳转到第三方收银台完成支付'
    const subs = item.sub_methods ?? []
    if (!subs.length) {
      result.push({ key: item.name, method: item.name, subMethod: '', label: item.label, hint, ready: item.ready })
      continue
    }
    for (const sub of subs) {
      result.push({
        key: `${item.name}:${sub.name}`,
        method: item.name,
        subMethod: sub.name,
        label: sub.label,
        hint,
        ready: item.ready,
      })
    }
  }
  return result
})

/** 当前选中的选项（下单时取它的 method / sub_method） */
const selected = computed(() => choices.value.find((item) => item.key === choiceKey.value) ?? null)

/** 当前等待支付的订单（用于展示"等待支付"引导与轮询） */
const pendingOrder = ref<PaymentOrder | null>(null)

/* ── 当前余额 ───────────────────────────────────────────── */

/**
 * 余额取自财务汇总接口（而不是会话里的用户对象）。
 *
 * 理由：会话里的额度是登录时的那一份快照，用户充值成功后不会自动变新——
 * 于是"刚付完钱、余额还是旧的"，会让人以为钱没到账。
 * 这里在支付成功后主动刷新一次，保证"余额随到账立即变化"。
 */
const balanceQuota = ref<number | null>(null)

const balanceText = computed(() => {
  const quota = balanceQuota.value
  if (quota === null) return '—'
  // -1 是"不限额度"的约定值，不能折算成金额
  if (quota < 0) return '不限额度'
  return yuanText(quota)
})

async function loadBalance(): Promise<void> {
  try {
    balanceQuota.value = (await fetchFinanceSummary()).balance_quota
  } catch {
    // 余额读不到不影响充值本身：显示占位符，不让整页报错
    balanceQuota.value = null
  }
}

const orders = ref<PaymentOrder[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const ordersLoading = ref(true)
const ordersError = ref('')

let pollTimer = 0

/**
 * 到账口径文案。
 *
 * 为什么不再出现"1 CNY = 100 额度"：额度是站内计费单位，用户只认人民币，
 * 页面上显示"充 1 元到账 100"曾被误认为算错。现在余额、到账、消费一律显示 ¥
 * （充 1 元到账 ¥1.00），额度只在后台配置与模型单价换算里出现。
 */
const exchangeHint = computed(() => {
  const rate = info.value?.exchange_rate ?? 0
  if (rate <= 0) return '充值比例未配置，请联系管理员'
  return '充值金额实时到账，余额以人民币显示。'
})

/** 预计到账额度：与后端口径一致（元 × 汇率，向下取整） */
const estimatedQuota = computed(() => {
  const rate = info.value?.exchange_rate ?? 0
  const cents = yuanToCents(amountYuan.value)
  if (cents <= 0 || rate <= 0) return 0
  return Math.floor((cents * rate) / 100)
})

/** 预计到账金额（人民币）：即服务端实际入账的额度折算回来，避免展示与到账不一致 */
const estimatedYuan = computed(() => yuanText(estimatedQuota.value))

const minYuan = computed(() => ((info.value?.min_cents ?? 0) / 100).toFixed(2))
const maxYuan = computed(() => {
  const max = info.value?.max_cents ?? 0
  return max > 0 ? (max / 100).toFixed(2) : ''
})

/** 常用金额预设（元） */
const presets = [10, 30, 50, 100, 200]

/**
 * 把"元"字符串解析为"分"。
 *
 * 手工解析而不走 parseFloat：浮点会把 10.01 解析成 10.009999…，
 * 转成分时可能出现 1000 或 1001 的不确定结果，属于资损隐患。
 */
function yuanToCents(raw: string): number {
  const text = raw.trim()
  if (!text) return 0
  const [intPart, fracPart = ''] = text.split('.')
  const whole = Number.parseInt(intPart || '0', 10)
  if (!Number.isFinite(whole) || whole < 0) return 0
  const frac = Number.parseInt((fracPart + '00').slice(0, 2), 10)
  if (!Number.isFinite(frac)) return 0
  return whole * 100 + frac
}

async function loadInfo(): Promise<void> {
  infoLoading.value = true
  infoError.value = ''
  try {
    info.value = await fetchPaymentInfo()
    // 默认选中第一个"密钥已就绪"的选项，避免用户选到还没配好的通道后报错；
    // 如果站长刚改了配置导致原来的选中项消失，这里会顺带纠正回来。
    if (!choices.value.some((item) => item.key === choiceKey.value)) {
      choiceKey.value = (choices.value.find((item) => item.ready) || choices.value[0])?.key ?? ''
    }
  } catch (err) {
    infoError.value = err instanceof ApiError ? err.message : '充值信息加载失败'
  } finally {
    infoLoading.value = false
  }
}

async function loadOrders(): Promise<void> {
  ordersLoading.value = true
  ordersError.value = ''
  try {
    const result = await listMyOrders({ page: page.value, size: size.value })
    orders.value = result.items ?? []
    total.value = result.total ?? 0
  } catch (err) {
    orders.value = []
    total.value = 0
    ordersError.value = err instanceof ApiError ? err.message : '充值记录加载失败'
  } finally {
    ordersLoading.value = false
  }
}

/** 轮询待支付订单：3 秒一次，最多持续 5 分钟（避免页面长期占用请求） */
function startPolling(tradeNo: string): void {
  stopPolling()
  const startedAt = Date.now()
  pollTimer = window.setInterval(async () => {
    if (Date.now() - startedAt > 5 * 60 * 1000) {
      stopPolling()
      return
    }
    try {
      const order = await getMyOrder(tradeNo)
      pendingOrder.value = order
      if (order.status !== ORDER_STATUS_PENDING) {
        stopPolling()
        if (order.status === ORDER_STATUS_PAID) {
          toastSuccess(`充值成功，已到账 ${yuanText(order.quota)}`)
          // 到账后立刻刷新余额：否则页面上还是付款前的旧数字
          void loadBalance()
        }
        await loadOrders()
      }
    } catch {
      // 单次轮询失败不终止：网络抖动很常见，下一轮会继续
    }
  }, 3000)
}

function stopPolling(): void {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = 0
  }
}

async function submit(): Promise<void> {
  const cents = yuanToCents(amountYuan.value)
  if (cents <= 0) {
    formError.value = '请输入正确的充值金额'
    return
  }
  const choice = selected.value
  if (!choice) {
    formError.value = '请选择支付方式'
    return
  }
  const minCents = info.value?.min_cents ?? 0
  if (cents < minCents) {
    formError.value = `单笔充值不能少于 ${minYuan.value} 元`
    return
  }
  const maxCents = info.value?.max_cents ?? 0
  if (maxCents > 0 && cents > maxCents) {
    formError.value = `单笔充值不能超过 ${maxYuan.value} 元`
    return
  }

  submitting.value = true
  formError.value = ''
  try {
    const order = await createOrder({
      amount_cents: cents,
      method: choice.method,
      sub_method: choice.subMethod || undefined,
    })
    pendingOrder.value = order
    await loadOrders()

    if (order.pay_url) {
      // 新窗口打开收银台：保留本页以便回来后继续轮询状态
      window.open(order.pay_url, '_blank', 'noopener,noreferrer')
      startPolling(order.trade_no)
    } else {
      // 人工确认通道：没有收银台，提示用户按站长公布的方式付款
      toastSuccess('充值申请已提交，请联系管理员确认收款后入账')
    }
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : '下单失败'
  } finally {
    submitting.value = false
  }
}

function changePage(next: number): void {
  page.value = next
  void loadOrders()
}

function changeSize(next: number): void {
  size.value = next
  page.value = 1
  void loadOrders()
}

/**
 * 订单的支付方式文案：优先显示子方式（如「支付宝」「微信支付」）。
 * 中文名由后端下发（method_label / sub_method_label），前端不做代码到名字的映射，
 * 否则后端加了通道、前端就会显示成 alipay 这样的原始代码。
 */
function orderMethodText(order: PaymentOrder): string {
  return order.sub_method_label || order.method_label || order.method
}

/** 订单状态徽标：待支付用警示色（需要用户行动），已入账用成功色 */
function orderBadgeClass(order: PaymentOrder): string {
  switch (order.status) {
    case ORDER_STATUS_PAID:
      return 'badge badge-ok'
    case ORDER_STATUS_PENDING:
      return 'badge badge-warn'
    default:
      return 'badge badge-off'
  }
}

/** 从收银台返回时（?trade_no=），自动查询该订单并开始轮询 */
watch(
  () => route.query.trade_no,
  async (tradeNo) => {
    if (typeof tradeNo !== 'string' || !tradeNo) return
    try {
      const order = await getMyOrder(tradeNo)
      pendingOrder.value = order
      if (order.status === ORDER_STATUS_PENDING) startPolling(order.trade_no)
    } catch {
      // 订单号可能属于其它账号或已过期：静默忽略，不打扰用户
    }
  },
)

onMounted(async () => {
  await Promise.all([loadInfo(), loadOrders(), loadBalance()])
  const tradeNo = route.query.trade_no
  if (typeof tradeNo === 'string' && tradeNo) {
    try {
      const order = await getMyOrder(tradeNo)
      pendingOrder.value = order
      if (order.status === ORDER_STATUS_PENDING) startPolling(order.trade_no)
    } catch {
      /* 忽略：见 watch 的说明 */
    }
  }
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">账户充值</h2>
        <p class="page-desc">
          充值后额度立即到账，可用于全部已定价模型。{{ exchangeHint }}
        </p>
      </div>
      <RouterLink to="/console" class="btn btn-secondary btn-sm">
        <AppIcon name="home" :size="14" />
        返回概览
      </RouterLink>
    </div>

    <DataState
      :loading="infoLoading"
      :error="infoError"
      :empty="!infoLoading && !infoError && !info?.enabled"
      compact
      loading-text="正在读取充值配置…"
      empty-text="本站未开放充值"
      empty-hint="请联系管理员为账号分配额度；或由管理员在后台「系统设置 → 充值」中开启在线充值。"
      @retry="loadInfo"
    />

    <div v-if="!infoLoading && !infoError && info?.enabled" class="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
      <!-- ── 下单区 ───────────────────────────────────── -->
      <section class="card card-pad">
        <h3 class="section-title flex items-center gap-2">
          <AppIcon name="wallet" :size="16" class="text-brand-700" />
          选择充值金额
        </h3>

        <!-- 当前余额：放在下单区最上方，用户决定充多少之前先知道"现在还剩多少" -->
        <div
          class="mt-4 flex items-center justify-between gap-3 rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2.5"
        >
          <span class="flex items-center gap-1.5 text-xs text-ink-400">
            <AppIcon name="quota" :size="14" class="text-brand-700" />
            当前余额
          </span>
          <span class="font-mono text-lg font-semibold text-brand-700">{{ balanceText }}</span>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="preset in presets"
            :key="preset"
            type="button"
            class="btn btn-sm"
            :class="Number(amountYuan) === preset ? 'btn-primary' : 'btn-secondary'"
            @click="amountYuan = String(preset)"
          >
            {{ preset }} 元
          </button>
        </div>

        <div class="mt-4">
          <label class="label" for="recharge-amount">自定义金额（{{ info.currency }}）</label>
          <div class="relative">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">¥</span>
            <input
              id="recharge-amount"
              v-model="amountYuan"
              class="input pl-7 text-lg font-semibold"
              type="text"
              inputmode="decimal"
              placeholder="10.00"
            />
          </div>
          <p class="hint">
            单笔限额：{{ minYuan }} 元{{ maxYuan ? ` ~ ${maxYuan} 元` : ' 起，不限上限' }}；
            预计到账 <strong class="text-ink-100">{{ estimatedYuan }}</strong>。
          </p>
        </div>

        <div class="mt-4">
          <p class="label">支付方式</p>
          <div class="space-y-2">
            <label
              v-for="item in choices"
              :key="item.key"
              class="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
              :class="choiceKey === item.key ? 'border-brand-500/60 bg-brand-500/5' : 'border-ink-800 hover:border-ink-700'"
            >
              <input v-model="choiceKey" class="checkbox" type="radio" :value="item.key" :disabled="!item.ready" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm text-ink-100">{{ item.label }}</span>
                <span class="block text-[11px] text-ink-500">{{ item.hint }}</span>
              </span>
              <span v-if="!item.ready" class="badge badge-warn">未配置密钥</span>
            </label>
          </div>
        </div>

        <p v-if="formError" class="field-error mt-3">{{ formError }}</p>

        <button type="button" class="btn btn-primary mt-4 w-full" :disabled="submitting" @click="submit">
          <AppIcon name="cart" :size="16" />
          {{ submitting ? '正在下单…' : `支付 ${amountYuan || '0'} ${info.currency}` }}
        </button>
      </section>

      <!-- ── 当前订单 / 说明 ───────────────────────────── -->
      <section class="space-y-5">
        <div v-if="pendingOrder" class="card card-pad">
          <h3 class="section-title flex items-center gap-2">
            <AppIcon name="clock" :size="16" class="text-brand-700" />
            当前订单
          </h3>
          <div class="mt-3 space-y-2 text-sm">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink-400">订单号</span>
              <code class="chip">{{ pendingOrder.trade_no }}</code>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink-400">支付 / 到账</span>
              <span class="font-mono text-ink-100">
                ¥{{ pendingOrder.amount_text }} → {{ yuanText(pendingOrder.quota) }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink-400">状态</span>
              <span :class="orderBadgeClass(pendingOrder)">{{ pendingOrder.status_text }}</span>
            </div>
            <div v-if="pendingOrder.expires_at" class="flex items-center justify-between gap-3">
              <span class="text-ink-400">支付截止</span>
              <span class="text-ink-200">{{ formatDateTime(pendingOrder.expires_at) }}</span>
            </div>
          </div>

          <div v-if="pendingOrder.status === ORDER_STATUS_PENDING" class="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
            <p class="flex items-start gap-2 text-xs leading-relaxed text-amber-800">
              <AppIcon name="info" :size="14" class="mt-0.5" />
              <span>
                正在等待支付结果，本页会自动刷新。若收银台未自动打开，
                请点击下方按钮前往支付；支付完成后无需手动操作，额度会自动到账。
              </span>
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <a
                v-if="pendingOrder.pay_url"
                class="btn btn-primary btn-sm"
                :href="pendingOrder.pay_url"
                target="_blank"
                rel="noopener noreferrer"
              >
                <AppIcon name="external" :size="14" />
                前往支付
              </a>
              <RouterLink to="/console/recharge" class="btn btn-secondary btn-sm">取消等待</RouterLink>
            </div>
          </div>
        </div>

        <div class="card card-pad">
          <h3 class="section-title flex items-center gap-2">
            <AppIcon name="info" :size="16" class="text-brand-700" />
            充值说明
          </h3>
          <ul class="mt-3 space-y-1.5 text-xs leading-relaxed text-ink-400">
            <li>· 充值金额实时到账，余额可直接用于所有已定价的模型调用。</li>
            <li>· 支付超时的订单会被自动关闭，关闭后不再受理，重新下单即可。</li>
            <li>· 已支付订单如需退款，请联系管理员在后台处理（会扣回已入账余额）。</li>
            <li>
              · 余额以人民币显示；站内计费使用更细的计量单位「额度」
              <template v-if="rateText">（{{ rateText }}，即 {{ rawQuotaText(quotaPerYuan) }} = ¥1.00）</template>
              ，仅用于换算模型单价，不影响你的实际扣费金额。
            </li>
            <li>
              · 计费一律以上游返回的实际用量结算：部分通道由第三方中转提供，上游网关可能注入一段
              系统提示并计入输入用量（故输入 token 会有一定基数）；缓存是否命中以上游实际回报为准。
              明细可在「调用日志」逐笔核对。
            </li>
          </ul>
        </div>
      </section>
    </div>

    <!-- ── 充值记录 ───────────────────────────────────── -->
    <section class="mt-6">
      <h3 class="section-title mb-3">充值记录</h3>

      <div class="table-wrap table-cards">
        <table class="data-table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>金额</th>
              <th class="text-right">到账金额</th>
              <th>方式</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>支付时间</th>
            </tr>
          </thead>
          <tbody>
            <DataState
              :loading="ordersLoading"
              :error="ordersError"
              :empty="!ordersLoading && !ordersError && orders.length === 0"
              :colspan="7"
              loading-text="正在读取充值记录…"
              empty-text="还没有充值记录"
              empty-hint="完成一笔充值后，这里会显示订单状态与到账情况。"
              @retry="loadOrders"
            />

            <tr v-for="order in orders" :key="order.trade_no">
              <td data-label="订单号"><code class="font-mono text-[12px] text-ink-200">{{ order.trade_no }}</code></td>
              <td class="cell-num" data-label="金额">¥{{ order.amount_text }}</td>
              <td class="cell-num" data-label="到账金额">{{ yuanText(order.quota) }}</td>
              <td class="cell-muted" data-label="方式">{{ orderMethodText(order) }}</td>
              <td data-label="状态">
                <span :class="orderBadgeClass(order)">{{ order.status_text }}</span>
                <span v-if="order.status === ORDER_STATUS_PAID && !order.credited" class="ml-1 badge badge-warn">
                  待入账
                </span>
              </td>
              <td class="cell-muted" data-label="创建时间">{{ formatDateTime(order.created_at) }}</td>
              <td class="cell-muted" data-label="支付时间">{{ order.paid_at ? formatDateTime(order.paid_at) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > 0" class="mt-3 card">
        <Pagination
          :page="page"
          :size="size"
          :total="total"
          :disabled="ordersLoading"
          :size-options="[10, 20, 50]"
          @update:page="changePage"
          @update:size="changeSize"
        />
      </div>
    </section>
  </div>
</template>
