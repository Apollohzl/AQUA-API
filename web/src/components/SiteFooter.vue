<script setup lang="ts">
/**
 * 全站统一页脚（公开页面与门户/后台共用）。
 *
 * 意图（Why）：
 *   页脚是唯一"每个页面都能看到"的位置，因此合规上必须承载四件事：
 *     1) 服务由谁提供（经营主体名称）；
 *     2) 备案信息（ICP 备案号 + 公安备案号）——浏览器、微信/QQ、支付通道都会核验；
 *     3) 必备文件入口（用户协议 / 隐私政策 / 联系方式 / 投诉举报 / 安全致谢）；
 *     4) 服务性质声明（第三方接入服务、与厂商无隶属关系、AI 生成内容需自行核验）。
 *
 *   此前这些一个都没有：站点是"技术产品"，缺的正是这层经营性服务该有的外壳。
 *   统一成一个组件而不是每页各写一遍：页脚一旦分散，改动必然漏页，
 *   而"某页没有备案号"在核查时与被判定为未公示没有区别。
 *
 * 流转（Flow）：
 *   任意页面 → <SiteFooter/> → 读 stores/site 的合规信息（来自 /api/status）
 *   → 未配置的项不展示（不显示空白占位）
 *
 * 扩展（Extend）：
 *   新增必备文件页时：在下面的 links 数组加一项 + 在 router 注册路由，
 *   无需改动任何调用方。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useSiteStore } from '@/stores/site'

const props = withDefaults(
  defineProps<{
    /** 容器宽度类（与所在页面的内容宽度保持一致） */
    maxWidth?: string
    /** 页脚右上角的说明文字（如"模型广场"），默认用站点名 */
    label?: string
  }>(),
  { maxWidth: 'max-w-6xl', label: '' },
)

const site = useSiteStore()

/** 必备文件入口：合规上要求"可从任意页面直达" */
const links = [
  { to: '/terms', label: '用户协议' },
  { to: '/privacy', label: '隐私政策' },
  { to: '/contact', label: '联系方式' },
  { to: '/report', label: '投诉举报' },
  { to: '/security', label: '安全致谢' },
]

/** 备案信息：两项分别判断，避免未填时出现"ICP 备案号："这样的空标签 */
const registrations = computed(() => {
  const items: string[] = []
  if (site.icpLicense) items.push(site.icpLicense)
  if (site.policeLicense) items.push(site.policeLicense)
  return items
})

const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-ink-800/70">
    <div :class="['mx-auto flex flex-col gap-4 px-5 py-8 lg:px-8', props.maxWidth]">
      <!-- 第一行：谁在提供服务 -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <img src="/favicon.ico" alt="" class="h-6 w-6 rounded" />
          <span class="text-xs text-ink-400">
            {{ site.siteName }}
            <template v-if="site.version">· v{{ site.version }}</template>
            <template v-if="props.label">· {{ props.label }}</template>
          </span>
        </div>
        <nav class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-400">
          <RouterLink
            v-for="item in links"
            :key="item.to"
            :to="item.to"
            class="transition-colors hover:text-ink-200"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </div>

      <!-- 第二行：主体与备案（未配置的项不展示，避免出现空标签） -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
        <span v-if="site.operatorName">© {{ year }} {{ site.operatorName }}</span>
        <span v-else>© {{ year }} {{ site.siteName }}</span>
        <span v-for="item in registrations" :key="item">{{ item }}</span>
        <a
          v-if="site.contactEmail"
          :href="`mailto:${site.contactEmail}`"
          class="transition-colors hover:text-ink-300"
        >
          {{ site.contactEmail }}
        </a>
      </div>

      <!-- 第三行：服务性质声明（全站同一份文案，见 stores/site） -->
      <p class="text-xs leading-relaxed text-ink-500">{{ site.serviceNatureNotice }}</p>
    </div>
  </footer>
</template>
