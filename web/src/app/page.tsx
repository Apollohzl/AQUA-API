/** 落地页（App Router 首页）：个人博客 / 半公益 风格的信息架构。
 *
 * 意图（Why）：
 *   这不是一张「产品官网」，而是一个站长的自述页——用第一人称讲清楚：
 *   我是谁、我为什么搭这个网关、它现在跑成什么样、成本与收益怎么安排、你可以怎么用。
 *   视觉走「即刻风」：圆角卡片流 + 用户动态（近况）+ 克制的暖白纸感，去掉营销腔。
 *
 * 视觉原则应用：
 *   - F 型首屏：左上作者名片 → 右上切换/登录 → 中下事实条；
 *   - CRAP：卡片同构重复、8px 栅格对齐、品牌色只用在唯一的行动点；
 *   - 认知负荷：首屏仅 2 个决策点（开始使用 / 看模型）。
 *
 * 流转（Flow）：
 *   SiteHeader → Hero(作者名片) → NowFeed(近况) → Mission(公益宣言) → Cost(成本透明)
 *   → Capabilities(能力) → Terminal(接入) → ModelWall(模型) → Support(支持我)
 *   → FAQ → CTA → SiteFooter
 */
'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { AppIcon } from '@/components/AppIcon'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/Display'
import { SiteFooter } from '@/components/site/SiteFooter'
import { SiteHeader } from '@/components/site/SiteHeader'
import { useAuth } from '@/lib/auth/auth-context'
import { useReveal } from '@/lib/useReveal'
import { useSite } from '@/lib/site/site-context'

/* ── 区块 1：作者名片（Hero）────────────────────────────── */

function HeroSection() {
  const { status } = useSite()
  const { isLoggedIn, isAdmin } = useAuth()

  const stats = useMemo(() => {
    const items: { value: string; label: string }[] = []
    if (status?.models?.length) items.push({ value: String(status.models.length), label: '模型在线' })
    items.push({ value: '79', label: '上游渠道类型' })
    items.push({ value: '0', label: '条广告' })
    items.push({ value: '1', label: '个二进制文件' })
    return items
  }, [status])

  return (
    <section className="grid-bg relative overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 pb-14 pt-20 sm:px-6 sm:pt-24">
        {/* 作者行：头像 + 名字 + 状态点，即刻式名片 */}
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand">
            <BrandMark size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">AQUA-API</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11px] text-ink-3">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                在运行
              </span>
            </div>
            <div className="text-[13px] text-ink-3">一个自托管的大模型接口站 · 个人维护</div>
          </div>
        </div>

        {/* 第一人称自述：代替营销标语 */}
        <h1 className="mt-8 text-[28px] font-bold leading-[1.35] tracking-tight text-ink sm:text-[34px]">
          我把几十家大模型的上游，
          <br className="hidden sm:block" />
          收拢成<span className="text-brand">一条通用的接口</span>。
        </h1>

        <p className="mt-5 text-[15px] leading-[1.85] text-ink-2">
          这是我自己搭、自己维护的网关：OpenAI、Anthropic、Gemini 等协议统一转成 OpenAI 兼容格式，
          省钱计费、完整日志、密钥池和失败重试都是现成的。
          它不是公司产品，没有增长指标，也<b className="font-medium text-ink">不追求把我自己做大</b>——
          能把服务器成本跑平、顺手帮到一些人，就够了。
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href={isLoggedIn ? (isAdmin ? '/admin' : '/console') : '/register'}>
            <Button variant="primary" size="lg">
              {isLoggedIn ? '进入我的控制台' : '注册一个账号'}
              <AppIcon name="chevron-right" size={16} />
            </Button>
          </Link>
          <Link href="/models">
            <Button variant="secondary" size="lg">
              先看看有哪些模型
            </Button>
          </Link>
        </div>

        {/* 事实条：数字大而细、标签弱化、圆点分隔——声明式而非统计卡 */}
        <div className="mt-11 flex flex-wrap items-center gap-x-7 gap-y-3 text-[13px] tracking-wide text-ink-3">
          {stats.map((stat, index) => (
            <Fragment key={stat.label}>
              {index > 0 && <span className="hidden h-1 w-1 rounded-full bg-ink/20 sm:block" aria-hidden />}
              <span>
                <span className="text-[22px] font-medium tabular-nums tracking-tight text-ink">{stat.value}</span>
                <span className="ml-2">{stat.label}</span>
              </span>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 2：近况（即刻风动态流）────────────────────────── */

interface Moment {
  time: string
  text: string
  tags?: string[]
}

const MOMENTS: Moment[] = [
  {
    time: '最近',
    text: '又接上了几路上游，把所有在跑的模型价格重新对了一遍账。免费分组保持开放，按次专线照旧——长提示词不加价。',
    tags: ['运维', '计价'],
  },
  {
    time: '前不久',
    text: '给全套界面做了昼夜两套主题：白天暖白、夜里深墨，默认跟着北京时间走，你也可以自己锁一个。',
    tags: ['前端', '主题'],
  },
  {
    time: '更早',
    text: '把密钥池的冷却与自动摘除调顺了。上游偶发抽风时能自己换线路，调用方基本无感。',
    tags: ['稳定性'],
  },
]

function NowFeedSection() {
  const reveal = useReveal<HTMLDivElement>(70)
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">最近在忙什么</h2>
          <span className="text-[13px] text-ink-3">像写动态一样记一笔</span>
        </div>

        <div ref={reveal} className="mt-7 space-y-3">
          {MOMENTS.map((m) => (
            <article
              key={m.text}
              className="rounded-xl border border-line bg-card p-5 transition hover:border-line-2"
            >
              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <BrandMark size={13} />
                </span>
                <span className="text-ink-2">AQUA-API</span>
                <span aria-hidden>·</span>
                <span>{m.time}</span>
              </div>
              <p className="mt-3 text-[14px] leading-[1.8] text-ink-2">{m.text}</p>
              {m.tags && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.tags.map((t) => (
                    <span key={t} className="rounded-md bg-ink/5 px-2 py-0.5 text-[12px] text-ink-3">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 3：为什么做这个（半公益宣言）──────────────────── */

function MissionSection() {
  return (
    <section className="border-t border-line bg-card">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">为什么做这个</h2>

        <div className="mt-6 space-y-4 text-[15px] leading-[1.9] text-ink-2">
          <p>
            市面上的中转站大多绕不开三件事：<b className="font-medium text-ink">套路定价</b>、
            <b className="font-medium text-ink">看不清的用量</b>、<b className="font-medium text-ink">随时跑路</b>。
            我不想再做一个那样的东西。
          </p>
          <p>
            所以这里的原则很简单：
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { icon: 'quota' as const, title: '计价写得明白', desc: '每个模型的单价摆在模型广场上，按秒/按次/免费三种模式，调用完的账单可逐条核对。' },
            { icon: 'eye' as const, title: '用量自己说了算', desc: '每次调用的模型、令牌数、耗时、状态码都留档，你随时能查，我也改不了。' },
            { icon: 'shield' as const, title: '代码是开源的', desc: '整套网关在 Gitee / GitHub 上公开，协议是木兰宽松版。哪天我不做了，你也能自己部署一套。' },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-line bg-surface/60 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-card text-brand">
                <AppIcon name={item.icon} size={16} />
              </span>
              <div className="mt-3 text-[14px] font-semibold text-ink">{item.title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 4：成本透明（半公益的核心）────────────────────── */

const COSTS: { label: string; value: string; note: string }[] = [
  { label: '服务器', value: '每月固定', note: '一台独服跑网关与数据库' },
  { label: '带宽与流量', value: '按量浮动', note: '调用越多，这部分越高' },
  { label: '上游模型费用', value: '按用量结算', note: '我向上游买的价，就是成本基准' },
  { label: '域名与证书', value: '每年少量', note: '证书免费，域名按年续' },
]

function CostSection() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">钱是怎么花的</h2>
        <p className="mt-3 text-[15px] leading-[1.85] text-ink-2">
          不搞「限时特惠」，也不做「充多少送多少」。这里只有一笔账：
          <b className="font-medium text-ink">你付的钱先覆盖成本，多出来的才是我继续维护它的理由。</b>
        </p>

        <div className="mt-7 overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <tbody>
              {COSTS.map((row, index) => (
                <tr key={row.label} className={index % 2 ? 'bg-surface/40' : ''}>
                  <td className="w-32 border-r border-line px-4 py-3 font-medium text-ink-2 sm:w-40">{row.label}</td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{row.value}</div>
                    <div className="mt-0.5 text-[12px] text-ink-3">{row.note}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-brand/20 bg-brand/5 p-4">
          <span className="mt-0.5 shrink-0 text-brand">
            <AppIcon name="info" size={17} />
          </span>
          <p className="text-[13px] leading-relaxed text-ink-2">
            如果有结余，我会优先用来：接更多稳定上游、把便宜模型做成免费分组、
            给开源仓库补文档。<b className="font-medium text-ink">如果哪天入不敷出，我会在公告里说明，而不是悄悄涨价。</b>
          </p>
        </div>
      </div>
    </section>
  )
}

/* ── 区块 5：能力（博客化表述，不做形容词堆砌）────────── */

const CAPABILITIES = [
  { icon: 'server' as const, title: '多协议上游', desc: 'OpenAI / Anthropic / Gemini / Azure / Vertex 等，进来是各家协议，出去都是同一套接口。' },
  { icon: 'quota' as const, title: '精细计费', desc: '按 token、按次、免费三种模式，分组倍率与缓存价都能配，账目可核。' },
  { icon: 'key' as const, title: '密钥池与重试', desc: '多把上游密钥轮询、冷却、自动摘除；上游报错时自动换渠道重试。' },
  { icon: 'list' as const, title: '全量日志', desc: '每次调用的模型、用量、延迟、状态码都记下来，查账和排障都靠它。' },
  { icon: 'shield' as const, title: '操作审计', desc: '后台对配置的每一次改动都有留痕，知道「什么时候、被谁改过」。' },
  { icon: 'lock' as const, title: '默认安全', desc: '敏感词过滤、令牌限额、邮箱验证，隐私数据加密存，数据都在自己机器上。' },
]

function CapabilitiesSection() {
  const reveal = useReveal<HTMLDivElement>(80)
  return (
    <section id="capabilities" className="border-t border-line bg-card">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">它能做什么</h2>
        <p className="mt-3 text-[15px] text-ink-2">一项能力对应一个真实场景，不写形容词。</p>

        <div ref={reveal} className="mt-7 grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="flex gap-3.5 rounded-xl border border-line bg-surface/50 p-4 transition hover:border-line-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-brand">
                <AppIcon name={cap.icon} size={17} />
              </span>
              <div>
                <div className="text-[14px] font-semibold text-ink">{cap.title}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{cap.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 6：接入示例（一条 curl）────────────────────────── */

function TerminalSection() {
  const { status } = useSite()
  const sampleModel = status?.models?.[0] || 'AQUA-CALL/deepseek-v4-flash'

  // SSG 阶段无 window；先常量占位，挂载后再取真实 origin，避免 hydration 不一致。
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
    { icon: 'key' as const, title: '拿一把令牌', desc: '注册后在控制台创建访问令牌，顺便设好额度和可用模型。' },
    { icon: 'terminal' as const, title: '把地址指过来', desc: '任何支持 OpenAI SDK 的客户端，把 base_url 换成这里就行。' },
    { icon: 'bolt' as const, title: '直接调用', desc: '代码一行不用改，协议是兼容的，出事了我这边先兜。' },
  ]

  return (
    <section id="terminal" className="border-t border-line">
      <div className="mx-auto grid max-w-5xl gap-9 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">接进来只要一条命令</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            对外只暴露 OpenAI 兼容的 <code className="rounded bg-ink/5 px-1.5 py-0.5 text-[13px]">/v1/chat/completions</code>，
            不折腾新协议。
          </p>
          <div className="mt-7 space-y-5">
            {steps.map((step) => (
              <div key={step.title} className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-brand">
                  <AppIcon name={step.icon} size={17} />
                </span>
                <div>
                  <div className="text-[14px] font-medium text-ink">{step.title}</div>
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

/* ── 区块 7：模型墙 ─────────────────────────────────────── */

function ModelWallSection() {
  const { status } = useSite()
  const models = status?.models?.slice(0, 14) ?? []
  return (
    <section className="border-t border-line bg-card">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">现在能用的模型</h2>
            <p className="mt-3 text-[15px] text-ink-2">实时来自站点信息，不带修饰。</p>
          </div>
          <Link href="/models" className="text-[13px] text-brand hover:underline">
            完整清单与价格 →
          </Link>
        </div>

        <div className="mt-7 flex flex-wrap gap-2">
          {models.length === 0 && <div className="text-[13px] text-ink-3">正在读取模型清单…</div>}
          {models.map((model) => (
            <Link
              key={model}
              href="/models"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-brand/40 hover:text-brand"
            >
              {model}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 8：支持我（半公益）────────────────────────────── */

function SupportSection() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">如果你想支持一下</h2>
        <p className="mt-3 text-[15px] leading-[1.85] text-ink-2">
          不用捐钱。下面这几件事，比打赏有用得多：
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            { icon: 'users' as const, title: '来用一用，然后告诉我哪里难用', desc: '真实的抱怨比客套的夸奖值钱。' },
            { icon: 'book' as const, title: '帮仓库补文档或提 Issue', desc: '一个人写文档总有盲区，你踩过的坑别人也会踩。' },
            { icon: 'terminal' as const, title: '自己部署一套试试', desc: '代码是开源的。你本地跑通了，我就少一份维护压力。' },
            { icon: 'send' as const, title: '把链接发给可能用得上的人', desc: '不做推广，但朋友之间顺口一提完全欢迎。' },
          ].map((item) => (
            <div key={item.title} className="flex gap-3.5 rounded-xl border border-line bg-card p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <AppIcon name={item.icon} size={17} />
              </span>
              <div>
                <div className="text-[14px] font-semibold text-ink">{item.title}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 9：FAQ ───────────────────────────────────────── */

const FAQS = [
  { q: '这站能一直开着吗？', a: '我会尽力。它的成本可控，我也不靠它赚钱，所以没有「融资烧完就跑」的问题。真有关停的那天，我会提前公告并给出自己部署的完整方案。' },
  { q: '为什么要开源？', a: '一是让你能验证我说的都是真的；二是万一我不做了，这套东西不会跟着消失。协议是木兰宽松版（Mulan PSL v2），可自由使用与商用。' },
  { q: '免费分组的模型会收费吗？', a: '免费分组里就是不计费的，我不搞「先免费养熟再收费」那套。当然，免费范围会随上游价格调整，但改之前会在公告里说。' },
  { q: '我的调用数据会被拿去用吗？', a: '不会。日志只用于计费和排障，存在我自己的服务器上。站点的隐私政策里写明了这一点。' },
  { q: '上游不稳定怎么办？', a: '密钥池 + 自动重试 + 冷却退避：一把密钥失败自动换下一把，整条渠道不行就换渠道再试。你还是只发一次请求。' },
  { q: '怎么联系你？', a: '页面底部的「联系方式」和「投诉举报」都能找到我。有事直说就行，不用绕弯子。' },
]

function FaqSection() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="border-t border-line bg-card">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">你可能想问</h2>
        <div className="mt-7 space-y-2">
          {FAQS.map((faq, index) => {
            const active = open === index
            return (
              <div key={faq.q} className="overflow-hidden rounded-xl border border-line bg-surface/50">
                <button
                  type="button"
                  onClick={() => setOpen(active ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left"
                  aria-expanded={active}
                >
                  <span className="text-[14px] font-medium text-ink">{faq.q}</span>
                  <AppIcon
                    name="chevron-down"
                    size={16}
                    className={`shrink-0 text-ink-3 transition-transform ${active ? 'rotate-180' : ''}`}
                  />
                </button>
                {active && (
                  <div className="border-t border-line px-4 py-3.5 text-[13px] leading-[1.85] text-ink-2">{faq.a}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── 区块 10：底部 CTA ─────────────────────────────────── */

function CtaSection() {
  const { isLoggedIn } = useAuth()
  return (
    <section className="grid-bg border-t border-line">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">那就从一把令牌开始吧</h2>
        <p className="mx-auto mt-3 max-w-xl text-balance text-[15px] leading-relaxed text-ink-2">
          {isLoggedIn
            ? '去控制台创建你的第一把访问令牌，接进现有代码就行。'
            : '注册是免费的，先跑通一个请求，再决定要不要留下。'}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link href={isLoggedIn ? '/console' : '/register'}>
            <Button variant="primary" size="lg">
              {isLoggedIn ? '进入控制台' : '注册一个账号'}
              <AppIcon name="chevron-right" size={16} />
            </Button>
          </Link>
          <a href="https://gitee.com/xiaosu4610/AQUA-API" target="_blank" rel="noreferrer">
            <Button variant="secondary" size="lg">
              先读读源码 <AppIcon name="external" size={15} />
            </Button>
          </a>
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
        <NowFeedSection />
        <MissionSection />
        <CostSection />
        <CapabilitiesSection />
        <TerminalSection />
        <ModelWallSection />
        <SupportSection />
        <FaqSection />
        <CtaSection />
      </main>
      <SiteFooter />
    </>
  )
}
