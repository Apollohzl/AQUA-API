/** 忘记密码页：邮箱验证码 → 设置新密码。
 *
 * 意图（Why）：
 *   复用邮箱验证码链路；成功后后端吊销该账号全部会话，
 *   因此本地登录态清零并引导重新登录。
 */
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { BrandLogo } from '@/components/BrandMark'
import { resetPassword, sendEmailCode } from '@/api/auth'
import { SiteFooter } from '@/components/site/SiteFooter'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Form'
import { useToast } from '@/lib/toast/toast-context'
import { clearSession } from '@/api/client'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const { toast, toastError } = useToast()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSend() {
    if (!email.trim() || !email.includes('@')) {
      toastError('请先填写正确的邮箱')
      return
    }
    try {
      const result = await sendEmailCode(email.trim(), 'reset')
      toast(result.message || '验证码已发送')
      if (result.cooldown > 0) {
        setCountdown(result.cooldown)
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '发送失败')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !code.trim() || password.length < 8) {
      setError('请完整填写邮箱、验证码与新密码（至少 8 位）')
      return
    }
    setLoading(true)
    try {
      await resetPassword(email.trim(), code.trim(), password)
      clearSession()
      toast('密码已重置，请用新密码登录')
      router.replace('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center border-b border-line bg-card px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandLogo />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-16 sm:py-24">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-ink">重置密码</h1>
          <p className="mt-1 text-[13px] text-ink-3">通过已验证邮箱重置登录密码</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="邮箱">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </Field>
            <Field label="验证码">
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" autoComplete="one-time-code" />
                <Button type="button" variant="secondary" disabled={countdown > 0} onClick={handleSend} className="shrink-0">
                  {countdown > 0 ? `${countdown}s` : '发送验证码'}
                </Button>
              </div>
            </Field>
            <Field label="新密码" help="至少 8 位">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="新密码" autoComplete="new-password" />
            </Field>

            {error && <div className="rounded-md border border-err/25 bg-err/8 px-3 py-2 text-[13px] text-err">{error}</div>}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              重置密码
            </Button>
          </form>

          <div className="mt-4 text-center text-[13px]">
            想起密码了？<Link href="/login" className="text-brand hover:underline">去登录</Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}