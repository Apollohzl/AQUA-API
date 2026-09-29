<script setup lang="ts">
/**
 * 落地页：「深水夜航」版（2026-09-29 全站视觉重构）。
 *
 * 意图（Why）：
 *   这是对外展示的「门面」，访客在 10 秒内要能回答三个问题——
 *   「这是谁」「现在能用哪些模型」「我该怎么接」。
 *
 *   本次重写的三条设计主线：
 *     1) 背景不再用外链照片，改为【原创算法艺术】：CausticCanvas 用三组
 *        正弦干涉场实时画出"深水焦散光网"，页面从第一帧起就是活的；
 *     2) 文案全部事实化：不写"赋能/极致/领先"式广告语，只用
 *        「这是谁、有什么、怎么接」的陈述句，产品自己说话；
 *     3) 排版走"仪表 + 编辑"混合：Unbounded 几何字负责拉丁大字，
 *        中文标题回退思源宋体；数字一律等宽（tabular-nums），
 *        与焦散光、网格一起构成"水下仪器舱"的观感。
 *
 * 流转（Flow）：
 *   main.ts 预取站点信息 → 本页读取 stores/site（名称/描述/版本/模型列表）
 *   → 失败时显示可重试的提示条，不阻断页面其余内容
 *
 * 扩展（Extend）：
 *   新增展示区块：在 <main> 内按「先价值后细节」的顺序插入，并给区块加 v-reveal；
 *   新增接入语言示例：在 codeSamples 追加一项（会自动多出一个 Tab）；
 *   终端演示的剧本：改 terminalScript 数组即可，播放逻辑不用动。
 */
import { computed, onBeforeUnmount, onMounted, ref, type Directive } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import AnnouncementBanner from '@/components/AnnouncementBanner.vue'
import CausticCanvas from '@/components/CausticCanvas.vue'
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
const sampleModel = computed(() => site.models[0] || 'AQUA-CALL/deepseek-v4-flash')

/* ── 顶栏：滚动后从"透明叠在焦散场上"转为"面板底" ──────────
   只切背景与文字颜色，结构只有一份。 */
const scrolled = ref(false)

function onScroll(): void {
  scrolled.value = window.scrollY > 24
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

/** 顶栏按钮的两种皮肤：焦散场上（透明）用 invert 系列，面板底用常规系列 */
const navGhostClass = computed(() => (scrolled.value ? 'btn-ghost' : 'btn-ghost-invert'))
const navPrimaryClass = computed(() => (scrolled.value ? 'btn-primary' : 'btn-invert'))

const anchors = [
  { href: '#terminal', label: '实时链路' },
  { href: '#capabilities', label: '能力' },
  { href: '#models', label: '模型' },
]

/* ── 滚动进场指令（局部注册）──────────────────────────────
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

/* ── 首屏事实条：数字而非形容词（数据全部来自站点信息接口）── */
const heroStats = computed(() => {
  const items: { value: string; label: string }[] = []
  if (site.models.length) items.push({ value: String(site.models.length), label: '模型在线' })
  items.push({ value: '3', label: '协议族 OpenAI / Anthropic / Gemini' })
  items.push({ value: '24×7', label: '自托管进程常驻' })
  return items
})

/* ── 核心能力：账本式清单（内容与后端能力一一对应）────────── */
interface Capability {
  icon: IconName
  title: string
  desc: string
  metric: string
}

const capabilities: Capability[] = [
  {
    icon: 'layers',
    title: '一个入口，三套协议',
    desc: 'OpenAI / Anthropic / Gemini 协议互转，既有 SDK、CLI 与 IDE 插件不用改一行代码。',
    metric: '3 protocol',
  },
  {
    icon: 'globe',
    title: '渠道调度与容错',
    desc: '按分组、权重与优先级分流；凭据失败自动冷却、半开恢复，故障不传染。',
    metric: '79 channel type',
  },
  {
    icon: 'key',
    title: '令牌即权限边界',
    desc: '按人、按用途签发访问令牌，可限定模型、有效期与额度，随时停用。',
    metric: 'per-token',
  },
  {
    icon: 'quota',
    title: '每一笔都可对账',
    desc: '预扣 → 结算 → 退还三段式记账，并发不透支；调用日志逐条留痕。',
    metric: 'ledger',
  },
  {
    icon: 'lock',
    title: '密钥不出机器',
    desc: '上游密钥 AES-256-GCM 加密落库，主密钥只从环境变量注入，后台也看不到明文。',
    metric: 'AES-256',
  },
  {
    icon: 'server',
    title: '单二进制交付',
    desc: '零 CGO、前端内嵌，一条命令拉起完整网关；SQLite 落地，数据跟着目录走。',
    metric: '1 binary',
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
    "stream": true
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
    key: 'claude',
    label: 'Claude Code',
    code: `# AQUA-API 原生支持 Anthropic 协议，可直接接管 Claude Code：
export ANTHROPIC_BASE_URL=${baseUrl.value}
export ANTHROPIC_AUTH_TOKEN=sk-你的令牌
claude`,
  },
])

/** 当前选中的示例 Tab（默认 cURL：最少前置条件） */
const activeSample = ref('curl')
const currentCode = computed(() => codeSamples.value.find((item) => item.key === activeSample.value)?.code || '')

/** 登录后按钮的目标：管理员去后台，普通用户去门户 */
const consoleTarget = computed(() => (auth.isAdmin ? '/admin' : '/console'))

/** 本页最多展示的模型数：上游动辄上百个，全铺开会把页面拉得极长 */
const MODEL_PREVIEW_LIMIT = 24

/* ── 实时链路终端：把"一次流式调用"演给访客看 ───────────────
 *
 * 为什么值得做：目标用户是开发者，"网关是什么"解释三句不如
 * 播一段真实形态的 SSE 流；它同时演示了基地址、鉴权头、
 * 模型名与返回结构，是"接入文档"的前置预览。
 *
 * 实现：剧本 = 一段开场命令 + 若干"词元"，逐词打出，
 * 停顿随机抖动模拟网络节奏；播完静默两秒重新开始。
 * reduce-motion 时只播一遍（不循环、不打字，整段直接展示）。 */
const terminalLines = ref<string[]>([])
let terminalTimer: number | undefined

const STREAM_TOKENS = [
  '流式', '响应', '按', '词元', '送达', '——', '首字', '延迟', '决定', '体感，',
  '计量', '以', '最终', '帧', '为准，', '中断', '即', '退款。',
  '\u200b',
  'route:  nvidia/nemotron-70b   ·   812 tok   ·   214 ms',
]

function playTerminal(): void {
  const head = `$ curl ${baseUrl.value}/v1/chat/completions -H "Authorization: Bearer sk-aqua-…" -d '{"model":"${sampleModel.value}","stream":true}'`
  const full = [head, '', ...STREAM_TOKENS]
  terminalLines.value = []
  let i = 0
  const step = (): void => {
    if (i < full.length) {
      terminalLines.value.push(full[i])
      i += 1
      // 指令行停顿长（像"等上游"），词元停顿短（像"在生成"）
      const delay = i <= 1 ? 700 : full[i - 1].length > 30 ? 90 : 140 + Math.random() * 120
      terminalTimer = window.setTimeout(step, delay)
    } else {
      terminalTimer = window.setTimeout(() => {
        i = 0
        terminalLines.value = []
        step()
      }, 2600)
    }
  }
  step()
}

onMounted(() => {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  if (reduceMotion) {
    // 静态展示完整剧本，不做打字循环
    terminalLines.value = [
      `$ curl ${baseUrl.value}/v1/chat/completions -H "Authorization: Bearer sk-aqua-…" -d '{"model":"${sampleModel.value}","stream":true}'`,
      '',
      ...STREAM_TOKENS,
    ]
    return
  }
  playTerminal()
})

onBeforeUnmount(() => {
  if (terminalTimer !== undefined) window.clearTimeout(terminalTimer)
})

/** 站点信息加载失败时，至少保证落地页可看（提示条给出重试入口） */
function reloadSite(): void {
  void site.load(true)
}
</script>

<template>
  <div class="relative min-h-screen bg-ink-950 text-ink-100">
    <!-- 站点公告横幅：落地页也要能看到运营通知（自包含组件，无公告时不渲染） -->
    <AnnouncementBanner />

    <!-- ── 顶栏：叠在焦散场上，滚动后转面板底 ───────────────── -->
    <header
      class="fixed inset-x-0 top-0 z-30 border-b transition-colors duration-300"
      :class="scrolled ? 'border-ink-700/70 bg-ink-950/90' : 'border-transparent'"
    >
      <div class="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 lg:px-8">
        <RouterLink to="/" class="flex items-center gap-2.5">
          <img src="/favicon.ico" alt="" class="h-8 w-8 rounded-lg" />
          <span
            class="font-display text-sm font-semibold tracking-tight"
            :class="scrolled ? 'text-ink-50' : 'text-white'"
          >
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
      <!-- ── 首屏：深水焦散场 ──────────────────────────────────
           背景是本页的"工艺"核心：三组正弦波干涉出光网（算法艺术，
           非图片），叠加仪表网格与底部渐隐遮罩。 -->
      <section class="relative isolate overflow-hidden bg-ink-950">
        <div class="absolute inset-0 -z-10" aria-hidden="true">
          <CausticCanvas :intensity="1" :speed="1" :hue="215" />
          <div class="bg-grid absolute inset-0 opacity-60" />
          <!-- 底部渐隐：把焦散场"沉"进页面底色，避免硬边 -->
          <div
            class="absolute inset-0"
            style="background: linear-gradient(to top, #050d19 4%, rgba(5,13,25,0.4) 32%, rgba(5,13,25,0) 60%)"
          />
        </div>

        <div class="hero-viewport mx-auto flex max-w-7xl flex-col justify-center px-5 pb-16 pt-28 lg:px-8 lg:pb-24 lg:pt-32">
          <div class="max-w-3xl">
            <div class="hero-reveal flex flex-wrap items-center gap-3" style="--d: 0ms">
              <span class="hero-kicker text-brand-300">
                <span class="dot animate-pulse-soft !bg-brand-400" aria-hidden="true" />
                Self-hosted LLM Gateway
              </span>
              <span v-if="site.version" class="chip border-white/15 bg-white/5 text-white/75">v{{ site.version }}</span>
            </div>

            <!-- 品牌名：Unbounded 几何字，全站最大的一行字 -->
            <h1 class="hero-reveal hero-brand mt-7" style="--d: 60ms">{{ site.siteName }}</h1>

            <!-- 副题用衬线（中文回退思源宋体），陈述而非口号 -->
            <p
              class="hero-reveal mt-5 font-display text-2xl font-medium leading-snug text-white/90 sm:text-3xl"
              style="--d: 120ms"
            >
              把每一次模型调用，都收进<span class="text-gradient-brand">同一个入口</span>。
            </p>

            <p class="hero-reveal mt-5 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base" style="--d: 180ms">
              {{ site.siteDescription ||
                '统一接入渠道与对外协议，负责路由、计费与运营，把账号、密钥、配额与账单收敛到网关内部。' }}
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

            <!-- 三级入口：一行文字链 -->
            <div class="hero-reveal mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" style="--d: 260ms">
              <a href="#terminal" class="text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
                看一次流式调用
              </a>
              <RouterLink to="/models" class="text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
                完整模型清单
              </RouterLink>
              <RouterLink to="/join" class="text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
                加入交流群
              </RouterLink>
            </div>
          </div>

          <!-- 事实条：数字而非形容词，贴在 hero 底部像一行仪表读数 -->
          <dl
            class="hero-reveal mt-14 flex flex-wrap items-end gap-x-12 gap-y-6 border-t border-white/10 pt-6"
            style="--d: 320ms"
            aria-label="站点数据"
          >
            <div v-for="stat in heroStats" :key="stat.label">
              <dt class="text-xs text-white/50">{{ stat.label }}</dt>
              <dd class="mt-1 font-display text-2xl font-semibold tabular-nums text-white sm:text-3xl">
                {{ stat.value }}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- ── 站点信息异常提示（不阻断页面）─────────────────────── -->
      <div v-if="site.error" class="mx-auto max-w-6xl px-5 pt-8 lg:px-8">
        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <AppIcon name="alert" :size="16" class="text-amber-600" />
          <p class="flex-1 text-sm text-amber-700">站点信息加载失败：{{ site.error }}</p>
          <button type="button" class="btn btn-secondary btn-sm" @click="reloadSite">
            <AppIcon name="refresh" :size="14" />
            重试
          </button>
        </div>
      </div>

      <!-- ── 实时链路：终端演示 + 三步接入 ────────────────────────
           左边"演给你看"，右边"教你怎么接"：开发者看一眼终端
           就知道请求长什么样，三步清单回答"接下来做什么"。 -->
      <section id="terminal" class="relative mx-auto max-w-7xl scroll-mt-24 px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Live Route</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            一次流式调用，长这样
          </h2>
          <p class="mt-3 text-sm leading-relaxed text-ink-300">
            基地址指向本网关，请求头带访问令牌，其余与官方接口一致。下面是真实协议形态的回放。
          </p>
        </div>

        <div class="mt-10 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <!-- 终端：深色块 + 顶部状态灯，逐行"生成" -->
          <div v-reveal class="code-block shadow-pop">
            <div class="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
              <span class="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span class="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span class="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <span class="ms-2 font-mono text-[11px] tracking-wider text-white/40">gateway — stream</span>
              <span class="ms-auto flex items-center gap-1.5 font-mono text-[11px] text-emerald-600">
                <span class="dot !bg-emerald-500 animate-pulse-soft" aria-hidden="true" />
                online
              </span>
            </div>
            <pre
              class="min-h-[240px] font-mono text-[13px] leading-relaxed"
              dir="ltr"
            ><span v-for="(line, i) in terminalLines" :key="i" :class="i === 0 ? 'text-brand-300' : 'text-[#d5e2f2]'">{{ line }}{{ i === terminalLines.length - 1 ? '▌' : '\n' }}</span></pre>
          </div>

          <!-- 三步接入：编号账本式，数字用 Unbounded -->
          <ol v-reveal="80" class="space-y-5">
            <li class="flex gap-4">
              <span class="font-display text-2xl font-semibold text-brand-500/80">01</span>
              <div>
                <p class="text-sm font-semibold text-ink-50">登录并创建访问令牌</p>
                <p class="mt-1 text-xs leading-relaxed text-ink-300">
                  在「访问令牌」页创建 sk- 开头的密钥，可按用途分别签发，并限定模型或有效期。
                </p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="font-display text-2xl font-semibold text-brand-500/80">02</span>
              <div>
                <p class="text-sm font-semibold text-ink-50">把基地址指向本网关</p>
                <p class="mt-1 break-all font-mono text-xs leading-relaxed text-ink-300">
                  {{ baseUrl }}/v1
                </p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="font-display text-2xl font-semibold text-brand-500/80">03</span>
              <div>
                <p class="text-sm font-semibold text-ink-50">按模型名发起请求</p>
                <p class="mt-1 text-xs leading-relaxed text-ink-300">
                  使用模型清单中的名称（如 <span class="font-mono text-brand-700">{{ sampleModel }}</span>），
                  调用记录与用量实时出现在后台。
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <!-- ── 能力矩阵 ──────────────────────────────────────────
           账本式：一行一个事实 + 右侧等宽小标记，不做"六张等大卡片"
           的均质网格（那会把六件并列的事说得比实际更重要）。 -->
      <section id="capabilities" class="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Capabilities</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            网关该管的事，都在这
          </h2>
        </div>

        <ul class="mt-10 divide-y divide-ink-700/60 border-y border-ink-700/60">
          <li
            v-for="cap in capabilities"
            :key="cap.title"
            v-reveal
            class="group grid gap-3 py-6 transition-colors duration-200 hover:bg-brand-500/[0.04] sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6 sm:px-4"
          >
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ink-700 bg-ink-900 text-brand-300 transition-colors group-hover:border-brand-500/40 group-hover:text-brand-300"
            >
              <AppIcon :name="cap.icon" :size="20" />
            </span>
            <div>
              <p class="text-sm font-semibold text-ink-50">{{ cap.title }}</p>
              <p class="mt-1 max-w-2xl text-xs leading-relaxed text-ink-300 sm:text-sm">{{ cap.desc }}</p>
            </div>
            <span class="font-mono text-xs tabular-nums text-brand-700/80">{{ cap.metric }}</span>
          </li>
        </ul>
      </section>

      <!-- ── 接入示例：代码页签 ─────────────────────────────────── -->
      <section class="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Quickstart</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            复制即用
          </h2>
        </div>

        <div v-reveal class="card mt-8 overflow-hidden" dir="ltr">
          <div class="flex items-center justify-between border-b border-ink-700/70 bg-ink-850/80 px-2 py-1.5">
            <div class="seg border-0 bg-transparent p-0">
              <button
                v-for="sample in codeSamples"
                :key="sample.key"
                type="button"
                class="seg-item"
                :class="activeSample === sample.key ? 'seg-item-active' : ''"
                @click="activeSample = sample.key"
              >
                {{ sample.label }}
              </button>
            </div>
            <CopyButton :value="currentCode" class="btn-row" />
          </div>
          <pre class="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed text-ink-100">{{ currentCode }}</pre>
        </div>

        <p v-reveal class="mt-4 text-xs leading-relaxed text-ink-400">
          任何 OpenAI 兼容客户端（Cursor、Codex CLI、Cherry Studio、LobeChat 等）选择「自定义 OpenAI 接口」，
          填入上面的基地址与令牌即可。
        </p>
      </section>

      <!-- ── 模型预览：等宽芯片墙 ──────────────────────────────── -->
      <section id="models" class="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Models</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            现在就能调用的模型
          </h2>
          <p class="mt-3 text-sm leading-relaxed text-ink-300">
            清单实时来自启用中的渠道；价格与可用性以
            <RouterLink to="/models" class="text-brand-700 underline-offset-4 hover:underline">模型广场</RouterLink>
            为准。
          </p>
        </div>

        <div v-reveal class="mt-8 flex flex-wrap gap-2">
          <span
            v-for="name in site.models.slice(0, MODEL_PREVIEW_LIMIT)"
            :key="name"
            class="chip border-ink-700 bg-ink-900/80 font-mono text-xs text-ink-200"
          >
            {{ name }}
          </span>
        </div>

        <div v-if="site.models.length > MODEL_PREVIEW_LIMIT" v-reveal class="mt-5">
          <RouterLink to="/models" class="btn btn-secondary btn-sm">
            查看全部 {{ site.models.length }} 个模型
            <AppIcon name="chevron-right" :size="14" />
          </RouterLink>
        </div>
      </section>

      <!-- ── 尾部行动区：一句话 + 两个操作，克制收束 ─────────────── -->
      <section class="hero-water relative mx-auto max-w-7xl px-5 pb-24 pt-8 lg:px-8">
        <div v-reveal class="relative overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-900/70 px-6 py-14 text-center sm:px-12">
          <div class="bg-grid absolute inset-0 opacity-40" aria-hidden="true" />
          <div class="relative">
            <h2 class="font-display text-2xl font-semibold tracking-tight text-ink-50 sm:text-3xl">
              拿到令牌，第一行代码就能跑。
            </h2>
            <p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-300">
              注册、建令牌、指向基地址——三步之后，用量与账单都会留在这台属于你的网关里。
            </p>
            <div class="mt-7 flex flex-wrap items-center justify-center gap-3">
              <template v-if="auth.isLoggedIn">
                <RouterLink :to="consoleTarget" class="btn btn-primary">
                  进入控制台
                  <AppIcon name="chevron-right" :size="16" />
                </RouterLink>
              </template>
              <template v-else>
                <RouterLink v-if="site.registrationEnabled" to="/register" class="btn btn-primary">
                  创建账号
                  <AppIcon name="chevron-right" :size="16" />
                </RouterLink>
                <RouterLink to="/login" class="btn btn-secondary">登录控制台</RouterLink>
              </template>
            </div>
          </div>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
