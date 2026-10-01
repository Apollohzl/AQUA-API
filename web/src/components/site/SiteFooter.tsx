/** SiteFooter：公共站页脚——个人主页式窄栏，去多栏膨胀。
 *
 * 意图（Why）：
 *   呼应「极简个人主页」重构：不再四栏堆链接，只留必要的一行
 *   （品牌版权 + 合规字段 + 少数字面链接），其余全部收敛。
 */

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useSite } from '@/lib/site/site-context'

export function SiteFooter() {
  const { status, siteName } = useSite()
  // 年份在挂载后取值，避免 SSG 与浏览器时区差异触发 hydration 不一致。
  const [year, setYear] = useState(2026)
  useEffect(() => {
    setYear(new Date().getFullYear())
  }, [])

  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-ink-3">
            © {year} {status?.operator_name || siteName}
          </span>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Link href="/models" className="text-ink-2 transition hover:text-brand">
              模型广场
            </Link>
            <Link href="/terms" className="text-ink-2 transition hover:text-brand">
              用户协议
            </Link>
            <Link href="/privacy" className="text-ink-2 transition hover:text-brand">
              隐私政策
            </Link>
            <Link href="/contact" className="text-ink-2 transition hover:text-brand">
              联系方式
            </Link>
            <a
              href="https://gitee.com/xiaosu4610/AQUA-API"
              target="_blank"
              rel="noreferrer"
              className="text-ink-2 transition hover:text-brand"
            >
              源码
            </a>
          </nav>
        </div>

        {(status?.icp_license || status?.police_license || status?.contact_email) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            {status.icp_license && (
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-brand"
              >
                {status.icp_license}
              </a>
            )}
            {status.police_license && <span>{status.police_license}</span>}
            {status.contact_email && (
              <a href={`mailto:${status.contact_email}`} className="transition hover:text-brand">
                {status.contact_email}
              </a>
            )}
          </div>
        )}
      </div>
    </footer>
  )
}