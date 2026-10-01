/** 全局 Providers 装配：i18n + Toast + Auth + Site。
 *
 * 意图（Why）：
 *   App Router 根布局只需要挂一次；Auth 的 401 全局处理在这里挂接
 *   （清登录态 + 跳转登录页，等价旧 main.ts 的 setUnauthorizedHandler）。
 */
'use client'

import { useCallback, useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { setUnauthorizedHandler } from '@/api/client'
import { I18nProvider } from '@/i18n'
import { AuthProvider, useAuth } from '@/lib/auth/auth-context'
import { SiteProvider } from '@/lib/site/site-context'
import { ToastProvider } from '@/lib/toast/toast-context'

/** 401 时清登录态并跳回登录页（后台页面则跳超管登录入口） */
function UnauthorizedGate({ children }: { children: ReactNode }) {
  const { clearLocal } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const handle = useCallback(() => {
    clearLocal()
    const adminPath = pathname.startsWith('/admin')
    const loginPath = adminPath ? '/admin/login' : '/login'
    if (pathname === loginPath) return
    router.replace(loginPath)
  }, [clearLocal, pathname, router])

  useEffect(() => {
    setUnauthorizedHandler(handle)
    return () => setUnauthorizedHandler(null)
  }, [handle])

  return <>{children}</>
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <SiteProvider>
            <UnauthorizedGate>{children}</UnauthorizedGate>
          </SiteProvider>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  )
}