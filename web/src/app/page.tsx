/** 落地页（App Router 首页）：11 区块信息架构。
 *
 * 意图（Why）：
 *   对外门面，10 秒内回答三问——「这是谁 / 现在能用哪些模型 / 我该怎么接」。
 *   视觉语言延续「白昼工程」：亮色冷白底 + 白卡片 + 细描边 + 单一品牌强调色，
 *   区块按「先价值后细节」排序（Hero → 终端演示 → 能力 → 场景 → 代码 → 规格 → 模型墙 → FAQ → 开源 → CTA）。
 *
 * 视觉原则应用：
 *   - F 型首屏：左上品牌+定位句 → 右上 CTA → 中下事实条；
 *   - CRAP：CTA 用品牌色对比、卡片同构重复、8px 栅格对齐、亲密性按功能成组；
 *   - 认知负荷：首屏仅 2 个决策点（开始使用 / 查看模型）。
 */
'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/Display'
import { SiteFooter } from '@/components/site/SiteFooter'
import { SiteHeader } from '@/components/site/SiteHeader'
import { useAuth } from '@/lib/auth/auth-context'
import { useReveal } from '@/lib/useReveal'
import { useSite } from '@/lib/site/site-context'

/* ── 区块 1：Hero ────────────────────────────────────────── */

function HeroSection() {
  const { status } = useSite()
  const { isLoggedIn, isAdmin } = useAuth()
  const stats = useMemo(() => {
    const items: { value: string; label: string }[] = []
    if (status?.models?.length) items.push({ value: String(status.models.length), label: '模型在线' })
    items.push({ value: '3', label: '协议族' })
    items.push({ value: '79', label: '上游渠道类型' })
    items.push({ value: '1', label: '单二进制交付' })
    return items
  }, [status])

  return (
    <section className="grid-bg relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-24">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs text-ink-3">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          自托管 · 单文件部署 · 完全开源
        </div>

        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-[1.18] tracking-tight text-ink sm:text-5xl">
          <span className="block">自托管 LLM API 网关</span>
          <span className="block text-brand">统一多协议上游</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-balance text-[15px] leading-relaxed text-ink-2 sm:text-base">
          一个自部署的网关，把 OpenAI、Anthropic、Gemini 等数十种上游接入到统一的
          OpenAI 兼容接口。精细计费、全量日志、密钥池与失败重试开箱即用。
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={isLoggedIn ? (isAdmin ? '/admin' : '/console') : '/login'}>
            <Button variant="primary" size="lg">
              开始使用
              <AppIcon name="chevron-right" size={16} />
            </Button>
          </Link>
          <Link href="/models">
            <Button variant="secondary" size="lg">
              查看模型广场
            </Button>
          </Link>
        </div>

        {/* 事实条：数字大而细、标签弱化、中点分隔——声明式而非统计卡，避免 SaaS 模板感 */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px] tracking-wide text-ink-3">
          {stats.map((stat, index) => (
            <Fragment key={stat.label}>
              {index > 0 && <span className="hidden h-1 w-1 rounded-full bg-ink/20 sm:block" aria-hidden />}
              <span>
                <span className="text-2xl font-medium tabular-nums tracking-tight text-ink">{stat.value}</span>
                <span className="ml-2">{stat.label}</span>
              </span>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 2：终端演示 + 三步接入 ─────────────────────────── */

function TerminalSection() {
  const { status } = useSite()
  const sampleModel = status?.models?.[0] || 'AQUA-CALL/deepseek-v4-flash'

  // 站点根地址：SSG 阶段无 window（Node 环境），若直接读 window.location 会在
  // 浏览器 hydration 时与 SSG HTML 不一致（React #412/#418）。因此先用常量占位，
  // 挂载后再用真实 origin 覆盖——首帧保持一致，后续更新不触发 hydration 校验。
  const [origin, setOrigin] = useState('https://aqua.is3.cc')
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin)
  }, [])

  const curlCode = `curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-你的令牌" \\
  -d '{
    "model": "${sampleModel}",
    "messages": [{"role": "user", "content": "你好"}]
  }'`

  const steps = [
    { icon: 'key' as const, title: '1 · 获取访问令牌', desc: '注册后创建一把访问令牌，设置额度与可用模型。' },
    { icon: 'terminal' as const, title: '2 · 指向网关地址', desc: '把 base_url 设为本站地址，接口兼容 OpenAI 协议。' },
    { icon: 'bolt' as const, title: '3 · 发起调用', desc: '任意支持 OpenAI SDK 的客户端直接接入，无需改造。' },
  ]

  return (
    <section id="terminal" className="border-t border-line bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            接入只需一条命令
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            网关对外暴露 OpenAI 兼容的 <code className="rounded bg-ink/5 px-1.5 py-0.5 text-[13px]">/v1/chat/completions</code>，
            与主流 SDK 直接兼容，无需学习新协议。
          </p>
          <div className="mt-8 space-y-5">
            {steps.map((step) => (
              <div key={step.title} className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-brand">
                  <AppIcon name={step.icon} size={18} />
                </span>
                <div>
                  <div className="font-medium text-ink">{step.title}</div>
                  <div className="mt-0.5 text-[13px] text-ink-3">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <CodeBlock code={curlCode} language="bash" title="终端示例" />
      </div>
    </section>
  )
}

/* ── 区块 3：能力账本 ────────────────────────────────────── */

const CAPABILITIES = [
  { icon: 'server' as const, title: '多协议上游', desc: 'OpenAI / Anthropic / Gemini / Azure / Vertex 等数十种协议与渠道类型统一接入。', metric: '79 种渠道类型' },
  { icon: 'quota' as const, title: '精细计费', desc: '按 token / 按次 / 免费三种模式，分组倍率、缓存价、进价与余额核算全覆盖。', metric: '多级定价体系' },
  { icon: 'key' as const, title: '密钥池与重试', desc: '多把上游密钥轮询、冷却、自动摘除；上游报错自动换渠道重试。', metric: '失败收敛策略' },
  { icon: 'list' as const, title: '全量日志', desc: '每次调用的模型、用量、延迟、状态码完整记录，可查账可定位。', metric: '调用可审计' },
  { icon: 'shield' as const, title: '操作审计', desc: '管理员对配置的任何改动都有留痕，知道「配置什么时候被谁改过」。', metric: '配置留痕' },
  { icon: 'lock' as const, title: '安全合规', desc: '敏感词过滤、令牌限额、邮箱验证、隐私数据加密存储。', metric: '默认安全' },
]

function CapabilitiesSection() {
  const reveal = useReveal<HTMLDivElement>(80)
  return (
    <section id="capabilities" className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">能力账本</h2>
          <p className="mt-3 text-[15px] text-ink-2">一项能力对应一个实际场景，不写形容词。</p>
        </div>
        <div ref={reveal} className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((cap) => (
            <div key={cap.title} className="group rounded-lg border border-line bg-card p-5 transition hover:border-line-2 hover:bg-surface/70">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand/8 text-brand">
                  <AppIcon name={cap.icon} size={18} />
                </span>
                <span className="text-xs text-ink-3">{cap.metric}</span>
              </div>
              <div className="mt-3 font-semibold text-ink">{cap.title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{cap.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 4：适用场景 ────────────────────────────────────── */

const SCENARIOS = [
  {
    icon: 'users' as const,
    title: '个人开发者',
    desc: '一个账号管理多个上游，额度预算可控，日志可回溯，适合做个人 AI 应用的后端。',
  },
  {
    icon: 'layers' as const,
    title: '团队 / 组织',
    desc: '成员令牌独立计费与限额，模型分组按部门配置，避免「一个人跑超全队买单」。',
  },
  {
    icon: 'server' as const,
    title: '站长 / 服务商',
    desc: '自托管部署、自定义定价、充值闭环，可把 AI 能力作为自有服务对外提供。',
  },
]

function ScenariosSection() {
  return (
    <section className="border-t border-line bg-card">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">适合谁用</h2>
          <p className="mt-3 text-[15px] text-ink-2">同一个网关，不同角色的用法。</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {SCENARIOS.map((scenario) => (
            <div key={scenario.title} className="rounded-lg border border-line bg-surface/50 p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-card text-brand">
                <AppIcon name={scenario.icon} size={18} />
              </span>
              <div className="mt-3 font-semibold text-ink">{scenario.title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{scenario.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 5：技术规格表 ─────────────────────────────────── */

const SPECS: { label: string; value: string }[] = [
  { label: '交付形态', value: '单二进制，go:embed 前端，无需 Node/数据库独立服务' },
  { label: '存储', value: 'SQLite 单文件，迁移版本化' },
  { label: '接口兼容', value: 'OpenAI / Anthropic / Gemini 协议族统一为 OpenAI 兼容' },
  { label: '上游重试', value: '密钥冷却、换渠道、分级退避，失败收敛策略可配置' },
  { label: '计费粒度', value: '按 token / 按次 / 免费，分组倍率与缓存价' },
  { label: '国际化', value: '多语言界面，阿拉伯语 RTL 支持' },
]

function SpecsSection() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">技术规格</h2>
        <div className="mt-8 overflow-hidden rounded-lg border border-line bg-card">
          <table className="w-full text-sm">
            <tbody>
              {SPECS.map((spec, index) => (
                <tr key={spec.label} className={index % 2 ? 'bg-surface/40' : ''}>
                  <td className="w-40 border-r border-line px-4 py-3 font-medium text-ink-2">{spec.label}</td>
                  <td className="px-4 py-3 text-ink-2">{spec.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/* ── 区块 6：模型墙 ─────────────────────────────────────── */

function ModelWallSection() {
  const { status } = useSite()
  const models = status?.models?.slice(0, 12) ?? []
  return (
    <section className="border-t border-line bg-card">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">模型墙</h2>
            <p className="mt-3 text-[15px] text-ink-2">当前对外可用的模型（实时来自站点信息）。</p>
          </div>
          <Link href="/models" className="text-[13px] text-brand hover:underline">
            查看全部 →
          </Link>
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          {models.length === 0 && <div className="text-[13px] text-ink-3">模型清单加载中…</div>}
          {models.map((model) => (
            <Link
              key={model}
              href="/models"
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-line-2 hover:text-brand"
            >
              {model}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 7：FAQ ────────────────────────────────────────── */

const FAQS = [
  { q: '部署需要哪些依赖？', a: '只需一个二进制文件（SQLite 内嵌），无需 Node、独立数据库或外部服务。' },
  { q: '支持哪些上游协议？', a: 'OpenAI 兼容、Anthropic、Gemini、Azure、Vertex 等数十种协议与渠道类型，统一收敛到 OpenAI 兼容接口。' },
  { q: '如何计费？', a: '支持按 token、按次、免费三种模式，可按分组配置倍率与缓存价格，并核算上游进价与余额。' },
  { q: '数据存哪里？', a: '全部存于本地 SQLite 单文件，支持版本化迁移与备份导出，数据不出你的服务器。' },
  { q: '上游不稳定时怎么办？', a: '密钥池 + 自动重试 + 冷却退避：一把密钥失败自动换下一把，渠道整体失败会换渠道再试。' },
  { q: '能商用吗？', a: '采用木兰宽松许可证（Mulan PSL v2）开源，可自由使用与商用（详见仓库 LICENSE 与免责声明）。' },
]

function FaqSection() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="border-t border-line">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">常见问题</h2>
        <div className="mt-10 space-y-2">
          {FAQS.map((faq, index) => {
            const active = open === index
            return (
              <div key={faq.q} className="overflow-hidden rounded-lg border border-line bg-card">
                <button
                  type="button"
                  onClick={() => setOpen(active ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left"
                  aria-expanded={active}
                >
                  <span className="font-medium text-ink">{faq.q}</span>
                  <AppIcon name="chevron-down" size={16} className={`shrink-0 text-ink-3 transition-transform ${active ? 'rotate-180' : ''}`} />
                </button>
                {active && <div className="border-t border-line px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">{faq.a}</div>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 8：开源与社区 ─────────────────────────────────── */

function OpenSourceSection() {
  return (
    <section className="border-t border-line bg-card">
      <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">开源 · 可验证</h2>
        <p className="mx-auto mt-3 max-w-xl text-balance text-[15px] text-ink-2">
          源码公开，采用木兰宽松许可证第 2 版。你可以审计每一行代码，也可以提交 Pull Request 参与共建。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href="https://gitee.com/xiaosu4610/AQUA-API" target="_blank" rel="noreferrer">
            <Button variant="primary" size="lg">
              Gitee 仓库 <AppIcon name="external" size={15} />
            </Button>
          </a>
          <a href="https://github.com/xiaosu4610/AQUA-API" target="_blank" rel="noreferrer">
            <Button variant="secondary" size="lg">
              GitHub 仓库 <AppIcon name="external" size={15} />
            </Button>
          </a>
          <Link href="/join">
            <Button variant="secondary" size="lg">
              加入交流群
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ── 区块 9：底部 CTA ───────────────────────────────────── */

function CtaSection() {
  const { isLoggedIn } = useAuth()
  return (
    <section className="grid-bg border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight text-ink">准备好开始了吗？</h2>
        <p className="mx-auto mt-3 max-w-xl text-balance text-[15px] text-ink-2">
          {isLoggedIn ? '前往你的控制台，创建第一个访问令牌。' : '注册即用，马上就能接入第一个模型。'}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={isLoggedIn ? '/console' : '/register'}>
            <Button variant="primary" size="lg">
              {isLoggedIn ? '进入控制台' : '免费注册'} <AppIcon name="chevron-right" size={16} />
            </Button>
          </Link>
          <Link href="/models">
            <Button variant="secondary" size="lg">先看看模型</Button>
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ── 页面装配 ───────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <HeroSection />
        <TerminalSection />
        <CapabilitiesSection />
        <ScenariosSection />
        <SpecsSection />
        <ModelWallSection />
        <FaqSection />
        <OpenSourceSection />
        <CtaSection />
      </main>
      <SiteFooter />
    </>
  )
}