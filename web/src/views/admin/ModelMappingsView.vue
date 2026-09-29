<script setup lang="ts">
/**
 * 管理后台 · 模型映射总览：把「平台模型 ID → 上游模型 ID」的对应关系集中呈现。
 *
 * 意图（Why）：
 *   本站在用两个名字描述同一个模型，站长最容易混淆的就是这两个：
 *     平台模型 ID（对外）：用户 / SDK / IDE 插件调用时使用的名字，
 *                          也是模型广场与 /v1/models 里展示的名字；
 *     上游模型 ID        ：网关转发时【实际发给上游】的名字，只在后台可见。
 *   映射配置分散在各渠道表单里，因此需要一个"总览"页面回答三个问题：
 *     1) 我的平台一共有哪些模型 ID？（左列去重即答案）
 *     2) 每个 ID 分别被发到哪个上游、走哪个渠道与分组？
 *     3) 哪些渠道根本没配映射（模型名原样透传）？
 *
 * 流转（Flow）：
 *   进入页面 → fetchModelMappingOverview() → 映射表 + 无映射渠道表
 *   点「去配置」→ 跳转渠道管理并带上 ?edit={渠道ID}，由渠道页自动打开编辑抽屉
 *
 * 扩展（Extend）：
 *   本页只读。需要编辑映射时统一回到渠道表单（单一编辑入口，避免两处写入互相覆盖）。
 *   若将来支持在总览里就地编辑，必须复用 PUT /channels/{id}/mappings 的整组替换语义。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import DataState from '@/components/DataState.vue'
import { ApiError } from '@/api/client'
import { fetchModelMappingOverview } from '@/api/admin'
import type { ModelMappingOverviewItem, ModelMappingPlainChannel } from '@/api/types'
import { channelStatusBadgeClass, channelStatusLabel } from '@/utils/display'

const router = useRouter()

const items = ref<ModelMappingOverviewItem[]>([])
const plainChannels = ref<ModelMappingPlainChannel[]>([])
const loading = ref(true)
const error = ref('')
/** 关键词：同时匹配平台模型 ID、上游模型 ID 与渠道名，避免来回切筛选条件 */
const keyword = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchModelMappingOverview()
    items.value = data.items ?? []
    plainChannels.value = data.channels_without_mapping ?? []
  } catch (err) {
    items.value = []
    plainChannels.value = []
    error.value = err instanceof ApiError ? err.message : '模型映射总览加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** 关键词过滤后的映射行 */
const filteredItems = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return items.value
  return items.value.filter((item) =>
    [item.public_model, item.upstream_model, item.channel_name, item.group]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
})

/** 关键词过滤后的无映射渠道 */
const filteredPlainChannels = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return plainChannels.value
  return plainChannels.value.filter((channel) =>
    [channel.channel_name, channel.group].join(' ').toLowerCase().includes(needle),
  )
})

/** 去重后的平台模型 ID 数量：这是"我的平台对外提供多少个模型名"的直接答案 */
const publicModelCount = computed(() => new Set(items.value.map((item) => item.public_model)).size)

const isEmpty = computed(
  () => !loading.value && !error.value && items.value.length === 0 && plainChannels.value.length === 0,
)

const filteredEmpty = computed(
  () =>
    !loading.value &&
    !error.value &&
    keyword.value.trim() !== '' &&
    filteredItems.value.length === 0 &&
    filteredPlainChannels.value.length === 0,
)

/** 跳转到渠道管理并请求自动打开该渠道的编辑抽屉 */
function goEditChannel(channelId: number): void {
  void router.push({ name: 'admin-channels', query: { edit: String(channelId) } })
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">模型映射</h2>
        <p class="page-desc">
          平台模型 ID（用户调用时使用）与上游模型 ID（实际发给上游）的对应关系总览。
        </p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="load">
        <AppIcon name="refresh" :size="14" />
        刷新
      </button>
    </div>

    <!-- 概念说明：这段文字是本页存在的理由，缺了它站长仍然看不懂两个名字的区别 -->
    <div class="mb-4 rounded-lg border border-ink-700 bg-ink-950/40 p-3.5">
      <p class="text-sm text-ink-200">一次请求里的两个模型名：</p>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span class="chip">用户 / SDK 请求</span>
        <span class="text-ink-500">&rarr;</span>
        <span class="chip border-brand-500/40 text-brand-700">平台模型 ID（对外）</span>
        <span class="text-ink-500">&rarr;</span>
        <span class="text-ink-400">网关按映射改写</span>
        <span class="text-ink-500">&rarr;</span>
        <span class="chip">上游模型 ID（发给上游）</span>
        <span class="text-ink-500">&rarr;</span>
        <span class="chip">上游服务</span>
      </div>
      <p class="hint mt-2">
        例：客户端请求 <code>vendor/model-a</code>，上游实际收到
        <code>model-a</code>；上游回包里的模型名会被改回平台名再返回给客户端。
        <strong>没有配置映射的渠道，两个名字相同（原样透传）</strong>。
        映射在「渠道管理」的编辑表单里配置。
      </p>
    </div>

    <div class="filter-bar mb-4">
      <div class="min-w-[14rem] flex-1">
        <label class="label" for="mapping-keyword">关键词</label>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
            <AppIcon name="search" :size="15" />
          </span>
          <input
            id="mapping-keyword"
            v-model="keyword"
            class="input pl-9 input-mono"
            type="text"
            placeholder="平台模型 ID / 上游模型 ID / 渠道名"
          />
        </div>
      </div>
      <div class="flex items-end gap-4 pb-2 text-xs text-ink-300">
        <span>映射 <strong class="text-ink-100">{{ items.length }}</strong> 条</span>
        <span>平台模型 ID <strong class="text-ink-100">{{ publicModelCount }}</strong> 个</span>
        <span>无映射渠道 <strong class="text-ink-100">{{ plainChannels.length }}</strong> 个</span>
      </div>
    </div>

    <!-- 映射明细 -->
    <div class="table-wrap table-cards">
      <table class="data-table min-w-[880px]">
        <thead>
          <tr>
            <th>平台模型 ID（用户调用这个）</th>
            <th />
            <th>上游模型 ID（实际发给上游）</th>
            <th>渠道</th>
            <th>分组</th>
            <th>状态</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>

        <tbody>
          <DataState
            :loading="loading"
            :error="error"
            :empty="isEmpty || filteredEmpty"
            :colspan="7"
            loading-text="正在加载模型映射…"
            :empty-text="filteredEmpty ? '没有符合关键词的映射' : '还没有配置任何模型映射'"
            :empty-hint="
              filteredEmpty
                ? '试试换个关键词，或清空搜索框查看全部映射。'
                : '映射是可选的：不配置时模型名原样透传给上游。需要「用户用平台名、上游收上游名」时，在渠道编辑表单里添加映射。'
            "
            @retry="load"
          >
            <template #action>
              <button type="button" class="btn btn-primary btn-sm" @click="router.push({ name: 'admin-channels' })">
                <AppIcon name="plus" :size="14" />
                去渠道管理配置
              </button>
            </template>
          </DataState>

          <template v-if="!loading && !error && filteredItems.length">
            <tr v-for="item in filteredItems" :key="item.id">
              <td class="font-mono text-ink-100" data-label="平台模型 ID">
                {{ item.public_model }}
                <span v-if="!item.enabled" class="badge badge-off ms-1">已停用</span>
              </td>

              <td class="text-center text-ink-500" data-label="">&rarr;</td>

              <td class="font-mono text-ink-200" data-label="上游模型 ID">{{ item.upstream_model }}</td>

              <td class="whitespace-nowrap text-ink-200" data-label="渠道">{{ item.channel_name }}</td>

              <td data-label="分组"><span class="chip">{{ item.group }}</span></td>

              <td data-label="状态">
                <span :class="channelStatusBadgeClass(item.channel_status)">
                  {{ channelStatusLabel(item.channel_status) }}
                </span>
                <span v-if="item.channel_status !== 1" class="ms-1 text-[11px] text-amber-700">
                  渠道未启用，请求不会走这条映射
                </span>
              </td>

              <td class="cell-actions">
                <button type="button" class="btn btn-ghost btn-sm" @click="goEditChannel(item.channel_id)">
                  <AppIcon name="edit" :size="14" />
                  编辑映射
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 无映射渠道：单独一块，避免被误判成"映射丢了" -->
    <div v-if="!loading && !error && filteredPlainChannels.length" class="mt-6">
      <h3 class="mb-1 text-sm font-medium text-ink-100">未配置映射的渠道</h3>
      <p class="mb-2 text-xs text-ink-400">
        这些渠道不做任何改名：用户请求的模型名会原样发给上游。
        若上游的模型名与平台展示名不一致（例如上游叫 <code>model-a</code>、平台想展示为
        <code>vendor/model-a</code>），需要为该渠道添加映射，否则上游会返回「模型不存在」。
      </p>

      <div class="table-wrap table-cards">
        <table class="data-table min-w-[640px]">
          <thead>
            <tr>
              <th>渠道</th>
              <th>分组</th>
              <th>状态</th>
              <th class="text-right">声明的模型数</th>
              <th class="cell-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="channel in filteredPlainChannels" :key="channel.channel_id">
              <td class="text-ink-100" data-label="渠道">{{ channel.channel_name }}</td>
              <td data-label="分组"><span class="chip">{{ channel.group }}</span></td>
              <td data-label="状态">
                <span :class="channelStatusBadgeClass(channel.channel_status)">
                  {{ channelStatusLabel(channel.channel_status) }}
                </span>
              </td>
              <td class="cell-num text-ink-300" data-label="声明的模型数">
                {{ channel.model_count === 0 ? '全部模型' : channel.model_count }}
              </td>
              <td class="cell-actions">
                <button type="button" class="btn btn-ghost btn-sm" @click="goEditChannel(channel.channel_id)">
                  <AppIcon name="sliders" :size="14" />
                  去配置映射
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
