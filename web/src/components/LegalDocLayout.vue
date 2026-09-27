<script setup lang="ts">
/**
 * 合规文档页的统一外壳（用户协议 / 隐私政策 / 充值退款 / 联系方式 / 投诉举报共用）。
 *
 * 意图（Why）：
 *   这五份文件在版式上完全一致（公开页头 + 标题区 + 正文 + 统一页脚），
 *   差别只在正文。若每页各写一遍页头页脚，改一次导航就要改五处，必然漏页；
 *   而"某一页缺少备案号或返回入口"在核查时与被判定为未公示没有区别。
 *
 * 流转（Flow）：
 *   各文档页 → <LegalDocLayout title=... description=...> 正文 </LegalDocLayout>
 *
 * 扩展（Extend）：
 *   新增一份文件页：复制任一文档页的骨架 + 在 router 注册路由 +
 *   在 components/SiteFooter.vue 的 links 里加入口。
 */
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'

const props = defineProps<{
  /** 页面标题（如「用户协议」） */
  title: string
  /** 标题下方的一句话说明 */
  description?: string
  /** 生效/更新日期（人工维护，便于用户判断版本新旧） */
  updatedAt?: string
}>()

const site = useSiteStore()
const auth = useAuthStore()

const consoleTarget = computed(() => (auth.isAdmin ? { name: 'admin-dashboard' } : { name: 'console-overview' }))

onMounted(() => {
  void site.load()
})
</script>

<template>
  <div class="app-ambient min-h-screen">
    <!-- ── 页头（与"加入交流群""模型广场"等公开页保持一致）────── -->
    <header class="sticky top-0 z-20 border-b border-ink-800/70 bg-white/90">
      <div class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-5 py-3 lg:px-8">
        <RouterLink to="/" class="flex items-center gap-2.5">
          <img src="/favicon.ico" alt="" class="h-8 w-8 rounded-lg" />
          <span class="text-sm font-semibold text-ink-50">{{ site.siteName }}</span>
        </RouterLink>

        <nav class="ml-3 hidden items-center gap-1 md:flex">
          <RouterLink to="/" class="btn btn-ghost btn-sm">首页</RouterLink>
          <RouterLink to="/models" class="btn btn-ghost btn-sm">模型广场</RouterLink>
          <RouterLink to="/join" class="btn btn-ghost btn-sm">加入交流群</RouterLink>
          <RouterLink v-if="auth.isLoggedIn" :to="consoleTarget" class="btn btn-ghost btn-sm">控制台</RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <RouterLink v-if="!auth.isLoggedIn" to="/login" class="btn btn-ghost btn-sm">登录</RouterLink>
          <RouterLink v-else :to="consoleTarget" class="btn btn-primary btn-sm">
            <AppIcon :name="auth.isAdmin ? 'shield' : 'home'" :size="15" />
            {{ auth.isAdmin ? '管理后台' : '用户门户' }}
          </RouterLink>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-5 py-10 lg:px-8">
      <div class="page-head">
        <div>
          <h1 class="page-title text-2xl">{{ props.title }}</h1>
          <p v-if="props.description" class="page-desc">{{ props.description }}</p>
          <p v-if="props.updatedAt" class="mt-2 text-xs text-ink-500">更新日期：{{ props.updatedAt }}</p>
        </div>
      </div>

      <article class="space-y-6 text-sm leading-relaxed text-ink-300">
        <slot />
      </article>
    </main>

    <SiteFooter :max-width="'max-w-3xl'" />
  </div>
</template>
