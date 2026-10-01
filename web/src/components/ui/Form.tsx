/** 表单控件：Input / Textarea / Select / Switch / Field。
 *
 * 意图（Why）：
 *   统一所有表单控件的视觉（对齐、边框、焦点环、禁用态），
 *   并把「标签 + 控件 + 帮助文案」组合成 Field，避免每个表单页面重复排版。
 */
'use client'

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const controlBase =
  'h-9.5 w-full rounded-md border border-line-2 bg-card px-3 text-sm text-ink placeholder:text-ink-3 ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:bg-surface disabled:text-ink-3 transition'

/* ── Input / Textarea / Select ─────────────────────────── */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={`${controlBase} ${className ?? ''}`} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={`${controlBase} h-auto min-h-24 py-2 ${className ?? ''}`} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`${controlBase} appearance-none pr-8 ${className ?? ''}`} {...rest}>
      {children}
    </select>
  )
})

/* ── Switch：开关 ───────────────────────────────────────── */

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}

export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-brand' : 'bg-ink/15'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

/* ── Field：标签 + 控件 + 帮助 ──────────────────────────── */

interface FieldProps {
  label: string
  htmlFor?: string
  required?: boolean
  help?: string
  error?: string
  children: ReactNode
}

export function Field({ label, htmlFor, required, help, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-err">*</span>}
      </label>
      {children}
      {error ? (
        <div className="text-xs text-err">{error}</div>
      ) : help ? (
        <div className="text-xs text-ink-3">{help}</div>
      ) : null}
    </div>
  )
}