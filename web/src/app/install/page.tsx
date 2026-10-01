/** 安装向导页：创建第一个管理员账号。
 *
 * 意图（Why）：
 *   新部署实例里没有账号，需要「登录之前就能访问」的入口；
 *   已安装时后端会返回 409，页面转为「去登录」引导态。
 */
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { AppIcon } from '@/components/AppIcon'
import { fetchInstallStatus, submitInstall, type InstallStatus } from '@/api/install'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Form'
import { useToast } from '@/lib/toast/toast-context'

export default function InstallPage() {
  const router = useRouter()
  const { toastError } = useToast()

  const [installed, setInstalled] = useState<boolean | null>(null)
  const [siteName, setSiteName] = useState('')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const status: InstallStatus = await fetchInstallStatus()
      setInstalled(status.installed)
      setSiteName(status.site_name)
    } catch {
      setInstalled(true) // 状态查询失败按已安装处理，避免误导用户重复安装
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      const result = await submitInstall({
        username: username.trim() || 'admin',
        password,
        confirm_password: confirm,
        site_name: siteName.trim() || undefined,
      })
      router.replace(result.admin_login_path || '/admin/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败')
    } finally {
      setLoading(false)
    }
  }

  if (installed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-3">
        正在检查安装状态…
      </div>
    )
  }

  if (installed) {
    return (
      <div className="flex min-h-screen flex-col bg-surface">
        <header className="flex h-14 items-center border-b border-line bg-card px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
              <AppIcon name="bolt" size={16} />
            </span>
            <span className="font-semibold text-ink">{siteName || 'AQUA-API'}</span>
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-sm text-center">
            <h1 className="text-xl font-bold text-ink">已完成安装</h1>
            <p className="mt-2 text-[13px] text-ink-3">系统已配置管理员账号，请前往后台登录。</p>
            <div className="mt-6">
              <Button variant="primary" size="lg" onClick={() => router.push('/admin/login')}>
                前往后台登录
              </Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="flex h-14 items-center border-b border-line bg-card px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
            <AppIcon name="bolt" size={16} />
          </span>
          <span className="font-semibold text-ink">安装向导</span>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-ink">创建管理员</h1>
          <p className="mt-1 text-[13px] text-ink-3">这是第一次安装，请设置站点管理员账号</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="站点名称" help="显示在页面标题与页脚">
              <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="例如：AQUA-API 网关" />
            </Field>
            <Field label="管理员用户名">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="username" />
            </Field>
            <Field label="管理员密码" required help="至少 8 位">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位" autoComplete="new-password" />
            </Field>
            <Field label="确认密码" required>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入" autoComplete="new-password" />
            </Field>

            {error && <div className="rounded-md border border-err/25 bg-err/8 px-3 py-2 text-[13px] text-err">{error}</div>}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              完成安装
            </Button>
          </form>

          <div className="mt-4 text-center text-[13px]">
            已有账号？<Link href="/login" className="text-brand hover:underline">去登录</Link>
          </div>
        </div>
      </main>
    </div>
  )
}