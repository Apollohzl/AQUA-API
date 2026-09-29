<script setup lang="ts">
/**
 * 登录页（三种方式：账号密码 / 邮箱验证码 / 邮箱验证码重置密码）。
 *
 * 意图（Why）：
 *   登录是进入门户/后台的唯一入口，页面必须「干净聚焦」：
 *   只有必要信息（品牌、站点名、少量输入框、一个协议勾选、一个按钮），
 *   不放置营销内容分散注意力。
 *
 *   为什么要做「邮箱验证码登录 / 重置密码」：
 *   本站用户的登录名是注册时自己填的，隔一段时间极易忘记；
 *   而邮箱是唯一被验证过的身份凭据。把「找回用户名 + 找回密码」合并成
 *   一条自助通道，是流失用户能不能回来的关键。
 *
 * 流转（Flow）：
 *   密码登录   → stores/auth.signIn()        → POST /api/auth/login
 *   验证码登录 → stores/auth.signInWithEmail() → POST /api/auth/email-login
 *   重置密码   → api/auth.resetPassword()    → POST /api/auth/password-reset
 *              （成功后同账号全部会话被吊销，因此本页会引导重新登录）
 *   发验证码   → api/auth.sendEmailCode(email, purpose)，purpose 随模式切换
 *   → 跳转：优先 query.redirect（来源页），否则按角色 admin→/admin、普通→/console
 *
 * 扩展（Extend）：
 *   新增登录方式（如 OAuth）时，在 modes 里加一项 + 在下方加一个表单块，
 *   并复用 auth store 的会话落盘逻辑（applySession）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import { ApiError } from '@/api/client'
import { resetPassword, sendEmailCode, type EmailCodePurpose } from '@/api/auth'
import { toastError, toastSuccess } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'

const auth = useAuthStore()
const site = useSiteStore()
const router = useRouter()
const route = useRoute()

/** 三种模式。reset 是"用邮箱验证码重置密码"，不是已登录状态下的改密。 */
type Mode = 'password' | 'email' | 'reset'
const mode = ref<Mode>('password')

const MODES: { key: Mode; label: string }[] = [
  { key: 'password', label: '账号密码' },
  { key: 'email', label: '邮箱验证码' },
  { key: 'reset', label: '忘记密码' },
]

const username = ref('')
const password = ref('')
const showPassword = ref(false)

const email = ref('')
const code = ref('')
const newPassword = ref('')
const newPassword2 = ref('')

const submitting = ref(false)
const sendingCode = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

/** 重发倒计时（秒）；由后端返回的 cooldown 驱动，不在前端硬编码 */
const countdown = ref(0)
let countdownTimer: number | undefined

function stopCountdown(): void {
  if (countdownTimer !== undefined) {
    window.clearInterval(countdownTimer)
    countdownTimer = undefined
  }
}

function startCountdown(seconds: number): void {
  countdown.value = seconds > 0 ? seconds : 60
  stopCountdown()
  countdownTimer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) stopCountdown()
  }, 1000)
}

onBeforeUnmount(stopCountdown)

/**
 * 切换模式时清掉上一次的提示：
 * 留着"密码错误"的红字出现在验证码登录面板上，只会让人以为新面板也坏了。
 */
watch(mode, () => {
  errorMessage.value = ''
  successMessage.value = ''
})

/** 当前模式对应的验证码用途（决定后端用哪套邮件模板与哪张码表） */
const codePurpose = computed<EmailCodePurpose>(() =>
  mode.value === 'reset' ? 'reset' : 'login',
)

/**
 * 是否已勾选同意《用户协议》与《隐私政策》。
 *
 * 为什么登录也要同意：登录后进入控制台，其提交的调用内容仍受《用户协议》约束，
 * 把同意动作放在入口处，可避免"未明确同意即使用服务"的争议。
 *
 * 这里只做前端强制（提交时校验），不改动登录接口契约——
 * 登录接口被 CLI/脚本等 API 客户端复用，新增必传字段会直接打断既有集成。
 *
 * 为什么不用「未勾选就置灰按钮」：置灰只表达"不能点"，不表达"为什么不能点"，
 * 用户盯着一个灰按钮找不到原因。改为按钮始终可点、点击后就地提示。
 */
const agreedTerms = ref(false)

/** 未勾选协议的提示：显示在勾选框下方（就近显示，不混进页面级的登录错误） */
const termsError = ref('')

/** 用户补勾选后立即撤掉提示，不用再点一次提交才知道已经满足条件 */
watch(agreedTerms, (value) => {
  if (value) termsError.value = ''
})

/** 站点信息仍在加载时，注册入口显示为禁用态，避免误判「注册未开放」 */
const registrationReady = computed(() => !site.loading)

/**
 * 只接受站内相对路径作为回跳目标。
 * 为什么不直接用 query.redirect：避免开放重定向（?redirect=https://evil.com）被滥用。
 */
function resolveRedirect(fallback: string): string {
  const raw = route.query.redirect
  const target = Array.isArray(raw) ? raw[0] : raw
  if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')) return target
  return fallback
}

/** 登录成功后的统一跳转 */
async function afterSignIn(name: string): Promise<void> {
  toastSuccess(`欢迎回来，${name}`)
  const fallback = auth.isAdmin ? '/admin' : '/console'
  await router.replace(resolveRedirect(fallback))
}

/** 把异常转成给用户看的一句话 */
function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** 账号密码登录 */
async function handlePasswordLogin(): Promise<void> {
  errorMessage.value = ''
  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入账号（用户名或邮箱）与密码'
    return
  }
  // 协议同意：仅前端强制；后端登录接口不做此校验（见 agreedTerms 的说明）
  if (!agreedTerms.value) {
    termsError.value = '请先阅读并同意《用户协议》与《隐私政策》'
    return
  }
  termsError.value = ''

  submitting.value = true
  try {
    const user = await auth.signIn({ username: username.value.trim(), password: password.value })
    await afterSignIn(user.username)
  } catch (error) {
    errorMessage.value = describe(error, '登录失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/** 邮箱验证码登录 */
async function handleEmailLogin(): Promise<void> {
  errorMessage.value = ''
  if (!email.value.trim()) {
    errorMessage.value = '请输入邮箱'
    return
  }
  if (!code.value.trim()) {
    errorMessage.value = '请输入邮件中的验证码'
    return
  }
  if (!agreedTerms.value) {
    termsError.value = '请先阅读并同意《用户协议》与《隐私政策》'
    return
  }
  termsError.value = ''

  submitting.value = true
  try {
    const user = await auth.signInWithEmail(email.value.trim(), code.value.trim())
    await afterSignIn(user.username)
  } catch (error) {
    errorMessage.value = describe(error, '登录失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/** 邮箱验证码重置密码 */
async function handleResetPassword(): Promise<void> {
  errorMessage.value = ''
  successMessage.value = ''
  if (!email.value.trim()) {
    errorMessage.value = '请输入邮箱'
    return
  }
  if (!code.value.trim()) {
    errorMessage.value = '请输入邮件中的验证码'
    return
  }
  if (!newPassword.value) {
    errorMessage.value = '请输入新密码'
    return
  }
  if (newPassword.value !== newPassword2.value) {
    errorMessage.value = '两次输入的新密码不一致'
    return
  }

  submitting.value = true
  try {
    await resetPassword(email.value.trim(), code.value.trim(), newPassword.value)
    // 后端已吊销该账号全部会话，这里清掉本地残留并回到密码登录
    auth.clearLocal()
    newPassword.value = ''
    newPassword2.value = ''
    code.value = ''
    // 把邮箱回填进账号框：登录已支持"邮箱 + 密码"，用户改完密码
    // 不必再想"我的用户名叫什么"，直接输入新密码即可登录。
    username.value = email.value.trim()
    mode.value = 'password'
    successMessage.value = '密码已重置，请用新密码登录'
    toastSuccess('密码已重置，请用新密码登录')
  } catch (error) {
    errorMessage.value = describe(error, '重置失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/** 发送验证码（用途随当前模式切换） */
async function handleSendCode(): Promise<void> {
  errorMessage.value = ''
  const value = email.value.trim()
  if (!value) {
    errorMessage.value = '请先填写邮箱'
    return
  }
  if (countdown.value > 0 || sendingCode.value) return

  sendingCode.value = true
  try {
    const result = await sendEmailCode(value, codePurpose.value)
    startCountdown(result.cooldown || 60)
    toastSuccess('验证码已发送，请查收邮件（含垃圾箱）')
  } catch (error) {
    // 后端对未注册邮箱也回成功（防邮箱枚举），因此这里只会是限流或发信失败
    toastError(describe(error, '验证码发送失败，请稍后重试'))
  } finally {
    sendingCode.value = false
  }
}

/** 站点信息加载失败时，至少保证登录功能可用（提示条给出重试入口） */
function reloadSite(): void {
  void site.load(true)
  toastError(site.error || '重试中…')
}
</script>

<template>
  <div class="relative flex min-h-screen flex-col bg-ink-950">
    <!-- 背景：克制的一处光斑 + 网格，与落地页保持同一视觉语言 -->
    <div class="pointer-events-none absolute inset-0 bg-grid opacity-40" aria-hidden="true" />
    <div
      class="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-500/15 blur-[100px]"
      aria-hidden="true"
    />

    <header class="relative mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 lg:px-8">
      <RouterLink to="/" class="flex items-center gap-2.5">
        <img src="/favicon.ico" alt="" class="h-7 w-7 rounded-lg" />
        <span class="text-sm font-semibold text-ink-50">{{ site.siteName }}</span>
      </RouterLink>
      <RouterLink to="/" class="btn btn-ghost btn-sm">
        <AppIcon name="chevron-left" :size="14" />
        返回首页
      </RouterLink>
    </header>

    <main class="relative flex flex-1 items-center justify-center px-5 pb-16">
      <div class="w-full max-w-md">
        <!-- 站点信息异常提示：登录本身不受影响 -->
        <div
          v-if="site.error"
          class="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800"
        >
          <AppIcon name="alert" :size="15" class="text-amber-700" />
          <span class="flex-1">站点信息加载失败，登录仍可继续。</span>
          <button type="button" class="btn btn-ghost btn-sm text-amber-800" @click="reloadSite">重试</button>
        </div>

        <div class="card card-pad shadow-pop">
          <div>
            <h1 class="font-display text-xl font-semibold tracking-tight text-ink-50">登录 {{ site.siteName }}</h1>
            <p class="mt-1.5 text-sm text-ink-400">
              {{ mode === 'reset' ? '用邮箱验证码设置新密码。' : '登录后即可管理访问令牌与调用记录。' }}
            </p>
          </div>

          <!-- 三种方式切换：忘记用户名也能进来（邮箱验证码），忘记密码也能自助重置 -->
          <div class="seg mt-5" role="tablist" aria-label="登录方式">
            <button
              v-for="item in MODES"
              :key="item.key"
              type="button"
              role="tab"
              class="seg-item"
              :class="mode === item.key ? 'seg-item-active' : ''"
              :aria-selected="mode === item.key"
              :disabled="submitting"
              @click="mode = item.key"
            >
              {{ item.label }}
            </button>
          </div>

          <!-- 邮箱验证码（登录与重置共用一段邮箱 + 验证码输入） -->
          <div v-if="mode !== 'password'" class="mt-5">
            <label class="label" for="login-email">邮箱</label>
            <input
              id="login-email"
              v-model="email"
              class="input"
              type="email"
              autocomplete="email"
              placeholder="请输入注册时填写的邮箱"
              :disabled="submitting"
            />
            <p class="mt-1 text-xs text-ink-500">验证码会发送到这个邮箱，5 分钟内有效。</p>
          </div>

          <div v-if="mode !== 'password'" class="mt-4">
            <label class="label" for="login-code">邮箱验证码</label>
            <div class="flex gap-2">
              <input
                id="login-code"
                v-model="code"
                class="input flex-1"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="6 位数字"
                :disabled="submitting"
              />
              <button
                type="button"
                class="btn btn-secondary shrink-0"
                :disabled="submitting || sendingCode || countdown > 0"
                @click="handleSendCode"
              >
                {{ countdown > 0 ? `${countdown} 秒后重发` : sendingCode ? '发送中…' : '获取验证码' }}
              </button>
            </div>
          </div>

          <form
            v-if="mode === 'password'"
            class="mt-5 space-y-4"
            @submit.prevent="handlePasswordLogin"
          >
            <div>
              <label class="label" for="login-username">用户名或邮箱</label>
              <input
                id="login-username"
                v-model="username"
                class="input"
                type="text"
                autocomplete="username"
                placeholder="请输入用户名或绑定的邮箱"
                :disabled="submitting"
              />
            </div>

            <div>
              <label class="label" for="login-password">密码</label>
              <div class="relative">
                <input
                  id="login-password"
                  v-model="password"
                  class="input pe-10"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  placeholder="请输入密码"
                  :disabled="submitting"
                />
                <button
                  type="button"
                  class="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-400 transition-colors hover:text-ink-200"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <AppIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
                </button>
              </div>
            </div>

            <button type="submit" class="btn btn-primary w-full" :disabled="submitting">
              <span
                v-if="submitting"
                class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              <AppIcon v-else name="lock" :size="16" />
              {{ submitting ? '登录中…' : '登录' }}
            </button>
          </form>

          <form
            v-else-if="mode === 'email'"
            class="mt-5 space-y-4"
            @submit.prevent="handleEmailLogin"
          >
            <button type="submit" class="btn btn-primary w-full" :disabled="submitting">
              <span
                v-if="submitting"
                class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              <AppIcon v-else name="mail" :size="16" />
              {{ submitting ? '登录中…' : '验证码登录' }}
            </button>
          </form>

          <form v-else class="mt-5 space-y-4" @submit.prevent="handleResetPassword">
            <div>
              <label class="label" for="reset-password">新密码</label>
              <input
                id="reset-password"
                v-model="newPassword"
                class="input"
                type="password"
                autocomplete="new-password"
                placeholder="请设置新密码"
                :disabled="submitting"
              />
            </div>
            <div>
              <label class="label" for="reset-password2">确认新密码</label>
              <input
                id="reset-password2"
                v-model="newPassword2"
                class="input"
                type="password"
                autocomplete="new-password"
                placeholder="请再次输入新密码"
                :disabled="submitting"
              />
            </div>
            <p class="text-xs text-ink-500">
              重置成功后，该账号此前所有登录状态都会失效，需要用新密码重新登录。
            </p>

            <button type="submit" class="btn btn-primary w-full" :disabled="submitting">
              <span
                v-if="submitting"
                class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              <AppIcon v-else name="lock" :size="16" />
              {{ submitting ? '处理中…' : '重置密码' }}
            </button>
          </form>

          <!-- 协议同意：登录入口同样要求明示同意《用户协议》与《隐私政策》。
               重置密码不需要（那只是找回自己的账号），因此只在两种登录模式下显示。 -->
          <div v-if="mode !== 'reset'" class="mt-4">
            <label class="flex items-start gap-2 text-xs leading-relaxed text-ink-400">
              <input
                v-model="agreedTerms"
                type="checkbox"
                class="mt-0.5 h-4 w-4 shrink-0 rounded"
                :class="termsError ? 'border-red-500/60' : 'border-ink-600'"
                :disabled="submitting"
              />
              <span>
                我已阅读并同意
                <RouterLink to="/terms" target="_blank" class="font-medium text-brand-700 hover:underline">
                  《用户协议》
                </RouterLink>
                与
                <RouterLink to="/privacy" target="_blank" class="font-medium text-brand-700 hover:underline">
                  《隐私政策》
                </RouterLink>
              </span>
            </label>
            <p v-if="termsError" class="field-error">{{ termsError }}</p>
          </div>

          <!-- 成功态：重置密码后回到密码登录，用绿字确认"确实改成功了" -->
          <p
            v-if="successMessage"
            class="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-800"
          >
            <AppIcon name="check" :size="14" class="mt-0.5 shrink-0" />
            {{ successMessage }}
          </p>

          <!-- 错误态：贴在协议区下方、按钮之外，视线自然落点 -->
          <p
            v-if="errorMessage"
            class="mt-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-800"
          >
            <AppIcon name="alert" :size="14" class="mt-0.5 shrink-0" />
            {{ errorMessage }}
          </p>

          <div class="mt-5 border-t border-ink-800 pt-4 text-center text-xs text-ink-400">
            <template v-if="!registrationReady">
              <span>正在获取站点信息…</span>
            </template>
            <template v-else-if="site.registrationEnabled">
              还没有账号？
              <RouterLink to="/register" class="font-medium text-brand-700 transition-colors hover:text-brand-700">
                立即注册
              </RouterLink>
            </template>
            <template v-else>
              本站点未开放自助注册，请联系管理员开通账号。
            </template>
          </div>
        </div>

        <p class="mt-4 text-center text-xs leading-relaxed text-ink-500">
          登录凭据仅用于访问本网关控制台；调用模型需另外创建访问令牌。
        </p>
      </div>
    </main>
  </div>
</template>
