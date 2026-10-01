/** 管理后台布局（/admin/*）：鉴权守卫（管理员）+ 后台导航。
 *
 * 意图（Why）：
 *   后台全部页面需要「登录 + 管理员」双重权限。守卫在布局层统一完成，
 *   页面组件不必各自判断。导航按功能域分组（资源 / 合规 / 运维）。
 */
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { AppShell, type ShellNavGroup } from '@/components/AppShell'
import { useAuth } from '@/lib/auth/auth-context'
import { useToast } from '@/lib/toast/toast-context'

const GROUPS: ShellNavGroup[] = [
  {
    title: '总览',
    items: [
      { label: '仪表盘', href: '/admin', icon: 'home', exact: true },
      { label: '模型广场', href: '/admin/models', icon: 'grid' },
    ],
  },
  {
    title: '资源',
    items: [
      { label: '渠道管理', href: '/admin/channels', icon: 'server' },
      { label: '模型映射', href: '/admin/model-mappings', icon: 'layers' },
      { label: '模型分组', href: '/admin/groups', icon: 'tag' },
      { label: '计价规则', href: '/admin/prices', icon: 'quota' },
      { label: '异步任务', href: '/admin/tasks', icon: 'image' },
    ],
  },
  {
    title: '业务',
    items: [
      { label: '充值订单', href: '/admin/orders', icon: 'cart' },
      { label: '订阅账号', href: '/admin/oauth', icon: 'globe' },
      { label: '令牌管理', href: '/admin/tokens', icon: 'key' },
      { label: '用户管理', href: '/admin/users', icon: 'users' },
      { label: '兑换码', href: '/admin/redeem-codes', icon: 'tag' },
    ],
  },
  {
    title: '合规与运维',
    items: [
      { label: '调用日志', href: '/admin/logs', icon: 'list' },
      { label: '操作审计', href: '/admin/audit-logs', icon: 'shield' },
      { label: '站点公告', href: '/admin/announcements', icon: 'info' },
      { label: '内容安全', href: '/admin/sensitive-words', icon: 'filter' },
      { label: '运维监控', href: '/admin/maintenance', icon: 'trend' },
      { label: '系统设置', href: '/admin/settings', icon: 'sliders' },
    ],
  },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { ready, isLoggedIn, isAdmin } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const { toastError } = useToast()

  useEffect(() => {
    if (!ready) return
    // /admin/login 是独立登录入口，不参与后台守卫（否则出现死循环：未登录跳登录页、登录页又被守卫拦）
    if (pathname === '/admin/login') return
    if (!isLoggedIn) {
      router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`)
    } else if (!isAdmin) {
      toastError('没有权限访问管理后台')
      router.replace('/console')
    }
  }, [ready, isLoggedIn, isAdmin, pathname, router, toastError])

  if (pathname === '/admin/login') {
    // 登录页独立渲染：不套后台外壳，也不受守卫约束
    return <>{children}</>
  }

  if (!ready || !isLoggedIn || !isAdmin) {
    return <div className="flex min-h-screen items-center justify-center text-[13px] text-ink-3">正在进入管理后台…</div>
  }

  return (
    <AppShell groups={GROUPS} brand="管理后台">
      {children}
    </AppShell>
  )
}