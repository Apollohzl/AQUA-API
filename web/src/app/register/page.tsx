/** 注册页：受站点 registration_enabled 开关控制；开启邮箱验证时必填邮箱验证码。
 *
 * 意图（Why）：
 *   注册成功即返回会话令牌，直接进入登录态。协议同意是后端强校验字段，
 *   前端把按钮置灰只是体验，真正拦住的是服务端。
 */
'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { BrandLogo } from '@/components/BrandMark'
import { sendEmailCode } from '@/api/auth'
import { SiteFooter } from '@/components/site/SiteFooter'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Form'
import { useAuth } from '@/lib/auth/auth-context'
import { useSite } from '@/lib/site/site-context'
import { useToast } from '@/lib/toast/toast-context'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const invite = searchParams.get('invite') || undefined
  const { signUp } = useAuth()
  const { status } = useSite()
  const { toast, toastError } = useToast()

  const requireEmailCode = Boolean(status?.email_code_required)
  const emailServiceReady = status?.email_service_ready !== false

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!username.trim() || password.length < 8) {
      setError('用户名必填，密码至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    if (!agreed) {
      setError('请先阅读并同意《用户协议》与《隐私政策》')
      return
    }
    if (requireEmailCode && !email.trim()) {
      setError('本站注册需要邮箱验证，请填写邮箱')
      return
    }
    setLoading(true)
    try {
      const user = await signUp({
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        code: code.trim() || undefined,
        agreed_terms: agreed,
        invite_code: invite,
      })
      router.replace(user.role === 10 ? '/admin' : '/console')
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
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

      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-ink">注册</h1>
          <p className="mt-1 text-[13px] text-ink-3">创建账号，马上接入模型</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="用户名" required>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="2-32 位，字母数字或下划线" autoComplete="username" />
            </Field>
            <Field label="密码" required help="至少 8 位">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位" autoComplete="new-password" />
            </Field>
            <Field label="确认密码" required>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入密码" autoComplete="new-password" />
            </Field>
            {requireEmailCode && (
              <>
                <Field label="邮箱" required help={emailServiceReady ? '验证码将发送到该邮箱' : '邮件服务未就绪，可能收不到验证码'}>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                </Field>
                <Field label="邮箱验证码" required>
                  <div className="flex gap-2">
                    <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" autoComplete="one-time-code" />
                    <SendCodeButton email={email} purpose="register" />
                  </div>
                </Field>
              </>
            )}

            <label className="flex items-start gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                我已阅读并同意 <Link href="/terms" className="text-brand hover:underline">《用户协议》</Link> 与{' '}
                <Link href="/privacy" className="text-brand hover:underline">《隐私政策》</Link>
              </span>
            </label>

            {error && <div className="rounded-md border border-err/25 bg-err/8 px-3 py-2 text-[13px] text-err">{error}</div>}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              注册
            </Button>
          </form>

          <div className="mt-4 text-center text-[13px]">
            已有账号？<Link href="/login" className="text-brand hover:underline">去登录</Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

function SendCodeButton({ email, purpose }: { email: string; purpose: 'register' | 'login' | 'reset' }) {
  const [countdown, setCountdown] = useState(0)
  const { toast, toastError } = useToast()

  async function handleSend() {
    if (!email.trim() || !email.includes('@')) {
      toastError('请先填写正确的邮箱')
      return
    }
    try {
      const result = await sendEmailCode(email.trim(), purpose)
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

  return (
    <Button type="button" variant="secondary" disabled={countdown > 0} onClick={handleSend} className="shrink-0 whitespace-nowrap">
      {countdown > 0 ? `${countdown}s` : '发送验证码'}
    </Button>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  )
}