<script setup lang="ts">
/**
 * 用户门户 · 财务记录：把钱的三类流水集中在一页。
 *
 * 意图（Why）：
 *   "我的钱去哪儿了"是一个问题，不该分散在四个页面回答。此前用户要看余额去概览、
 *   看充值去充值页、看奖励去邀请页、看消费去日志页 —— 对账时要来回翻。
 *   本页把四件事收在一处：
 *     1) 顶部汇总卡：余额 / 累计充值 / 累计奖励 / 累计消费（四个数字一次给全）；
 *     2) 下方三类流水标签页：充值记录、奖励明细、消费流水。
 *   金额一律按后端配置的兑换比例折算成人民币（见 useQuotaUnit）：
 *   额度是站内计费单位，用户只认钱。
 *
 * 为什么明细不合并成一张表：三类记录的字段与语义完全不同
 *   （订单有支付状态、奖励有来源人、消费有模型与 token），
 *   硬塞进一张表会逼着每行留一半空列，反而更难读。
 *
 * 流转（Flow）：
 *   onMounted → fetchFinanceSummary()（汇总）+ 加载当前标签页的列表
 *   切换标签 → ensure()：首次进入该标签才请求，来回切换不重复打接口
 *   分页 → 各标签独立维护页码，切回来仍停在原页
 *
 * 扩展（Extend）：
 *   新增一类流水（如"兑换码领取"）：在 TABS 里加一项 + 复用 createList 装配，
 *   汇总数字若也要跟着变，请在后端 handler_finance.go 一并返回（口径必须同源）。
 */
import { computed, onMounted, ref, type Ref } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import DataState from '@/components/DataState.vue'
import Pagination from '@/components/Pagination.vue'
import StatCard from '@/components/StatCard.vue'
import { ApiError } from '@/api/client'
import { fetchFinanceSummary, listMyLogs, listMyOrders } from '@/api/portal'
import { listMyReferralRewards } from '@/api/referral'
import type { FinanceSummary, Paged, PaymentOrder, ReferralReward, UsageLog } from '@/api/types'
import { ORDER_STATUS_PAID, ORDER_STATUS_PENDING } from '@/api/types'
import { useQuotaUnit } from '@/composables/useQuotaUnit'
import { formatDateTime, formatNumber } from '@/utils/format'

/** 余额/充值/奖励/消费一律按人民币展示（比例来自后端设置，见 useQuotaUnit） */
const { yuanText, quotaText: rawQuotaText, rateText } = useQuotaUnit()

type TabKey = 'orders' | 'rewards' | 'spend'

interface TabItem {
  key: TabKey
  label: string
}

const TABS: TabItem[] = [
  { key: 'orders', label: '充值记录' },
  { key: 'rewards', label: '奖励明细' },
  { key: 'spend', label: '消费流水' },
]

const activeTab = ref<TabKey>('orders')

/* ── 汇总 ───────────────────────────────────────────────── */

const summary = ref<FinanceSummary | null>(null)
const summaryLoading = ref(true)
const summaryError = ref('')

/** 不限额度账户用 -1 表示，展示时如实说明（不折算成金额，那会误导） */
const unlimitedBalance = computed(() => (summary.value?.balance_quota ?? 0) < 0)

const balanceText = computed(() =>
  unlimitedBalance.value ? '不限额度' : yuanText(summary.value?.balance_quota ?? 0),
)
const rechargedText = computed(() => yuanText(summary.value?.recharged_quota ?? 0))
const rewardText = computed(() => yuanText(summary.value?.reward_quota ?? 0))
const usedText = computed(() => yuanText(summary.value?.used_quota ?? 0))

const balanceHint = computed(() => {
  if (unlimitedBalance.value) return '该账号不限额，调用不受余额限制。'
  if (!rateText.value) return '余额单位由后端定义。'
  return `${rawQuotaText(summary.value?.balance_quota ?? 0)}（按 ${rateText.value} 折算）`
})

async function loadSummary(): Promise<void> {
  summaryLoading.value = true
  summaryError.value = ''
  try {
    summary.value = await fetchFinanceSummary()
  } catch (err) {
    summaryError.value = err instanceof ApiError ? err.message : '财务汇总加载失败'
  } finally {
    summaryLoading.value = false
  }
}

/* ── 三类流水（结构相同，装配方式复用同一个工厂）───────────── */

/**
 * 造一个"分页列表"状态机。
 *
 * 抽出来的理由：三类流水的加载/分页/错误处理逻辑逐字相同，
 * 写三遍必然出现某一处漏了 loading 或漏了错误态。
 * ensure() 实现"首次进入标签才请求"，避免每次切换标签都重新打接口。
 */
function createList<T>(fetcher: (paged: { page: number; size: number }) => Promise<Paged<T>>) {
  const items = ref([]) as Ref<T[]>
  const total = ref(0)
  const page = ref(1)
  const size = ref(10)
  const loading = ref(false)
  const error = ref('')
  let loaded = false

  async function load(target = page.value): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const result = await fetcher({ page: target, size: size.value })
      items.value = result.items ?? []
      total.value = result.total ?? 0
      page.value = target
      loaded = true
    } catch (err) {
      items.value = []
      total.value = 0
      error.value = err instanceof ApiError ? err.message : '加载失败'
    } finally {
      loading.value = false
    }
  }

  /** 首次进入该标签时才加载；已加载过则直接复用（分页状态也保留） */
  async function ensure(): Promise<void> {
    if (!loaded) await load(1)
  }

  async function changeSize(next: number): Promise<void> {
    size.value = next
    await load(1)
  }

  return { items, total, page, size, loading, error, load, ensure, changeSize }
}

const orders = createList<PaymentOrder>((paged) => listMyOrders(paged))
const rewards = createList<ReferralReward>((paged) => listMyReferralRewards(paged))
const spend = createList<UsageLog>((paged) => listMyLogs(paged))

/** 标签页与列表状态的对应关系（供模板统一渲染，避免三段重复模板） */
const listOf = {
  orders,
  rewards,
  spend,
} as const

const current = computed(() => listOf[activeTab.value])

async function switchTab(key: TabKey): Promise<void> {
  activeTab.value = key
  await current.value.ensure()
}

/* ── 展示辅助 ───────────────────────────────────────────── */

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

/** 订单的支付方式：优先显示子方式（如「支付宝」），中文名由后端下发 */
function orderMethodText(order: PaymentOrder): string {
  return order.sub_method_label || order.method_label || order.method
}

onMounted(async () => {
  await Promise.all([loadSummary(), orders.ensure()])
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">财务记录</h2>
        <p class="page-desc">
          余额、充值、奖励与消费的完整流水都集中在这里，金额以人民币显示。
        </p>
      </div>
      <div class="toolbar">
        <RouterLink to="/console/recharge" class="btn btn-primary btn-sm">
          <AppIcon name="wallet" :size="14" />
          去充值
        </RouterLink>
        <RouterLink to="/console" class="btn btn-secondary btn-sm">
          <AppIcon name="home" :size="14" />
          返回概览
        </RouterLink>
      </div>
    </div>

    <!-- ── 汇总卡 ─────────────────────────────────────── -->
    <DataState
      :loading="summaryLoading"
      :error="summaryError"
      compact
      loading-text="正在读取财务汇总…"
      @retry="loadSummary"
    />

    <section v-if="!summaryLoading && !summaryError" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="账户余额" :value="balanceText" icon="quota" tone="brand">
        <p class="text-xs text-ink-400">{{ balanceHint }}</p>
      </StatCard>
      <StatCard label="累计充值" :value="rechargedText" icon="wallet" tone="ok">
        <p class="text-xs text-ink-400">
          共 {{ formatNumber(summary?.recharge_count ?? 0) }} 笔已支付订单
        </p>
      </StatCard>
      <StatCard label="累计奖励" :value="rewardText" icon="users" tone="brand">
        <p class="text-xs text-ink-400">邀请好友注册与充值带来的奖励。</p>
      </StatCard>
      <StatCard label="累计消费" :value="usedText" icon="trend" tone="warn">
        <p class="text-xs text-ink-400">模型调用累计扣费（未定价模型不计费）。</p>
      </StatCard>
    </section>

    <!-- ── 流水标签页 ─────────────────────────────────── -->
    <section class="mt-6">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="btn btn-sm"
          :class="activeTab === tab.key ? 'btn-primary' : 'btn-secondary'"
          @click="switchTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <DataState
        :loading="current.loading.value"
        :error="current.error.value"
        :empty="!current.loading.value && !current.error.value && current.items.value.length === 0"
        loading-text="正在读取流水…"
        empty-text="暂无记录"
        empty-hint="完成一笔充值、获得一次奖励或发起一次调用后，这里会出现对应记录。"
        @retry="current.load()"
      />

      <!-- 充值记录（仅在真有数据时渲染表格，避免加载中露出一张空表头） -->
      <div v-if="activeTab === 'orders' && orders.items.value.length" class="table-wrap table-cards">
        <table class="data-table">
          <thead>
            <tr>
              <th>订单号</th>
              <th class="text-right">金额</th>
              <th class="text-right">到账金额</th>
              <th>方式</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>支付时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orders.items.value" :key="order.trade_no">
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

      <!-- 奖励明细 -->
      <div v-else-if="activeTab === 'rewards' && rewards.items.value.length" class="table-wrap table-cards">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>来自</th>
              <th class="text-right">金额</th>
              <th>关联订单</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="reward in rewards.items.value" :key="reward.id">
              <td class="cell-muted" data-label="时间">{{ formatDateTime(reward.created_at) }}</td>
              <td data-label="类型"><span class="badge badge-ok">{{ reward.kind_text }}</span></td>
              <td class="cell-muted" data-label="来自">
                <!-- 用户名由后端脱敏：既能让邀请人对上号，又不长期暴露对方完整账号 -->
                {{ reward.invitee || '—' }}
              </td>
              <td class="cell-num" data-label="金额">{{ yuanText(reward.quota) }}</td>
              <td class="cell-muted" data-label="关联订单">
                <code v-if="reward.order_trade_no" class="font-mono text-[12px] text-ink-300">
                  {{ reward.order_trade_no }}
                </code>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 消费流水 -->
      <div v-else-if="activeTab === 'spend' && spend.items.value.length" class="table-wrap table-cards">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>模型</th>
              <th class="text-right">输入 / 输出</th>
              <th class="text-right">费用</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in spend.items.value" :key="log.id">
              <td class="cell-muted" data-label="时间">{{ formatDateTime(log.created_at) }}</td>
              <td data-label="模型"><code class="font-mono text-[12px] text-ink-200">{{ log.model }}</code></td>
              <td class="cell-num text-ink-300" data-label="输入 / 输出">
                {{ formatNumber(log.prompt_tokens) }} / {{ formatNumber(log.completion_tokens) }}
              </td>
              <td class="cell-num" data-label="费用">{{ yuanText(log.quota) }}</td>
              <td data-label="状态">
                <span class="badge" :class="log.status_code >= 400 ? 'badge-warn' : 'badge-ok'">
                  {{ log.status_code }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 消费流水的补充说明（在表格之外：清空/加载时也要看得见这个去处） -->
      <p v-if="activeTab === 'spend' && spend.items.value.length" class="hint mt-2">
        这里只列金额与用量；要按令牌、渠道、延迟等维度排查，请到
        <RouterLink to="/console/logs" class="link">调用日志</RouterLink>。
      </p>

      <div v-if="current.total.value > 0" class="card mt-3">
        <Pagination
          :page="current.page.value"
          :size="current.size.value"
          :total="current.total.value"
          :disabled="current.loading.value"
          :size-options="[10, 20, 50]"
          @update:page="current.load($event)"
          @update:size="current.changeSize($event)"
        />
      </div>
    </section>
  </div>
</template>
