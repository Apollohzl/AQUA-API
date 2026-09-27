<script setup lang="ts">
/**
 * 加入交流群（公开页，无需登录）。
 *
 * 意图（Why）：
 *   落地页只有一个"加入交流群"按钮的位置，放不下"哪几个群、群号多少、
 *   哪个是主群、满了怎么办"这些必要信息；直接把链接挂在按钮上又会让
 *   访客在不知情的情况下被唤起 QQ。
 *   因此单独一页：先把选择讲清楚，再由访客自己点某个群的入群链接。
 *
 * 流转（Flow）：
 *   落地页「加入交流群」按钮 → /join → 本页列出各群卡片
 *   → 点「加入此群」用新标签打开 qm.qq.com 入群链接（唤起 QQ）
 *
 * 扩展（Extend）：
 *   换群 / 增删群只改下面 GROUPS 数组；若要改成后台可配置，需把该数组迁到
 *   站点设置（setting key → /api/status → site store），落点与字段见 docs/06。
 */
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import CopyButton from '@/components/CopyButton.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'

/**
 * QQ 交流群清单。
 *
 * 为什么写死在前端而不是做成后台配置：这是低频运营信息（几个月才可能动一次），
 * 而做成后台可配置要动设置表键、SiteStatus、后台表单等 6 处，成本远超收益。
 * 群扩容/换群时改这里即可。
 *
 * 数组顺序 = 推荐优先级：访客从上往下依次尝试（一群满了再去二群）。
 */
const GROUPS = [
  {
    name: 'AQUA开源项目交流群',
    number: '1103667832',
    capacity: 1000,
    url: 'https://qm.qq.com/q/dxMcNHuPXG',
    primary: true,
    hint: '主群：提问、反馈与日常交流优先来这里。',
  },
  {
    name: 'AQUA开源项目交流二群',
    number: '1006740220',
    capacity: 500,
    url: 'https://qm.qq.com/q/SSsPM510sM',
    primary: false,
    hint: '备用群：主群满员时加这个，群内信息与主群同步。',
  },
]

const site = useSiteStore()
const auth = useAuthStore()

const consoleTarget = computed(() => (auth.isAdmin ? { name: 'admin-dashboard' } : { name: 'console-overview' }))

/** 总容量：用于在页头直接告诉访客"一共有多少人可入"，减少"是不是已经满了"的犹豫。 */
const totalCapacity = computed(() => GROUPS.reduce((sum, group) => sum + group.capacity, 0))

onMounted(() => {
  void site.load()
})
</script>

<template>
  <div class="app-ambient min-h-screen">
    <!-- ── 页头 ─────────────────────────────────────────── -->
    <header class="sticky top-0 z-20 border-b border-ink-800/70 bg-white/90">
      <div class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-5 py-3 lg:px-8">
        <RouterLink to="/" class="flex items-center gap-2.5">
          <img src="/favicon.ico" alt="" class="h-8 w-8 rounded-lg" />
          <span class="text-sm font-semibold text-ink-50">{{ site.siteName }}</span>
        </RouterLink>

        <nav class="ml-3 hidden items-center gap-1 md:flex">
          <RouterLink to="/" class="btn btn-ghost btn-sm">首页</RouterLink>
          <RouterLink to="/models" class="btn btn-ghost btn-sm">模型广场</RouterLink>
          <RouterLink to="/join" class="btn btn-ghost btn-sm text-brand-700">加入交流群</RouterLink>
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

    <main class="mx-auto max-w-6xl px-5 py-8 lg:px-8">
      <!-- ── 标题区 ─────────────────────────────────────── -->
      <div class="page-head">
        <div class="max-w-2xl">
          <h1 class="page-title text-2xl">
            加入<span class="text-gradient-brand">交流群</span>
          </h1>
          <p class="page-desc">
            使用中遇到问题、想了解最新模型与价格、或希望参与项目建设，欢迎加入 QQ 群。
            点击下面的「加入此群」会打开 QQ 入群页面并自动带出群号，无需手动搜索。
          </p>
        </div>
        <div class="toolbar">
          <span class="chip">
            <AppIcon name="users" :size="13" />
            共 {{ GROUPS.length }} 个群 · {{ totalCapacity }} 个名额
          </span>
        </div>
      </div>

      <!-- ── 群卡片 ─────────────────────────────────────── -->
      <div class="grid gap-5 md:grid-cols-2">
        <article v-for="group in GROUPS" :key="group.number" class="card card-pad flex flex-col">
          <div class="flex flex-wrap items-center gap-2">
            <span :class="group.primary ? 'badge badge-ok' : 'badge badge-info'">
              <span class="dot" />
              {{ group.primary ? '主群' : '备用群' }}
            </span>
            <span class="chip">QQ 群</span>
            <span class="chip">上限 {{ group.capacity }} 人</span>
          </div>

          <h2 class="mt-4 text-base font-semibold text-ink-50">{{ group.name }}</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-ink-400">{{ group.hint }}</p>

          <dl class="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div class="flex items-center gap-2">
              <dt class="text-ink-500">群号</dt>
              <dd class="font-mono text-ink-100">{{ group.number }}</dd>
            </div>
          </dl>

          <!-- mt-auto：两张卡片按钮底部对齐（说明文案长短不一时不歪） -->
          <div class="mt-auto flex flex-wrap items-center gap-2 pt-5">
            <!-- 外链必须 target="_blank" + rel="noopener"：入群链接会把页面交给 QQ，
                 新标签打开才不会让访客丢失本站（且 noopener 防止新页面反向操作本站）。 -->
            <a :href="group.url" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
              <AppIcon name="external" :size="15" />
              加入此群
            </a>
            <CopyButton :value="group.number" label="复制群号" outline small />
          </div>
        </article>
      </div>

      <!-- ── 入群后怎么问 ───────────────────────────────── -->
      <section class="mt-8 card card-pad">
        <h2 class="section-title flex items-center gap-2">
          <AppIcon name="info" :size="16" class="text-brand-700" />
          提问建议
        </h2>
        <ul class="mt-3 space-y-2 text-sm leading-relaxed text-ink-300">
          <li>1. 先说明你在做什么（调哪个模型、走哪个分组），再贴报错，别只发「用不了」。</li>
          <li>
            2. 报错请贴完整原文（含 HTTP 状态码与错误信息），截断的关键字往往正是原因所在。
          </li>
          <li>
            3. 涉及计费请附「模型名 + 出错时间（精确到分钟）」：在控制台的
            「调用日志」页可以自行查到那一次的输入/输出 token 与扣费金额，
            带上这些数据才能对上账。
          </li>
          <li>4. 群内请勿发送访问令牌、账号密码等敏感信息；令牌泄露请立刻在令牌页删除重建。</li>
        </ul>
      </section>
    </main>

    <!-- 统一合规页脚（主体 / 备案号 / 协议入口 / 服务性质声明） -->
    <SiteFooter label="加入交流群" />
  </div>
</template>
