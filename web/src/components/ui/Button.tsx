/** Button：全站统一按钮（React 版）。
 *
 * 视觉语言（CRAP 的「重复」）：
 *   - primary：品牌强调色，唯一的主行动按钮；
 *   - secondary：中性描边，次行动；
 *   - ghost：无底无框，弱行动（导航内）。
 * 所有按钮统一圆角/字号/高度，保证扫视时「长得一样的按钮是同一种优先级」。
 */
'use client'

import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'invert'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand/90 active:bg-brand/80 shadow-sm',
  secondary:
    'bg-card text-ink border border-line-2 hover:border-ink-3 hover:bg-surface active:bg-surface/70',
  ghost: 'text-ink-2 hover:text-ink hover:bg-ink/5',
  danger: 'bg-err text-white hover:bg-err/90 active:bg-err/80',
  invert: 'bg-white text-brand hover:bg-white/90 shadow-sm',
}

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-[15px] gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center rounded-md font-medium transition
        active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50
        ${variantClass[variant]} ${sizeClass[size]} ${className ?? ''}`}
      {...rest}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
})