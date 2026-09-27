<script setup lang="ts">
/**
 * 管理后台 · 仪表盘：渠道/用户/令牌/今日请求汇总 + 趋势 + Top 模型。
 *
 * 意图（Why）：
 *   管理员打开后台的第一诉求是「现在是否正常」：
 *   因此顶部四张卡给出资源总量与今日质量指标（成功率），
 *   其下用趋势图回答「是否在涨/是否异常」，最后用 Top 模型回答「谁在被使用」。
 *
 * 流转（Flow）：
 *   进入页面 → fetchDashboard() → 卡片 + 两张图表渲染
 *   失败时整页给出可重试的错误态（本页数据同源，无分区必要）
 *
 * 扩展（Extend）：
 *   新增卡片：追加 StatCard；新增图表：复用 EChart + utils/chart.ts 配色常量。
 */
import type { EChartsOption } from 'echarts'
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import EChart from '@/components/EChart.vue'
import StatCard from '@/components/StatCard.vue'
import { ApiError } from '@/api/client'
import { fetchDashboard } from '@/api/admin'
import type { DashboardStats } from '@/api/types'
import { AXIS_LABEL_STYLE, AXIS_LINE_STYLE, CHART_PALETTE, SPLIT_LINE_STYLE, TOOLTIP_STYLE, areaGradient } from '@/utils/chart'
import { EMPTY, formatCompact, formatLatency, formatNumber, formatPercent, formatRate } from '@/utils/format'

const data = ref<DashboardStats | null>(null)
const loading = ref(true)
const error = ref('')

async function loadDashboard(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    data.value = await fetchDashboard()
  } catch (err) {
    data.value = null
    error.value = err instanceof ApiError ? err.message : '仪表盘数据加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadDashboard)

/* ── 卡片数值 ─────────────────────────────────────────── */

const channelTotal = computed(() => formatNumber(data.value?.channels.total ?? 0))
const channelHint = computed(() => {
  const channels = data.value?.channels
  if (!channels) return ''
  const parts = [`已启用 ${channels.enabled}`]
  if (channels.auto_disabled > 0) parts.push(`自动停用 ${channels.auto_disabled}`)
  return parts.join(' · ')
})

const userTotal = computed(() => formatNumber(data.value?.users.total ?? 0))
const userHint = computed(() => (data.value ? `启用中 ${data.value.users.active}` : ''))

const tokenTotal = computed(() => formatNumber(data.value?.tokens.total ?? 0))
const tokenHint = computed(() => (data.value ? `启用中 ${data.value.tokens.enabled}` : ''))

const todayRequests = computed(() => formatCompact(data.value?.today.requests ?? 0))
const todayHint = computed(() => {
  const today = data.value?.today
  if (!today) return ''
  const parts = [`Token ${formatCompact(today.tokens)}`, `配额 ${formatNumber(today.quota)}`, `成功率 ${formatPercent(today.success_rate)}`]
  if (today.avg_tokens_per_second > 0) parts.push(`速率 ${formatRate(today.avg_tokens_per_second)}`)
  return parts.join(' · ')
})

/**
 * 今日用量与性能明细（卡片下方的指标格子）。
 *
 * 为什么不把这些塞进「今日请求」那张卡的 hint：成本（输入/输出/缓存）、
 * 质量（成功率）、速度（首包/速率）是三件互不相干的事，挤成一行文案既读不出
 * 对比也不好定位问题；独立格子还能在无样本时显示「—」而不是刺眼的 0。
 */
const todayMetrics = computed(() => {
  const today = data.value?.today
  if (!today) return []
  return [
    {
      label: '输入 Token',
      value: formatNumber(today.prompt_tokens),
      hint: '发往上游的提示词总量（缓存命中部分也计入其中）',
    },
    {
      label: '输出 Token',
      value: formatNumber(today.completion_tokens),
      hint: '模型生成的总量（推理 token 也计入其中）',
    },
    {
      label: '缓存命中',
      value: today.cached_tokens > 0 ? `${formatNumber(today.cached_tokens)} · ${formatPercent(today.cache_hit_rate, 1)}` : EMPTY,
      hint:
        today.cached_tokens > 0
          ? '命中上游提示词缓存的输入 token；这部分通常按更低价计费，比例越高越省钱'
          : '今日尚无上游回报的缓存命中（多数上游在未命中时不回报该字段）',
    },
    {
      label: '推理 Token',
      value: today.reasoning_tokens > 0 ? formatNumber(today.reasoning_tokens) : EMPTY,
      hint: '计入输出但不出现在回答正文里的思考 token，是「怎么扣了这么多」的主要来源',
    },
    {
      label: '平均耗时',
      value: today.avg_latency_ms > 0 ? formatLatency(Math.round(today.avg_latency_ms)) : EMPTY,
      hint: '单次请求的端到端平均耗时（含排队、上游处理与生成）',
    },
    {
      label: '平均首包',
      value: today.avg_first_token_ms > 0 ? formatLatency(Math.round(today.avg_first_token_ms)) : EMPTY,
      hint: '流式请求的首 token 平均等待（TTFB）：用户「等多久看到第一个字」；仅统计采集到的流式样本',
    },
    {
      label: '平均速率',
      value: formatRate(today.avg_tokens_per_second),
      hint: '输出速率均值（tokens/秒），已扣除首包等待，反映模型真实生成速度',
    },
  ]
})

/* ── 图表 ─────────────────────────────────────────────── */

const trendOption = computed<EChartsOption>(() => {
  const days = data.value?.recent_days ?? []
  return {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis', ...TOOLTIP_STYLE },
    legend: {
      data: ['请求数', 'Token 数'],
      right: 0,
      top: 0,
      icon: 'roundRect',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#9aa8bc', fontSize: 11 },
    },
    grid: { left: 4, right: 8, top: 36, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: days.map((item) => (item.date ? item.date.slice(5) : '')),
      axisLabel: AXIS_LABEL_STYLE,
      axisLine: AXIS_LINE_STYLE,
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '请求',
        nameTextStyle: { color: '#6f7f96', fontSize: 11 },
        axisLabel: AXIS_LABEL_STYLE,
        splitLine: SPLIT_LINE_STYLE,
      },
      {
        type: 'value',
        name: 'Token',
        nameTextStyle: { color: '#6f7f96', fontSize: 11 },
        axisLabel: AXIS_LABEL_STYLE,
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '请求数',
        type: 'bar',
        barMaxWidth: 18,
        itemStyle: { borderRadius: [4, 4, 0, 0], color: '#22d3ee' },
        data: days.map((item) => item.requests),
      },
      {
        name: 'Token 数',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2 },
        areaStyle: { color: areaGradient('#818cf8') },
        data: days.map((item) => item.tokens),
      },
    ],
  }
})

/** Top 模型：横向条形图，取前 10（再多也读不清） */
const topModelOption = computed<EChartsOption>(() => {
  const list = [...(data.value?.top_models ?? [])].slice(0, 10).reverse()
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP_STYLE },
    grid: { left: 4, right: 28, top: 8, bottom: 0, containLabel: true },
    xAxis: { type: 'value', axisLabel: AXIS_LABEL_STYLE, splitLine: SPLIT_LINE_STYLE },
    yAxis: {
      type: 'category',
      data: list.map((item) => item.model),
      axisLabel: { color: '#9aa8bc', fontSize: 11 },
      axisLine: AXIS_LINE_STYLE,
      axisTick: { show: false },
    },
    series: [
      {
        name: '请求数',
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { borderRadius: [0, 4, 4, 0], color: '#22d3ee' },
        // 用渐变强调「排名越靠前越长」，同时保持单色系克制
        data: list.map((item) => item.requests),
      },
    ],
  }
})

const hasTrend = computed(() => (data.value?.recent_days ?? []).some((item) => item.requests > 0 || item.tokens > 0))
const hasTopModels = computed(() => (data.value?.top_models ?? []).length > 0)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">仪表盘</h2>
        <p class="page-desc">渠道、用户、令牌与今日调用的整体运行情况。</p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="loadDashboard">
        <AppIcon name="refresh" :size="14" />
        刷新数据
      </button>
    </div>

    <!-- 整页错误态：本页所有数据同源，重试一次即可恢复 -->
    <div v-if="error && !loading" class="card card-pad">
      <div class="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-850 text-red-700 ring-1 ring-inset ring-red-500/25">
          <AppIcon name="alert" :size="20" />
        </span>
        <p class="text-sm text-ink-200">{{ error }}</p>
        <button type="button" class="btn btn-secondary btn-sm" @click="loadDashboard">
          <AppIcon name="refresh" :size="14" />
          重新加载
        </button>
      </div>
    </div>

    <template v-else>
      <!-- 汇总卡片 -->
      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <template v-if="loading">
          <div v-for="index in 4" :key="index" class="card card-pad">
            <div class="h-4 w-16 skeleton" />
            <div class="mt-3 h-7 w-24 skeleton" />
            <div class="mt-3 h-3 w-32 skeleton" />
          </div>
        </template>

        <template v-else>
          <StatCard label="渠道" :value="channelTotal" :hint="channelHint" icon="server" tone="brand">
            <RouterLink to="/admin/channels" class="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-700">
              渠道管理
              <AppIcon name="chevron-right" :size="12" />
            </RouterLink>
          </StatCard>

          <StatCard label="用户" :value="userTotal" :hint="userHint" icon="users" tone="ok">
            <RouterLink to="/admin/users" class="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-700">
              用户管理
              <AppIcon name="chevron-right" :size="12" />
            </RouterLink>
          </StatCard>

          <StatCard label="访问令牌" :value="tokenTotal" :hint="tokenHint" icon="key" tone="mute">
            <RouterLink to="/admin/tokens" class="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-700">
              令牌管理
              <AppIcon name="chevron-right" :size="12" />
            </RouterLink>
          </StatCard>

          <StatCard label="今日请求" :value="todayRequests" :hint="todayHint" icon="bolt" tone="warn" />
        </template>
      </section>

      <!-- 今日用量与性能：Token 构成 / 缓存命中 / 速度 -->
      <section class="mt-6 card">
        <div class="card-head">
          <div>
            <h3 class="section-title">今日用量与性能</h3>
            <p class="mt-1 text-xs text-ink-400">
              Token 构成、缓存命中与响应速度。显示「—」表示今日尚无对应样本（例如没有流式请求就没有首包数据）。
            </p>
          </div>
        </div>
        <div class="card-pad">
          <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div v-for="index in 8" :key="index" class="rounded-lg border border-ink-800 bg-ink-950/40 p-3.5">
              <div class="h-3 w-16 skeleton" />
              <div class="mt-2 h-5 w-24 skeleton" />
            </div>
          </div>
          <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div v-for="item in todayMetrics" :key="item.label" class="rounded-lg border border-ink-800 bg-ink-950/40 p-3.5">
              <p class="text-xs text-ink-400">{{ item.label }}</p>
              <p class="mt-1 truncate text-lg font-semibold text-ink-100" :title="item.hint">{{ item.value }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 趋势 -->
      <section class="mt-6 card">
        <div class="card-head">
          <div>
            <h3 class="section-title">请求趋势</h3>
            <p class="mt-1 text-xs text-ink-400">最近若干天的请求数与 Token 消耗。</p>
          </div>
        </div>
        <div class="card-pad">
          <div v-if="loading" class="flex h-[300px] items-center justify-center gap-2 text-sm text-ink-400">
            <span class="h-5 w-5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400" />
            正在加载趋势数据…
          </div>
          <EChart v-else :option="trendOption" :has-data="hasTrend" height="300px" empty-text="近期暂无调用数据" />
        </div>
      </section>

      <!-- Top 模型 -->
      <section class="mt-6 card">
        <div class="card-head">
          <div>
            <h3 class="section-title">Top 模型</h3>
            <p class="mt-1 text-xs text-ink-400">按请求数排序的前 10 个模型。</p>
          </div>
        </div>
        <div class="card-pad">
          <div v-if="loading" class="flex h-[320px] items-center justify-center text-sm text-ink-400">正在加载…</div>
          <EChart v-else :option="topModelOption" :has-data="hasTopModels" height="320px" empty-text="暂无模型调用数据" />
        </div>
      </section>
    </template>
  </div>
</template>
