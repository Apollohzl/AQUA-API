/** SiteHeader：公共站顶栏——普通头部，不悬浮、不居中。
 *
 * 意图（Why）：
 *   用户明确否掉了 SaaS 官网那套「sticky 顶栏 + 居中大布局」骨架，
 *   要求极简个人主页 + 普通不悬浮头部。这里改成：
 *   - 不 sticky：滚动时跟着页面走，不再悬浮覆盖；
 *   - 左对齐窄栏：与正文同宽（max-w-2xl），不是横贯全屏；
 *   - 导航收敛：只留「模型广场 / 登录·注册」，不铺一排锚点。
 */
'use client'

import Link from 'next/link'

import { AppIcon } from '@/components/AppIcon'
import { BrandLogo } from '@/components/BrandMark'
import { useAuth } from '@/lib/auth/auth-context'

import { LocaleSwitcher } from './LocaleSwitcher'
import { ThemeToggle } from './ThemeToggle'

export function SiteHeader({ transparent: _transparent = false }: { transparent?: boolean }) {
  const { isLoggedIn, displayName } = useAuth()

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="返回首页">
          <BrandLogo />
        </Link>

        <div className="flex items-center gap-1.5">
          <ThemeToggle compact />
          <LocaleSwitcher compact />
          {isLoggedIn ? (
            <Link
              href="/console"
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-medium text-brand transition hover:bg-ink/5"
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