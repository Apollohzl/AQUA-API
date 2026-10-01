/** 昼夜主题切换器：自动（跟随北京时间）/ 日间 / 夜间 三选一。
 *
 * 意图（Why）：
 *   站点提供「昼 / 夜」两套视觉，默认跟随北京时间自动切换；
 *   顶栏给出显式选择入口，并说明「自动」当前正跟随到什么时段，
 *   让用户理解为什么此刻是这个色调（而非觉得主题在乱跳）。
 *
 * 流转（Flow）：
 *   点击 → useTheme().setMode() → 写 localStorage + 切换 html.dark（带 .theme-anim 过渡）
 *
 * 扩展（Extend）：
 *   新增模式：在 theme-context 的 ThemeMode 加值 + 下方 OPTIONS 加一项。
 */
'use client'

import { useEffect, useRef, useState } from 'react'

import { AppIcon, type IconName } from '@/components/AppIcon'
import { useTheme, type ThemeMode } from '@/lib/theme/theme-context'

const OPTIONS: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: 'auto', label: '自动（北京时间）', icon: 'monitor' },
  { value: 'light', label: '日间', icon: 'sun' },
  { value: 'dark', label: '夜间', icon: 'moon' },
]

/** 把北京时间小时数转成「正在跟随：白天/夜晚」提示 */
function phaseLabel(hour: number): string {
  return hour >= 6 && hour < 18 ? '白天' : '夜晚'
}

/** 把北京时间小时数格式化为 HH:MM */
function formatBeijing(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.floor((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, resolved, beijingHour, setMode } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const currentIcon: IconName = mode === 'auto' ? 'monitor' : resolved === 'dark' ? 'moon' : 'sun'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-ink-2 transition hover:bg-ink/5 hover:text-ink"
        aria-label="切换昼夜主题"
        title="切换主题"
      >
        <AppIcon name={currentIcon} size={15} />
        {!compact && <AppIcon name="chevron-down" size={13} />}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-md border border-line bg-card py-1 shadow-pop">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setMode(opt.value)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition hover:bg-surface ${
                opt.value === mode ? 'text-brand' : 'text-ink-2'
              }`}
            >
              <AppIcon name={opt.icon} size={15} />
              <span className="flex-1">{opt.label}</span>
              {opt.value === mode && <AppIcon name="check" size={14} />}
            </button>
          ))}

          {/* 说明当前自动判断依据：让「为什么现在是这个色调」一目了然 */}
          <div className="mt-1 border-t border-line px-3 pb-1.5 pt-2 text-[12px] leading-relaxed text-ink-3">
            北京时间 {formatBeijing(beijingHour)} · {phaseLabel(beijingHour)}
            <br />
            自动模式在 06:00–18:00 用日间，其余时段用夜间。
          </div>
        </div>
      )}
    </div>
  )
}
