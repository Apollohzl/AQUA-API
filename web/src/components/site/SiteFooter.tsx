/** SiteFooter：公共站页脚（React 版，等价旧 SiteFooter.vue）。
 *
 * 意图（Why）：
 *   任何页面都展示「服务由谁提供」（合规要求）+ 导航 + 开源信息。
 *   合规字段为空时该项不展示；站点名回退到 status 或默认值。
 */
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { AppIcon } from '@/components/AppIcon'
import { BrandLogo } from '@/components/BrandMark'
import { useSite } from '@/lib/site/site-context'

import { LocaleSwitcher } from './LocaleSwitcher'

const FOOTER_COLS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: '文档',
    links: [
      { label: '接入示例', href: '/console/docs' },
      { label: '游乐场', href: '/console/playground' },
      { label: '安装向导', href: '/install' },
    ],
  },
  {
    title: '产品',
    links: [
      { label: '模型广场', href: '/models' },
      { label: '用户门户', href: '/login' },
      { label: '管理后台', href: '/admin/login' },
    ],
  },
  {
    title: '支持',
    links: [
      { label: '用户协议', href: '/terms' },
      { label: '隐私政策', href: '/privacy' },
      { label: '联系方式', href: '/contact' },
      { label: '投诉举报', href: '/report' },
      { label: '安全致谢', href: '/security' },
    ],
  },
]

export function SiteFooter() {
  const { status, siteName } = useSite()
  // 年份若在渲染期直接 new Date()，SSG（Node 时区）与浏览器可能差一天/一年，
  // 触发 hydration 不一致（React #412/#418）。挂载后取一次即可。
  const [year, setYear] = useState(2026)
  useEffect(() => {
    setYear(new Date().getFullYear())
  }, [])

  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <BrandLogo />
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-ink-3">
            自托管、可私有部署的 LLM API 网关：统一多协议上游、精细计费、全量日志与审计。
          </p>
          <div className="mt-4">
            <LocaleSwitcher />
          </div>
        </div>

        {FOOTER_COLS.slice(1).map((col) => (
          <div key={col.title}>
            <div className="text-[13px] font-medium text-ink-2">{col.title}</div>
            <ul className="mt-3 space-y-1.5">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[13px] text-ink-3 transition hover:text-brand">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <div className="text-[13px] font-medium text-ink-2">开源</div>
          <div className="mt-3 space-y-1.5">
            <a
              href="https://gitee.com/xiaosu4610/AQUA-API"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[13px] text-ink-3 transition hover:text-brand"
            >
              Gitee 仓库 <AppIcon name="external" size={12} />
            </a>
            <a
              href="https://github.com/xiaosu4610/AQUA-API"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[13px] text-ink-3 transition hover:text-brand"
            >
              GitHub 仓库 <AppIcon name="external" size={12} />
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-line py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-ink-3 sm:px-6">
          <span>
            © {year} {status?.operator_name || siteName}
          </span>
          <div className="flex flex-wrap gap-x-4">
            {status?.icp_license && (
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-brand"
              >
                {status.icp_license}
              </a>
            )}
            {status?.police_license && <span>{status.police_license}</span>}
            {status?.contact_email && (
              <a href={`mailto:${status.contact_email}`} className="transition hover:text-brand">
                {status.contact_email}
              </a>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}