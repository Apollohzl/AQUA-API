/** 404 页：未命中路由的兜底。
 */
'use client'

import Link from 'next/link'

import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/Button'
import { SiteFooter } from '@/components/site/SiteFooter'
import { BrandLogo } from '@/components/BrandMark'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center border-b border-line bg-card px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandLogo />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="text-6xl font-bold text-ink-3">404</div>
        <h1 className="mt-3 text-xl font-semibold text-ink">页面不存在</h1>
        <p className="mt-2 text-[13px] text-ink-3">你访问的地址不存在或已被移动。</p>
        <div className="mt-6">
          <Link href="/">
            <Button variant="primary">返回首页</Button>
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}