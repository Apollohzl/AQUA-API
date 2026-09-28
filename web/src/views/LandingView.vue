<script setup lang="ts">
/**
 * 落地页：品牌海报（hero）+ 快速接入 + 核心能力 + 可用模型（无需登录）。
 *
 * 意图（Why）：
 *   这是对外展示的「门面」，访客在 10 秒内要能回答三个问题——
 *   「这是谁」「现在能用哪些模型」「我该怎么接」。
 *
 *   因此本页在 2026-09 做了一次结构性的重排，取向从"功能罗列"改为"品牌海报"：
 *     1) 首屏是一张满幅的深色影像（水面与折射光，呼应 AQUA），
 *        品牌名是全站最大的一行字——先回答"这是谁"，再回答"做什么"；
 *     2) 首屏只留一个主操作 + 一个次操作，其余入口降级为一行安静的文字链
 *        （此前首屏堆了四个按钮，视线无处落脚）；
 *     3) 接入示例从 hero 里搬出来，与"三步开始调用"合成同一节——
 *        此前 hero 与快速接入各有一份代码块，是同一件事说两遍；
 *     4) 核心能力从六张卡片改为一栏横排的"账本式"清单：
 *        卡片网格会把六件并列的事说得比实际重要，横排细线更克制；
 *     5) 首屏为整屏高度（.hero-viewport），顶栏叠在影像之上，
 *        滚动后顶栏才转成白底——避免"顶栏 + 内容"超出首屏。
 *
 *   更多设计取舍见 style.css 的 .hero-brand / .hero-scrim / .reveal。
 *
 * 流转（Flow）：
 *   main.ts 预取站点信息 → 本页读取 stores/site（名称/描述/版本/模型列表）
 *   → 失败时显示可重试的提示条，不阻断页面其余内容
 *
 * 扩展（Extend）：
 *   新增展示区块：在 <main> 内按「先价值后细节」的顺序插入，并给区块加 v-reveal；
 *   新增接入语言示例：在 codeSamples 追加一项（会自动多出一个 Tab）；
 *   更换 hero 影像：改 HERO_IMAGE 的 prompt 即可（遮罩在 CSS 里，
 *   与图片内容解耦，因此换任何一张图都不需要重新调遮罩）。
 *   注意：本页不放置任何本地图片资源，视觉由影像层 + CSS 网格与细线构成。
 */
import { computed, onBeforeUnmount, onMounted, ref, type Directive } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import AnnouncementBanner from '@/components/AnnouncementBanner.vue'
import CopyButton from '@/components/CopyButton.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import { type IconName } from '@/components/icons'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'

const site = useSiteStore()
const auth = useAuthStore()

/** 站点根地址：用浏览器地址而非硬编码域名，任何部署环境复制出来都能直接用 */
const baseUrl = computed(() => window.location.origin)
/** 示例里优先用站点真实开放的模型，空则给一个通用占位（避免出现 undefined） */
const sampleModel = computed(() => site.models[0] || 'gpt-4o')

/**
 * 首屏影像（真实照片锚点）。
 *
 * 为什么首屏必须要一张"真实的影像"而不是纯 CSS 渐变底纹：
 * 渐变与网格是氛围，不是主体——访客第一眼需要一个"具体的东西"，
 * 否则页面读起来像一张尚未设计的线框图。
 * 选"深色水面 + 折射光"是让影像与品牌名（AQUA）互为注解。
 *
 * 兜底：影像层之下是 hero 自带的深海底色，图片加载慢或失败时
 * 页面依然是完整可读的深色海报，不会出现破图或半个空白。
 */
const HERO_IMAGE =
  'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?image_size=landscape_16_9&prompt=' +
  encodeURIComponent(
    'aerial view of deep dark navy ocean water surface, soft caustic light refraction patterns, ' +
      'moody cinematic deep blue, minimal, high contrast, wide shot',
  )

/* ── 顶栏：滚动后从"透明叠在影像上"转为"白底" ─────────────
   为什么不做成两个顶栏（一个透明、一个白底）：那样要维护两份导航，
   且切换瞬间会闪。只切背景与文字颜色，结构始终只有一份。 */

const scrolled = ref(false)

function onScroll(): void {
  scrolled.value = window.scrollY > 24
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

/** 顶栏按钮的两种皮肤：影像上（透明底）用 invert 系列，白底上用常规系列 */
const navGhostClass = computed(() => (scrolled.value ? 'btn-ghost' : 'btn-ghost-invert'))
const navPrimaryClass = computed(() => (scrolled.value ? 'btn-primary' : 'btn-invert'))

/** 顶栏锚点：只在桌面端显示，窄屏由页面内的区块顺序承担导航 */
const anchors = [
  { href: '#quickstart', label: '快速接入' },
  { href: '#capabilities', label: '核心能力' },
  { href: '#models', label: '可用模型' },
]

/* ── 滚动进场指令（局部注册）──────────────────────────────
   为什么不做成全局指令：只有落地页这种"长页面"需要滚动节奏感，
   控制台/后台是操作界面，滚动动画只会拖慢操作。
   兜底：隐藏样式在挂载时才挂上，JS 未执行时内容默认可见；
   系统开启"减少动态效果"时直接跳过。 */

const revealObservers = new WeakMap<HTMLElement, IntersectionObserver>()

const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (reduceMotion || typeof IntersectionObserver === 'undefined') return

    el.classList.add('reveal')
    if (typeof binding.value === 'number') el.style.setProperty('--rd', `${binding.value}ms`)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('reveal-in')
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    )
    observer.observe(el)
    revealObservers.set(el, observer)
  },
  unmounted(el) {
    revealObservers.get(el)?.disconnect()
    revealObservers.delete(el)
  },
}

/* ── 首屏事实清单 ─────────────────────────────────────── */

const heroFacts = ['兼容 OpenAI 接口', '令牌级额度控制', '逐次调用留痕']

/* ── 核心能力 ─────────────────────────────────────────── */

interface Capability {
  icon: IconName
  title: string
  desc: string
}

/** 能力清单：内容与后端能力一一对应，避免出现「宣传了但没有」的功能 */
const capabilities: Capability[] = [
  {
    icon: 'server',
    title: '统一接入入口',
    desc: '自有渠道与自托管模型收敛成一个入口，客户端只需要认一套地址与协议。',
  },
  {
    icon: 'layers',
    title: 'OpenAI 协议兼容',
    desc: '对外提供 /v1/chat/completions 兼容接口，既有的 SDK、IDE 插件与脚本无需改造。',
  },
  {
    icon: 'globe',
    title: '渠道调度与容错',
    desc: '按分组、优先级与权重分配请求；渠道异常会被自动标记，降低故障对业务的影响。',
  },
  {
    icon: 'key',
    title: '令牌即权限边界',
    desc: '按人、按用途签发访问令牌，可限定可用模型、有效期与额度，随时停用或删除。',
  },
  {
    icon: 'quota',
    title: '用量可对账',
    desc: '每次调用都记录 Token 与额度消耗，后台可按天、按模型、按令牌逐条核查。',
  },
  {
    icon: 'lock',
    title: '自托管更可控',
    desc: '单二进制 + 本地数据库部署，密钥只走环境变量，请求与账目数据不出自己的机器。',
  },
]

/* ── 接入示例 ─────────────────────────────────────────── */

interface CodeSample {
  key: string
  label: string
  code: string
}

const codeSamples = computed<CodeSample[]>(() => [
  {
    key: 'curl',
    label: 'cURL',
    code: `curl ${baseUrl.value}/v1/chat/completions \\
  -H "Authorization: Bearer $AQUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sampleModel.value}",
    "messages": [{"role": "user", "content": "你好，介绍一下你自己"}],
    "stream": false
  }'`,
  },
  {
    key: 'python',
    label: 'Python SDK',
    code: `from openai import OpenAI

client = OpenAI(
    api_key="sk-...",              # 在「访问令牌」页创建
    base_url="${baseUrl.value}/v1",
)

resp = client.chat.completions.create(
    model="${sampleModel.value}",
    messages=[{"role": "user", "content": "你好，介绍一下你自己"}],
)
print(resp.choices[0].message.content)`,
  },
  {
    key: 'node',
    label: 'Node / fetch',
    code: `const res = await fetch("${baseUrl.value}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${process.env.AQUA_API_KEY}\`,
  },
  body: JSON.stringify({
    model: "${sampleModel.value}",
    messages: [{ role: "user", content: "你好，介绍一下你自己" }],
  }),
})

const data = await res.json()
console.log(data.choices[0].message.content)`,
  },
])

/** 当前选中的示例 Tab（默认 cURL：最少前置条件） */
const activeSample = ref('curl')
const currentCode = computed(() => codeSamples.value.find((item) => item.key === activeSample.value)?.code || '')

/** 登录后按钮的目标：管理员去后台，普通用户去门户 */
const consoleTarget = computed(() => (auth.isAdmin ? '/admin' : '/console'))

/** 首页最多展示的模型数：上游动辄上百个，全铺开会把页面拉得极长 */
const MODEL_PREVIEW_LIMIT = 24

/**
 * 快速接入的三步说明。
 * 用 computed 而不是写在模板里：步骤文案要引用「当前站点域名」与「真实模型名」，
 * 放在脚本里能直接用 ref，也避免模板里出现长表达式。
 */
const quickstartSteps = computed(() => [
  {
    title: '登录并创建访问令牌',
    desc: '在「访问令牌」页创建 sk- 开头的密钥，可按用途分别签发，并限定模型或有效期。',
  },
  {
    title: '把基地址指向本网关',
    desc: `基地址使用 ${baseUrl.value}/v1，请求头携带 Authorization: Bearer sk-…`,
  },
  {
    title: '按模型名发起请求',
    desc: `使用模型清单中的名称（如 ${sampleModel.value}），调用记录与用量会实时出现在后台。`,
  },
])
</script>

<template>
  <div class="min-h-screen bg-ink-950">
    <!-- 站点公告横幅：落地页也要能看到运营通知（自包含组件，无公告时不渲染）。
         放在 hero 之前而不是叠在影像上，避免公告与品牌字抢同一块注意力。 -->
    <AnnouncementBanner />

    <!-- ── 顶栏：叠在 hero 影像之上，滚动后转白底 ───────────── -->
    <header
      class="fixed inset-x-0 top-0 z-30 border-b transition-colors duration-300"
      :class="scrolled ? 'border-ink-800/70 bg-white/90' : 'border-transparent'"
    >
      <div class="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 lg:px-8">
        <RouterLink to="/" class="flex items-center gap-2.5">
          <img src="/favicon.ico" alt="" class="h-8 w-8 rounded-lg" />
          <span class="text-sm font-semibold tracking-tight" :class="scrolled ? 'text-ink-50' : 'text-white'">
            {{ site.siteName }}
          </span>
        </RouterLink>

        <nav class="ml-6 hidden items-center gap-1 md:flex">
          <a v-for="anchor in anchors" :key="anchor.href" :href="anchor.href" class="btn btn-sm" :class="navGhostClass">
            {{ anchor.label }}
          </a>
          <RouterLink to="/models" class="btn btn-sm" :class="navGhostClass">模型广场</RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <template v-if="auth.isLoggedIn">
            <RouterLink :to="consoleTarget" class="btn btn-sm" :class="navPrimaryClass">
              <AppIcon :name="auth.isAdmin ? 'shield' : 'home'" :size="15" />
              {{ auth.isAdmin ? '管理后台' : '用户门户' }}
            </RouterLink>
          </template>
          <template v-else>
            <RouterLink to="/login" class="btn btn-sm" :class="navGhostClass">登录</RouterLink>
            <RouterLink v-if="site.registrationEnabled" to="/register" class="btn btn-sm" :class="navPrimaryClass">
              注册账号
            </RouterLink>
          </template>
        </div>
      </div>
    </header>

    <main>
      <!-- ── 首屏：满幅品牌海报 ─────────────────────────────
           构成：深色水面影像 → 固定深色遮罩 → 品牌字/主张/操作。
           只保留一个主操作与一个次操作，其余入口是一行安静的文字链，
           让视线有明确的落点（见文件头注释第 2 条）。 -->
      <section class="relative isolate overflow-hidden bg-[#050e1a]">
        <!-- 影像层与遮罩层：纯装饰，对辅助技术隐藏 -->
        <div class="absolute inset-0 -z-10" aria-hidden="true">
          <img :src="HERO_IMAGE" alt="" class="h-full w-full object-cover" decoding="async" />
          <div class="hero-scrim absolute inset-0" />
          <div class="bg-grid absolute inset-0 opacity-[0.14]" />
        </div>

        <div class="hero-viewport mx-auto flex max-w-7xl flex-col justify-center px-5 pb-16 pt-28 lg:px-8 lg:pb-24 lg:pt-32">
          <div class="max-w-3xl">
            <div class="hero-reveal flex flex-wrap items-center gap-3" style="--d: 0ms">
              <span class="hero-kicker text-brand-300">
                <span class="dot" aria-hidden="true" />
                Self-hosted LLM Gateway
              </span>
              <span v-if="site.version" class="chip border-white/20 bg-white/10 text-white/80">v{{ site.version }}</span>
              <span v-if="site.models.length" class="chip border-white/20 bg-white/10 text-white/80">
                {{ site.models.length }} 个模型在线
              </span>
            </div>

            <!-- 品牌名是全站最大的一行字：先回答"这是谁" -->
            <h1 class="hero-reveal hero-brand mt-7" style="--d: 60ms">{{ site.siteName }}</h1>

            <p class="hero-reveal mt-5 font-display text-2xl font-medium leading-snug text-white/90 sm:text-3xl" style="--d: 120ms">
              一个入口，接管你所有的大模型调用
            </p>

            <p class="hero-reveal mt-5 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base" style="--d: 180ms">
              {{ site.siteDescription || '统一接入渠道与对外协议，负责路由、计费与运营，把账号、密钥、配额与账单收敛到网关内部。' }}
            </p>

            <div class="hero-reveal mt-9 flex flex-wrap items-center gap-3" style="--d: 240ms">
              <template v-if="auth.isLoggedIn">
                <RouterLink :to="consoleTarget" class="btn btn-invert">
                  <AppIcon :name="auth.isAdmin ? 'shield' : 'home'" :size="16" />
                  进入{{ auth.isAdmin ? '管理后台' : '用户门户' }}
                </RouterLink>
              </template>
              <template v-else-if="site.registrationEnabled">
                <RouterLink to="/register" class="btn btn-invert">
                  创建账号
                  <AppIcon name="chevron-right" :size="16" />
                </RouterLink>
                <RouterLink to="/login" class="btn btn-outline-invert">登录控制台</RouterLink>
              </template>
              <template v-else>
                <RouterLink to="/login" class="btn btn-invert">
                  登录控制台
                  <AppIcon name="chevron-right" :size="16" />
                </RouterLink>
              </template>
            </div>

            <!-- 三级入口：一行文字链，不再与主操作抢视觉权重 -->
            <div class="hero-reveal mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" style="--d: 260ms">
              <a href="#quickstart" class="text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
                查看接入示例
              </a>
              <RouterLink to="/models" class="text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
                完整模型清单
              </RouterLink>
              <RouterLink to="/join" class="text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
                加入交流群
              </RouterLink>
            </div>

            <ul class="hero-reveal mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60" style="--d: 320ms">
              <li v-for="fact in heroFacts" :key="fact" class="flex items-center gap-1.5">
                <AppIcon name="check" :size="15" class="text-brand-300" />
                {{ fact }}
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- ── 站点信息异常时的提示（不阻断页面）───────────────── -->
      <div v-if="site.error" class="mx-auto max-w-6xl px-5 pt-8 lg:px-8">
        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <AppIcon name="alert" :size="16" class="text-amber-700" />
          <p class="flex-1 text-sm text-amber-800">站点信息加载失败：{{ site.error }}</p>
          <button type="button" class="btn btn-secondary btn-sm" @click="site.load(true)">
            <AppIcon name="refresh" :size="14" />
            重试
          </button>
        </div>
      </div>

      <!-- ── 快速接入：三步说明 + 唯一一份代码示例 ───────────────
           hero 里不再放代码块：同一件事(怎么调用)只说一次，
           说在"快速接入"这一节，主场明确。 -->
      <section id="quickstart" class="scroll-mt-20">
        <div class="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:px-8 lg:py-28">
          <div v-reveal>
            <p class="hero-kicker text-brand-700">快速接入</p>
            <h2 class="mt-4 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
              三步开始调用
            </h2>
            <p class="mt-4 max-w-md text-sm leading-relaxed text-ink-300">
              网关只做协议与账务，业务侧继续用熟悉的 OpenAI 写法，不需要引入新的 SDK。
            </p>

            <ol class="mt-10 space-y-0">
              <li
                v-for="(step, index) in quickstartSteps"
                :key="step.title"
                class="flex gap-5 border-t border-ink-800/70 py-6"
              >
                <span class="mt-0.5 font-mono text-sm text-brand-700">{{ String(index + 1).padStart(2, '0') }}</span>
                <div>
                  <p class="text-sm font-medium text-ink-50">{{ step.title }}</p>
                  <p class="mt-1.5 text-sm leading-relaxed text-ink-400">{{ step.desc }}</p>
                </div>
              </li>
            </ol>

            <RouterLink v-if="!auth.isLoggedIn" to="/login" class="btn btn-primary mt-2">
              登录后创建令牌
              <AppIcon name="chevron-right" :size="16" />
            </RouterLink>
            <RouterLink v-else to="/console/tokens" class="btn btn-primary mt-2">
              <AppIcon name="key" :size="16" />
              我的访问令牌
            </RouterLink>
          </div>

          <div v-reveal="80" class="lg:pt-16">
            <div class="code-block shadow-panel">
              <div class="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5">
                <button
                  v-for="sample in codeSamples"
                  :key="sample.key"
                  type="button"
                  class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                  :class="
                    activeSample === sample.key
                      ? 'bg-brand-500/25 text-brand-200'
                      : 'text-[#8ba6c9] hover:bg-white/10 hover:text-white'
                  "
                  @click="activeSample = sample.key"
                >
                  {{ sample.label }}
                </button>
                <CopyButton :value="currentCode" label="复制" small class="ml-auto" success-text="示例已复制" />
              </div>
              <pre>{{ currentCode }}</pre>
            </div>

            <div class="mt-4 flex items-center gap-3 rounded-xl border border-ink-800 bg-white/70 px-4 py-3">
              <AppIcon name="lock" :size="16" class="text-brand-700" />
              <p class="text-xs leading-relaxed text-ink-400">
                访问令牌仅在创建时明文展示一次；服务端只保存摘要，可随时吊销。
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- ── 核心能力：横排账本式清单（不用卡片网格）────────────
           为什么不用卡片：六张等大的卡片会把"六件并列的事"渲染成
           六个同等重要的卖点，读者反而记不住任何一条；
           细线分栏只提供秩序，不增加重量。 -->
      <section id="capabilities" class="scroll-mt-20 border-y border-ink-800/70 bg-white/40">
        <div class="mx-auto max-w-6xl px-5 py-20 lg:px-8 lg:py-28">
          <div v-reveal class="max-w-2xl">
            <p class="hero-kicker text-brand-700">核心能力</p>
            <h2 class="mt-4 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
              该管的都管住，该接的照旧接
            </h2>
            <p class="mt-4 text-sm leading-relaxed text-ink-300">
              把「账号、密钥、配额、账单」这类运维问题收敛到网关内部，业务侧继续用熟悉的 OpenAI 协议调用。
            </p>
          </div>

          <div class="mt-12 grid gap-x-12 sm:grid-cols-2">
            <div v-for="(item, index) in capabilities" :key="item.title" v-reveal="index * 60" class="border-t border-ink-800/70 py-7">
              <div class="flex items-baseline gap-3">
                <AppIcon :name="item.icon" :size="17" class="translate-y-0.5 text-brand-600" />
                <h3 class="text-base font-semibold text-ink-50">{{ item.title }}</h3>
              </div>
              <p class="mt-2.5 pl-[29px] text-sm leading-relaxed text-ink-400">{{ item.desc }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ── 可用模型 ─────────────────────────────────────── -->
      <section id="models" class="scroll-mt-20">
        <div class="mx-auto max-w-6xl px-5 py-20 lg:px-8 lg:py-28">
          <div v-reveal class="flex flex-wrap items-end justify-between gap-6">
            <div class="max-w-xl">
              <p class="hero-kicker text-brand-700">可用模型</p>
              <h2 class="mt-4 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
                <template v-if="site.models.length">{{ site.models.length }} 个模型，共用一个入口</template>
                <template v-else>当前对外提供的模型</template>
              </h2>
              <p class="mt-4 text-sm leading-relaxed text-ink-300">
                来自所有已启用渠道声明模型的并集，随渠道配置变化实时更新。
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <RouterLink to="/models" class="btn btn-secondary btn-sm">
                <AppIcon name="grid" :size="14" />
                模型广场
              </RouterLink>
              <button type="button" class="btn btn-ghost btn-sm" :disabled="site.loading" @click="site.load(true)">
                <AppIcon name="refresh" :size="14" />
                刷新列表
              </button>
            </div>
          </div>

          <!-- 加载态：骨架块，避免布局跳动 -->
          <div v-if="site.loading && !site.models.length" class="mt-12 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="index in 9" :key="index" class="border-t border-ink-800/70 py-4">
              <div class="h-4 w-2/3 skeleton" />
            </div>
          </div>

          <!-- 空态：说明「为什么为空」并给出下一步 -->
          <div
            v-else-if="!site.models.length"
            class="mt-12 flex flex-col items-start gap-2 rounded-xl border border-dashed border-ink-700 bg-white/50 px-6 py-10"
          >
            <p class="text-sm font-medium text-ink-200">暂无可用模型</p>
            <p class="max-w-md text-xs leading-relaxed text-ink-400">
              通常是还没有添加启用状态的渠道。管理员在「渠道管理」中添加渠道后，此处会自动展示可用模型。
            </p>
          </div>

          <!-- 模型清单：细线分栏的纯文本列表。
               为什么不做成带边框的小方块：一屏几十个方框会形成"格子墙"，
               而模型名本身就是可扫读的短字符串，细线足够承担分组。 -->
          <div v-else class="mt-12">
            <ul class="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
              <li
                v-for="model in site.models.slice(0, MODEL_PREVIEW_LIMIT)"
                :key="model"
                class="flex items-center gap-2 border-t border-ink-800/70 py-3.5"
              >
                <AppIcon name="layers" :size="15" class="shrink-0 text-brand-600/70" />
                <span class="truncate font-mono text-[13px] text-ink-100" :title="model" dir="ltr">{{ model }}</span>
              </li>
            </ul>
            <p v-if="site.models.length > MODEL_PREVIEW_LIMIT" class="mt-6 text-sm text-ink-400">
              另有 {{ site.models.length - MODEL_PREVIEW_LIMIT }} 个模型同样可用（共 {{ site.models.length }} 个）。
            </p>
          </div>
        </div>
      </section>

      <!-- ── 结尾行动区：回到首屏的深色影像语言，收束全页 ──────── -->
      <section class="hero-water relative overflow-hidden border-t border-ink-800/70 bg-[#071524]">
        <div class="relative mx-auto flex max-w-6xl flex-col items-start gap-8 px-5 py-20 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-24">
          <div v-reveal>
            <p class="hero-kicker text-brand-300">
              <span class="dot" aria-hidden="true" />
              开始接入
            </p>
            <h2 class="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              把模型调用收拢到一个入口
            </h2>
            <p class="mt-4 max-w-xl text-sm leading-relaxed text-white/60">
              {{ site.registrationEnabled ? '注册即可获得账号，登录后创建你的第一个访问令牌。' : '当前站点未开放自助注册，请联系管理员开通账号。' }}
            </p>
          </div>
          <div v-reveal="80" class="flex flex-wrap gap-3">
            <RouterLink v-if="site.registrationEnabled && !auth.isLoggedIn" to="/register" class="btn btn-invert">
              立即注册
            </RouterLink>
            <RouterLink v-else-if="!auth.isLoggedIn" to="/login" class="btn btn-invert">登录控制台</RouterLink>
            <RouterLink v-else :to="consoleTarget" class="btn btn-invert">进入控制台</RouterLink>
            <RouterLink to="/join" class="btn btn-outline-invert">
              <AppIcon name="users" :size="16" />
              加入交流群
            </RouterLink>
          </div>
        </div>
      </section>
    </main>

    <!-- ── 页脚（统一合规页脚：主体 / 备案号 / 协议入口 / 服务性质声明）── -->
    <SiteFooter label="自托管 LLM API 网关" />
  </div>
</template>
