/** 根布局：全局 Provider + 基础文档元信息。
 *
 * 意图（Why）：
 *   所有页面共享：HTML 语言方向（i18n 管理）、全局样式、Provider 树。
 *   本层不包含任何定时渲染（SSG），只做装配。
 *
 * 流转（Flow）：
 *   providers.tsx（i18n/toast/auth/site）→ 各页面
 */
import type { Metadata } from 'next'

import { Providers } from '@/lib/providers'

import './globals.css'

export const metadata: Metadata = {
  title: 'AQUA-API · 自托管 LLM API 网关',
  description: '自托管、可私有部署的 LLM API 网关：统一多协议上游、精细计费、全量日志与审计。',
  viewport: 'width=device-width, initial-scale=1',
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}