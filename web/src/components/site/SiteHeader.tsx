/** SiteHeader：公共站顶栏（React 版，等价旧 LandingView 的顶栏 + SiteFooter 的顶栏逻辑）。
 *
 * 意图（Why）：
 *   未登录访客的导航：品牌 → 锚点/页面 → 登录/注册 CTA。
 *   滚动后从「透明叠在 hero 上」切换为「白底描边」，保持内容可读。
 */
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { AppIcon } from '@/components/AppIcon'
import { BrandLogo } from '@/components/BrandMark'
import { useAuth } from '@/lib/auth/auth-context'

import { LocaleSwitcher } from './LocaleSwitcher'
import { ThemeToggle } from './ThemeToggle'

interface NavLink {
  label: string
  href: string
  /** 落地页锚点（#terminal 等） */
  anchor?: boolean
}

const NAV_LINKS: NavLink[] = [
  { label: '能力', href: '#capabilities', anchor: true },
  { label: '模型广场', href: '/models' },
  { label: '接入示例', href: '#terminal', anchor: true },
  { label: '常见问题', href: '#faq', anchor: true },
]

export function SiteHeader({ transparent = true }: { transparent?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const { isLoggedIn, isAdmin, displayName } = useAuth()

  useEffect(() => {
    if (!transparent) return
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [transparent])

  const solid = !transparent || scrolled

  return (
    <header
      className={`sticky top-0 z-30 transition-all ${solid ? 'border-b border-line bg-surface/90 backdrop-blur' : 'border-b border-transparent'}`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="返回首页">
          <BrandLogo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-[13px] transition ${
                solid ? 'text-ink-2 hover:bg-ink/5 hover:text-ink' : 'text-ink-2 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <ThemeToggle compact />
          <LocaleSwitcher compact />
          {isLoggedIn ? (
            <Link
              href={isAdmin ? '/admin' : '/console'}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-brand/90"
            >
              {displayName}
              <AppIcon name="chevron-right" size={14} />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-[13px] text-ink-2 transition hover:bg-ink/5 hover:text-ink"
              >
                登录
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-brand/90"
              >
                注册
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}