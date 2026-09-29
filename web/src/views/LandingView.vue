<script setup lang="ts">
/**
 * 落地页：「白昼工程」亮色版（2026-09-30 依站长反馈回炉重做）。
 *
 * 意图（Why）：
 *   这是对外展示的「门面」，访客在 10 秒内要能回答三个问题——
 *   「这是谁」「现在能用哪些模型」「我该怎么接」。
 *
 *   上一版被指"太花里胡哨、页面元素太少"，因此本次重写的三条主线：
 *     1) 亮色干净：极浅冷白底 + 纯白卡片 + 细描边，装饰只保留
 *        细网格与极淡光晕（纯 CSS，无 canvas 动画）；
 *     2) 内容做厚：区块从 6 个扩到 11 个——hero 事实条 / 终端演示
 *        + 三步 / 能力账本 / 适用场景 / 接入示例 / 技术规格表 /
 *        模型墙 / 常见问题 / 开源与社区 / 尾部行动区。信息密度
 *        上去了，访客能"往下读"，而不是一眼望到底；
 *     3) 文案事实化：不写"赋能/极致"式广告语，区块里全是
 *        「是什么、有什么、怎么接」的陈述句。
 *
 * 流转（Flow）：
 *   main.ts 预取站点信息 → 本页读取 stores/site（名称/描述/版本/模型列表）
 *   → 失败时显示可重试的提示条，不阻断页面其余内容
 *
 * 扩展（Extend）：
 *   新增展示区块：在 <main> 内按「先价值后细节」的顺序插入，并给区块加 v-reveal；
 *   新增接入语言示例：在 codeSamples 追加一项（会自动多出一个 Tab）；
 *   终端演示剧本 / FAQ / 规格表：改对应数组即可，播放与渲染逻辑不用动。
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
const sampleModel = computed(() => site.models[0] || 'AQUA-CALL/deepseek-v4-flash')

/* ── 顶栏：滚动后从"透明叠在 hero 上"转为"白底" ──────────────
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

/** 顶栏按钮的两种皮肤：hero 上（透明）用 invert 系列，白底用常规系列 */
const navGhostClass = computed(() => (scrolled.value ? 'btn-ghost' : 'btn-ghost-invert'))
const navPrimaryClass = computed(() => (scrolled.value ? 'btn-primary' : 'btn-invert'))

const anchors = [
  { href: '#terminal', label: '快速接入' },
  { href: '#capabilities', label: '能力' },
  { href: '#faq', label: '常见问题' },
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

/* ── 首屏事实条：数字而非形容词（数据来自站点信息接口）────── */
const heroStats = computed(() => {
  const items: { value: string; label: string }[] = []
  if (site.models.length) items.push({ value: String(site.models.length), label: '模型在线' })
  items.push({ value: '3', label: '协议族 OpenAI / Anthropic / Gemini' })
  items.push({ value: '79', label: '上游渠道类型' })
  items.push({ value: '1', label: '单二进制交付' })
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

/* ── 适用场景：三类人群各说一句实在话 ─────────────────────── */
const scenarios = [
  {
    icon: 'home' as IconName,
    title: '个人自建出口',
    desc: '手里有官方 Key、订阅号或免费额度，散在各处不好管。收进一个入口后，客户端只认一个地址，额度与用量一目了然。',
  },
  {
    icon: 'users' as IconName,
    title: '团队统一管理',
    desc: '给每个成员、每个项目发独立令牌，可限定模型与额度；谁的调用量异常、哪条渠道故障，后台直接可见。',
  },
  {
    icon: 'book' as IconName,
    title: '学习与实验',
    desc: '本地 Ollama、各家免费模型、开放权重服务，统统接到同一套 OpenAI 兼容接口上做对比与实验。',
  },
]

/* ── 技术规格表：工程信息，一表说清 ─────────────────────── */
const specs = [
  { label: '下游协议', value: 'OpenAI 兼容 / Anthropic / Gemini（含流式与工具调用）' },
  { label: '上游类型', value: 'OpenAI 兼容、Azure OpenAI、Anthropic、Gemini 等 79 种渠道类型' },
  { label: '计费方式', value: '按量（输入 / 输出 / 缓存分价）与按次两种口径，支持分组倍率' },
  { label: '数据存储', value: 'SQLite 单文件，数据库迁移随启动自动执行' },
  { label: '部署形态', value: '单二进制（零 CGO）或 Docker，前端已内嵌，升级替换文件即可' },
  { label: '密钥安全', value: 'AES-256-GCM 加密落库，主密钥仅环境变量注入，日志不输出密钥' },
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

/* ── 常见问题：自问自答，答的是事实 ───────────────────────── */
const faqs = [
  {
    q: '和直接调用官方接口有什么区别？',
    a: '直接调用需要每个客户端分别配 Key、地址与额度；接到本网关后，客户端只认一个地址与令牌，路由、计费、日志与额度管控都在网关侧完成，换渠道不用改客户端。',
  },
  {
    q: '我的数据存在哪里？',
    a: 'SQLite 单文件数据库，随部署目录走，不上传任何外部服务；上游密钥加密落库，主密钥只从环境变量注入，后台界面也只能看到掩码。',
  },
  {
    q: '忘记密码或用户名怎么办？',
    a: '登录页提供两种自助通道：用绑定邮箱收验证码直接登录，或用验证码重置密码；重置成功后所有旧登录状态会自动失效。',
  },
  {
    q: '支持哪些客户端？',
    a: '任何 OpenAI 兼容客户端都可以（Cursor、Claude Code、Codex CLI、Cherry Studio、LobeChat、沉浸式翻译等）；Claude / Gemini 原生协议客户端也可以直连。',
  },
]

/** FAQ 手风琴：同时只开一条，避免"全展开"把页面拉得太长 */
const openFaq = ref(0)
function toggleFaq(index: number): void {
  openFaq.value = openFaq.value === index ? -1 : index
}

/* ── 实时链路终端：把"一次流式调用"演给访客看 ───────────────
 *
 * 为什么值得做：目标用户是开发者，"网关是什么"解释三句不如
 * 播一段真实形态的 SSE 流。它是浅色页面里唯一的深色块
 * （编辑排版的"聚光灯"手法），也是本页唯一保留的动效。
 *
 * 实现：剧本逐词打出，停顿随机抖动模拟网络节奏；播完静默几秒
 * 重新开始。reduce-motion 时整段直接静态展示。 */
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

    <!-- ── 顶栏：滚动后转白底 ───────────────────────────────── -->
    <header
      class="fixed inset-x-0 top-0 z-30 border-b transition-colors duration-300"
      :class="scrolled ? 'border-ink-700/70 bg-white/90' : 'border-transparent'"
    >
      <div class="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 lg:px-8">
        <RouterLink to="/" class="flex items-center gap-2.5">
          <img src="/favicon.ico" alt="" class="h-8 w-8 rounded-lg" />
          <span
            class="text-sm font-semibold tracking-tight"
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
      <!-- ── 首屏：浅色渐变 + 细网格 + 光晕 ──────────────────────
           装饰只用 CSS（渐变 + 网格 + 一团品牌光），无任何 canvas 动画；
           hero 底部渐隐到页面底色，避免"海报"与"正文"之间出现硬边。 -->
      <section class="hero-viewport relative isolate overflow-hidden bg-[#04121f]">
        <div class="absolute inset-0 -z-10" aria-hidden="true">
          <!-- 深色底承载白字标题（浅色站点的首屏对比度锚点），
               底部渐隐回浅色页面底，中间过渡交给渐变层 -->
          <div class="absolute inset-0 bg-[#04121f]" />
          <div class="bg-grid absolute inset-0 opacity-[0.14]" />
          <div class="absolute left-1/2 top-[-14rem] h-[30rem] w-[46rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-[120px]" />
          <div class="absolute inset-0" style="background: linear-gradient(to top, #f7f9fc 12%, rgba(4,18,31,0) 46%)" />
        </div>

        <div class="mx-auto flex max-w-7xl flex-col justify-center px-5 pb-24 pt-28 lg:px-8 lg:pb-32 lg:pt-32">
          <div class="max-w-3xl">
            <div class="hero-reveal flex flex-wrap items-center gap-3" style="--d: 0ms">
              <span class="hero-kicker text-brand-300">
                <span class="dot !bg-brand-400" aria-hidden="true" />
                Self-hosted LLM Gateway
              </span>
              <span v-if="site.version" class="chip border-white/15 bg-white/5 text-white/75">v{{ site.version }}</span>
              <span v-if="site.models.length" class="chip border-white/15 bg-white/5 text-white/75">
                {{ site.models.length }} 个模型在线
              </span>
            </div>

            <!-- 品牌名：全站最大的一行字，衬线编辑感 -->
            <h1 class="hero-reveal hero-brand mt-7" style="--d: 60ms">{{ site.siteName }}</h1>

            <p class="hero-reveal mt-5 font-display text-2xl font-medium leading-snug text-white/90 sm:text-3xl" style="--d: 120ms">
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

            <!-- 三级入口：一行安静的文字链 -->
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

          <!-- 事实条：数字仪表，四项事实一眼可读 -->
          <dl
            class="hero-reveal mt-14 flex flex-wrap items-end gap-x-12 gap-y-6 border-t border-ink-700/70 pt-6"
            style="--d: 320ms"
            aria-label="站点数据"
          >
            <div v-for="stat in heroStats" :key="stat.label">
              <dt class="text-xs text-ink-300">{{ stat.label }}</dt>
              <dd class="mt-1 font-display text-2xl font-semibold tabular-nums text-ink-50 sm:text-3xl">
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

      <!-- ── 实时链路：终端演示 + 三步接入 ──────────────────────── -->
      <section id="terminal" class="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Quickstart</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            三步接上，一次流式调用长这样
          </h2>
          <p class="mt-3 text-sm leading-relaxed text-ink-300">
            基地址指向本网关，请求头带访问令牌，其余与官方接口一致。下面是真实协议形态的回放。
          </p>
        </div>

        <div class="mt-10 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <!-- 终端：浅色页面里唯一的深色块，视线的"聚光灯" -->
          <div v-reveal class="code-block shadow-pop">
            <div class="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
              <span class="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span class="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span class="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              <span class="ms-2 font-mono text-[11px] tracking-wider text-white/40">gateway — stream</span>
              <span class="ms-auto flex items-center gap-1.5 font-mono text-[11px] text-emerald-600">
                <span class="dot !bg-emerald-500" aria-hidden="true" />
                online
              </span>
            </div>
            <pre class="min-h-[240px] font-mono text-[13px] leading-relaxed" dir="ltr"><span v-for="(line, i) in terminalLines" :key="i" :class="i === 0 ? 'text-brand-300' : 'text-[#d5e2f2]'">{{ line }}{{ i === terminalLines.length - 1 ? '▌' : '\n' }}</span></pre>
          </div>

          <!-- 三步接入：编号账本式 -->
          <ol v-reveal="80" class="space-y-5">
            <li class="flex gap-4">
              <span class="font-display text-2xl font-semibold text-brand-500">01</span>
              <div>
                <p class="text-sm font-semibold text-ink-50">登录并创建访问令牌</p>
                <p class="mt-1 text-xs leading-relaxed text-ink-300">
                  在「访问令牌」页创建 sk- 开头的密钥，可按用途分别签发，并限定模型或有效期。
                </p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="font-display text-2xl font-semibold text-brand-500">02</span>
              <div>
                <p class="text-sm font-semibold text-ink-50">把基地址指向本网关</p>
                <p class="mt-1 break-all font-mono text-xs leading-relaxed text-ink-300">
                  {{ baseUrl }}/v1
                </p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="font-display text-2xl font-semibold text-brand-500">03</span>
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

      <!-- ── 能力矩阵：账本式清单 ──────────────────────────────── -->
      <section id="capabilities" class="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Capabilities</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            网关该管的事，都在这
          </h2>
        </div>

        <ul class="mt-10 divide-y divide-ink-700/50 border-y border-ink-700/50">
          <li
            v-for="cap in capabilities"
            :key="cap.title"
            v-reveal
            class="group grid gap-3 py-6 transition-colors duration-200 hover:bg-brand-500/[0.04] sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6 sm:px-4"
          >
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ink-700 bg-white text-brand-700 transition-colors group-hover:border-brand-500/40"
            >
              <AppIcon :name="cap.icon" :size="20" />
            </span>
            <div>
              <p class="text-sm font-semibold text-ink-50">{{ cap.title }}</p>
              <p class="mt-1 max-w-2xl text-xs leading-relaxed text-ink-300 sm:text-sm">{{ cap.desc }}</p>
            </div>
            <span class="font-mono text-xs tabular-nums text-brand-700/70">{{ cap.metric }}</span>
          </li>
        </ul>
      </section>

      <!-- ── 适用场景：三类人群各说一句实在话 ────────────────────── -->
      <section class="app-ambient mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Scenarios</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            谁在用，用来做什么
          </h2>
        </div>

        <div class="mt-10 grid gap-5 md:grid-cols-3">
          <div v-for="(item, i) in scenarios" :key="item.title" v-reveal="i * 60" class="card card-pad">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700">
              <AppIcon :name="item.icon" :size="20" />
            </span>
            <h3 class="mt-4 text-sm font-semibold text-ink-50">{{ item.title }}</h3>
            <p class="mt-2 text-xs leading-relaxed text-ink-300 sm:text-sm">{{ item.desc }}</p>
          </div>
        </div>
      </section>

      <!-- ── 接入示例：代码页签 ─────────────────────────────────── -->
      <section class="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Examples</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            复制即用
          </h2>
        </div>

        <div v-reveal class="card mt-8 overflow-hidden" dir="ltr">
          <div class="flex items-center justify-between border-b border-ink-700/60 bg-ink-850/70 px-2 py-1.5">
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
          任何 OpenAI 兼容客户端（Cursor、Codex CLI、Cherry Studio、LobeChat、沉浸式翻译等）选择「自定义 OpenAI 接口」，
          填入上面的基地址与令牌即可。
        </p>
      </section>

      <!-- ── 技术规格表：工程信息，一表说清 ──────────────────────── -->
      <section class="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="max-w-2xl">
          <p class="hero-kicker text-brand-700">Specifications</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            技术规格
          </h2>
        </div>

        <div v-reveal class="table-wrap mt-8">
          <table class="data-table">
            <tbody>
              <tr v-for="spec in specs" :key="spec.label">
                <td class="w-[140px] whitespace-nowrap text-xs font-semibold text-ink-300">{{ spec.label }}</td>
                <td class="text-sm text-ink-100">{{ spec.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
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
            class="chip border-ink-700 bg-white font-mono text-xs text-ink-200"
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

      <!-- ── 常见问题：手风琴，答案全是事实 ──────────────────────── -->
      <section id="faq" class="mx-auto max-w-4xl scroll-mt-24 px-5 py-20 lg:px-8 lg:py-24">
        <div v-reveal class="text-center">
          <p class="hero-kicker justify-center text-brand-700">FAQ</p>
          <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            常见问题
          </h2>
        </div>

        <div v-reveal class="mt-10 space-y-3">
          <div
            v-for="(item, i) in faqs"
            :key="item.q"
            class="card overflow-hidden"
          >
            <button
              type="button"
              class="flex w-full items-center justify-between gap-4 px-5 py-4 text-start"
              :aria-expanded="openFaq === i"
              @click="toggleFaq(i)"
            >
              <span class="text-sm font-semibold text-ink-50">{{ item.q }}</span>
              <AppIcon
                name="chevron-down"
                :size="16"
                class="shrink-0 text-ink-400 transition-transform duration-200"
                :class="openFaq === i ? 'rotate-180' : ''"
              />
            </button>
            <p v-show="openFaq === i" class="border-t border-ink-700/60 px-5 py-4 text-sm leading-relaxed text-ink-300">
              {{ item.a }}
            </p>
          </div>
        </div>
      </section>

      <!-- ── 开源与社区 ────────────────────────────────────────── -->
      <section class="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div class="grid gap-5 md:grid-cols-2">
          <!-- 开源仓库 -->
          <div v-reveal class="card card-pad">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700">
              <AppIcon name="terminal" :size="20" />
            </span>
            <h3 class="mt-4 text-sm font-semibold text-ink-50">源代码开放</h3>
            <p class="mt-2 text-xs leading-relaxed text-ink-300 sm:text-sm">
              服务端代码以 AGPL-3.0 发布在 Gitee，可自行审计、二次开发与私有化部署；
              品牌标识不在源代码许可授权范围内。
            </p>
            <a
              href="https://gitee.com/xiaosu4610/AQUA-API"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-secondary btn-sm mt-4"
            >
              Gitee 仓库
              <AppIcon name="external" :size="13" />
            </a>
          </div>

          <!-- 交流群 -->
          <div v-reveal="60" class="card card-pad">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700">
              <AppIcon name="users" :size="20" />
            </span>
            <h3 class="mt-4 text-sm font-semibold text-ink-50">交流与反馈</h3>
            <p class="mt-2 text-xs leading-relaxed text-ink-300 sm:text-sm">
              使用问题、建议与漏洞报告都可以进群找我们；入群入口保持中性，不需要任何诱导或转发。
            </p>
            <RouterLink to="/join" class="btn btn-secondary btn-sm mt-4">
              加入交流群
              <AppIcon name="chevron-right" :size="13" />
            </RouterLink>
          </div>
        </div>
      </section>

      <!-- ── 尾部行动区：一句话 + 两个操作，克制收束 ─────────────── -->
      <section class="mx-auto max-w-7xl px-5 pb-24 pt-4 lg:px-8">
        <div v-reveal class="hero-water relative overflow-hidden rounded-2xl border border-ink-700/60 bg-white/85 px-6 py-14 text-center sm:px-12">
          <div class="bg-grid absolute inset-0 opacity-50" aria-hidden="true" />
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
