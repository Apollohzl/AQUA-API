/** 落地页（App Router 首页）：极简个人主页 · 左对齐窄栏长文。
 *
 * 意图（Why）：
 *   用户两轮否掉了「企业官网商业化」布局（sticky 居中顶栏 + 卡片栅格 + 分区描边）。
 *   本次按「极简个人主页 + 普通不悬浮头部」重构：
 *   - 全页 max-w-2xl 左对齐窄栏，像读一篇博客正文，而不是逛一个产品站；
 *   - 无大卡片栅格：用「小节 + 短段落 + 内联链接」组织，信息密度交给文字；
 *   - 顶栏不 sticky（SiteHeader 已改），滚到哪是哪。
 *
 * 视觉原则：
 *   - 排版节奏：大标题 → 引语 → 小节（## 标题 + 正文），全是文档流；
 *   - 强调收敛：唯一品牌色用在「注册/开始使用」一处；
 *   - 事实用文字陈述（32 个模型在线、0 条广告），不做统计格子。
 *
 * 流转（Flow）：
 *   SiteHeader → 自述(Hero) → 在跑什么 → 为什么做 → 钱怎么花 → 怎么接入
 *   → 模型清单 → 支持我 → FAQ → 结尾 → SiteFooter
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
import { useSite } from '@/lib/site/site-context'

/* ── 小节标题：统一窄栏内的大标题 ─────────────────────── */

function SectionTitle({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-14 text-xl font-bold tracking-tight text-ink sm:text-2xl">
      {children}
    </h2>
  )
}

/* ── 自述（Hero）────────────────────────────────────────── */

function Intro() {
  const { status } = useSite()
  const { isLoggedIn } = useAuth()

  const stats = useMemo(() => {
    const items: { value: string; label: string }[] = []
    if (status?.models?.length) items.push({ value: String(status.models.length), label: '个模型在线' })
    items.push({ value: '79', label: '类上游渠道' })
    items.push({ value: '0', label: '条广告' })
    items.push({ value: '1', label: '个二进制文件' })
    return items
  }, [status])

  return (
    <section className="grid-bg relative border-b border-line overflow-hidden">
      <div className="mx-auto max-w-2xl px-4 pb-12 pt-14 sm:px-6 sm:pt-16">
        <p className="text-[13px] tracking-wide text-ink-3">
          这是一个人的自托管网关 · 不是公司产品
        </p>

        <h1 className="mt-3 text-3xl font-bold leading-[1.3] tracking-tight text-ink sm:text-[34px]">
          我把几十家上游，
          <br />
          收拢成<span className="text-brand">一条通用的接口</span>。
        </h1>

        <p className="mt-5 max-w-xl text-[15px] leading-[1.9] text-ink-2">
          这里是我自己搭、自己维护的 LLM API 网关：OpenAI、Anthropic、Gemini 等协议统一转成
          OpenAI 兼容格式，计费、日志、密钥池、失败重试都是现成的。
          它没有增长指标，也没打算把我自己做大——能把服务器成本跑平，顺手帮到一些人就够了。
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={isLoggedIn ? '/console' : '/register'}>
            <Button variant="primary" size="lg">
              {isLoggedIn ? '进入控制台' : '注册一个账号'}
              <AppIcon name="chevron-right" size={16} />
            </Button>
          </Link>
          <Link href="/models">
            <Button variant="secondary" size="lg">
              先看看有哪些模型
            </Button>
          </Link>
        </div>

        <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-3">
          {stats.map((stat, index) => (
            <Fragment key={stat.label}>
              {index > 0 && <span className="hidden h-1 w-1 rounded-full bg-ink/20 sm:inline-block" aria-hidden />}
              <span>
                <span className="text-lg font-medium tabular-nums text-ink">{stat.value}</span>
                <span className="ml-1.5">{stat.label}</span>
              </span>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 在跑什么（近况，纯文字）────────────────────────────── */

const MOMENTS: { time: string; text: string; tags?: string[] }[] = [
  {
    time: '最近',
    text: '又接了几路上游，把在跑的模型价格重新对了一遍账。免费分组保持开放，按次专线照旧——长提示词不加价。',
    tags: ['运维', '计价'],
  },
  {
    time: '前不久',
    text: '给全套界面做了昼夜两套主题：白天暖白、夜里深墨，默认跟着北京时间走，也可以手动锁一个。',
    tags: ['前端', '主题'],
  },
  {
    time: '更早',
    text: '把密钥池的冷却与自动摘除调顺了。上游偶发抽风时能自己换线路，调用方基本无感。',
    tags: ['稳定性'],
  },
]

function WhatNow() {
  return (
    <section className="mx-auto max-w-2xl px-4 sm:px-6">
      <SectionTitle>最近在忙什么</SectionTitle>
      <div className="mt-5 space-y-6">
        {MOMENTS.map((m) => (
          <article key={m.text}>
            <p className="text-[14px] leading-[1.85] text-ink-2">
              <span className="mr-1.5 font-medium text-ink">{m.time}</span>
              {m.text}
            </p>
            {m.tags && (
              <div className="mt-1.5 flex gap-1.5 text-[12px] text-ink-3">
                {m.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

/* ── 为什么做（三条原则，列表式）────────────────────────── */

function WhyDo() {
  return (
    <section className="mx-auto max-w-2xl px-4 sm:px-6">
      <SectionTitle>为什么做这个</SectionTitle>
      <div className="mt-5 space-y-4 text-[15px] leading-[1.9] text-ink-2">
        <p>
          市面上的中转站大多绕不开三件事：套路定价、看不清的用量、随时跑路。我不想再做一个那样的东西，
          所以这里的规矩很简单——
        </p>
        <ul className="space-y-3 pl-1">
          {[
            ['计价写得明白', '每个模型的单价摆在模型广场上，按次/按量/免费三种模式，账单可逐条核对。'],
            ['用量自己说了算', '每次调用的模型、token 数、耗时、状态码都留档，你随时能查，我也改不了。'],
            ['代码是开源的', '整套网关在 Gitee / GitHub 公开，木兰宽松版。哪天我不做了，你也能自己部署一套。'],
          ].map(([title, desc]) => (
            <li key={title} className="flex gap-2">
              <span className="mt-[2px] shrink-0 text-brand">·</span>
              <span>
                <b className="font-medium text-ink">{title}</b> —— {desc}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ── 钱怎么花（成本透明）────────────────────────────────── */

function Money() {
  return (
    <section className="mx-auto max-w-2xl px-4 sm:px-6">
      <SectionTitle>钱是怎么花的</SectionTitle>
      <div className="mt-5 space-y-3 text-[15px] leading-[1.9] text-ink-2">
        <p>
          不搞「限时特惠」，也不做「充多少送多少」。这里只有一笔账：
          <b className="font-medium text-ink">你付的钱先覆盖成本，多出来的才是我继续维护它的理由。</b>
        </p>
        <ul className="space-y-2 pl-1 text-[14px]">
          {[
            ['服务器', '每月固定——一台独服跑网关与数据库'],
            ['带宽与流量', '按量浮动——调用越多越高'],
            ['上游模型费用', '按用量结算——我向上游买的价就是成本基准'],
            ['域名与证书', '每年少量'],
          ].map(([k, v]) => (
            <li key={k} className="flex flex-wrap gap-x-2">
              <span className="w-24 shrink-0 font-medium text-ink">{k}</span>
              <span className="text-ink-3">{v}</span>
            </li>
          ))}
        </ul>
        <p className="rounded-md border border-brand/20 bg-brand/5 p-3 text-[13px] leading-[1.8]">
          如果有结余，我优先用来：接更多稳定上游、把便宜模型做成免费分组、给开源仓库补文档。
          <b className="font-medium text-ink">如果哪天入不敷出，我会在公告里说明，而不是悄悄涨价。</b>
        </p>
      </div>
    </section>
  )
}

/* ── 怎么接入 ───────────────────────────────────────────── */

function HowToUse() {
  const { status } = useSite()
  const sampleModel = status?.models?.[0] || 'AQUA-CALL/deepseek-v4-flash'

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

  return (
    <section className="mx-auto max-w-2xl px-4 sm:px-6">
      <SectionTitle id="terminal">接进来，只要一条命令</SectionTitle>
      <div className="mt-5 space-y-3 text-[15px] leading-[1.9] text-ink-2">
        <p>对外只暴露 OpenAI 兼容的接口，不折腾新协议。三步走：</p>
        <ol className="space-y-2 pl-1">
          {[
            '注册后在控制台创建一把访问令牌，顺手设好预算和可用模型。',
            '任何支持 OpenAI SDK 的客户端，把 base_url 换成这里就行。',
            '代码一行不用改，协议是兼容的，出事了我这边先兜。',
          ].map((step, i) => (
            <li key={step} className="flex gap-2">
              <span className="w-5 shrink-0 text-right font-medium text-brand">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-5">
        <CodeBlock code={curlCode} language="bash" title="终端示例" />
      </div>
    </section>
  )
}

/* ── 模型清单 ───────────────────────────────────────────── */

function ModelList() {
  const { status } = useSite()
  const models = status?.models?.slice(0, 14) ?? []
  return (
    <section className="mx-auto max-w-2xl px-4 sm:px-6">
      <SectionTitle>现在能用的模型</SectionTitle>
      <p className="mt-3 text-[14px] text-ink-2">实时来自站点信息，不带修饰。</p>
      <div className="mt-4">
        {models.length === 0 && <p className="text-[13px] text-ink-3">正在读取模型清单…</p>}
        <ul className="space-y-2 text-[14px] leading-[1.8]">
          {models.map((model) => (
            <li key={model}>
              <Link href="/models" className="text-ink-2 transition hover:text-brand">
                {model}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <Link href="/models" className="mt-3 inline-block text-[13px] text-brand hover:underline">
        完整清单与价格 →
      </Link>
    </section>
  )
}

/* ── 支持我 ─────────────────────────────────────────────── */

function SupportMe() {
  return (
    <section className="mx-auto max-w-2xl px-4 sm:px-6">
      <SectionTitle>如果你想支持一下</SectionTitle>
      <div className="mt-5 space-y-3 text-[15px] leading-[1.9] text-ink-2">
        <p>不用捐钱。下面这几件事，比打赏有用得多：</p>
        <ul className="space-y-2 pl-1">
          {[
            '来用一用，然后告诉我哪里难用——真实的抱怨比客套的夸奖值钱。',
            '帮仓库补文档或提 Issue——一个人写文档总有盲区。',
            '自己部署一套试试——你本地跑通了，我就少一份维护压力。',
            '把链接发给可能用得上的人——不做推广，朋友间顺口一提完全欢迎。',
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-[2px] shrink-0 text-brand">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ── FAQ ────────────────────────────────────────────────── */

const FAQS = [
  { q: '这站能一直开着吗？', a: '我会尽力。它的成本可控，我也不靠它赚钱，没有「融资烧完就跑」的问题。真有关停那天，我会提前公告并给出自己部署的完整方案。' },
  { q: '为什么要开源？', a: '一是让你能验证我说的都是真的；二是万一我不做了，这套东西不会跟着消失。协议是木兰宽松版（Mulan PSL v2）。' },
  { q: '免费分组的模型会收费吗？', a: '免费分组里就是不计费的，我不搞「先免费养熟再收费」那套。当然，免费范围会随上游价格调整，但改之前会在公告里说。' },
  { q: '我的调用数据会被拿去用吗？', a: '不会。日志只用于计费和排障，存在我自己的服务器上。站点的隐私政策里写明了这一点。' },
  { q: '上游不稳定怎么办？', a: '密钥池 + 自动重试 + 冷却退避：一把密钥失败自动换下一把，整条渠道不行就换渠道再试。你还是只发一次请求。' },
  { q: '怎么联系你？', a: '页面底部的「联系方式」和「投诉举报」都能找到我。有事直说就行。' },
]

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="mx-auto max-w-2xl px-4 sm:px-6">
      <SectionTitle id="faq">你可能想问</SectionTitle>
      <div className="mt-4 space-y-3">
        {FAQS.map((faq, index) => {
          const active = open === index
          return (
            <div key={faq.q} className="border-b border-line pb-3">
              <button
                type="button"
                onClick={() => setOpen(active ? null : index)}
                className="flex w-full items-center justify-between gap-4 text-left"
                aria-expanded={active}
              >
                <span className="text-[15px] font-medium text-ink">{faq.q}</span>
                <AppIcon
                  name="chevron-down"
                  size={15}
                  className={`shrink-0 text-ink-3 transition-transform ${active ? 'rotate-180' : ''}`}
                />
              </button>
              {active && <p className="mt-2 text-[14px] leading-[1.85] text-ink-2">{faq.a}</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ── 结尾 ───────────────────────────────────────────────── */

function Ending() {
  const { isLoggedIn } = useAuth()
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-ink">
          {isLoggedIn ? '去控制台创建你的第一把令牌。' : '那就从一把令牌开始吧。'}
        </h2>
        <p className="mt-3 max-w-xl text-balance text-[15px] leading-relaxed text-ink-2">
          {isLoggedIn
            ? '接进现有代码就行，先跑通一个请求，再决定要不要留下。'
            : '注册是免费的，先跑通一个请求，再决定要不要留下。'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
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
        <Intro />
        <div className="py-4" />
        <WhatNow />
        <WhyDo />
        <Money />
        <HowToUse />
        <ModelList />
        <SupportMe />
        <Faq />
        <div className="py-4" />
        <Ending />
      </main>
      <SiteFooter />
    </>
  )
}