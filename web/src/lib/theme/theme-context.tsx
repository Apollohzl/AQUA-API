/** 主题 Provider：昼 / 夜双主题 + 北京时间（UTC+8）自动切换。
 *
 * 意图（Why）：
 *   全站两套令牌（globals.css 的 @theme 昼色与 html.dark 夜色）由本 Provider 驱动。
 *   默认 auto 模式跟随北京时间自动切换——白天暖白纸、夜晚深墨；
 *   用户也可在顶栏手动锁定「日间 / 夜间」。切换时挂 .theme-anim 做颜色平滑过渡。
 *
 * 流转（Flow）：
 *   root layout 内联脚本（首帧防闪烁：按 localStorage + 北京时间预设 html.dark）
 *   → ThemeProvider 挂载（读取真实状态、每分钟校正、跨昼夜分界自动换肤）
 *   → ThemeToggle（用户手动切 auto/light/dark，写 localStorage）
 *
 * 扩展（Extend）：
 *   调整昼夜分界：改 DAY_START / DAY_END（北京时间小时）。改色板在 globals.css。
 */
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ThemeMode = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'aqua.theme'
/** 白天区间（北京时间小时）：[DAY_START, DAY_END) 视为日间，其余为夜间 */
export const DAY_START = 6
export const DAY_END = 18

interface ThemeContextValue {
  /** 用户选择的模式 */
  mode: ThemeMode
  /** 实际生效的主题（auto 时由北京时间推导） */
  resolved: ResolvedTheme
  /** 当前北京时间（小时，含小数，供 UI 显示与说明「正在跟随」） */
  beijingHour: number
  setMode: (m: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** 取北京时间的小时数（含小数）。与设备时区无关：按 UTC+8 计算。 */
export function beijingHourNow(d: Date = new Date()): number {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const bj = new Date(utcMs + 8 * 3_600_000)
  return bj.getHours() + bj.getMinutes() / 60
}

/** 由模式 + 北京时间推导实际主题 */
export function resolveTheme(mode: ThemeMode, hour: number = beijingHourNow()): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode
  return hour >= DAY_START && hour < DAY_END ? 'light' : 'dark'
}

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto'
  const v = window.localStorage.getItem(THEME_STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto'
}

/** 应用主题到 <html>；animate=true 时临时挂 .theme-anim 让颜色平滑过渡 */
function applyTheme(resolved: ResolvedTheme, animate: boolean) {
  const el = document.documentElement
  if (animate) {
    el.classList.add('theme-anim')
    window.setTimeout(() => el.classList.remove('theme-anim'), 700)
  }
  el.classList.toggle('dark', resolved === 'dark')
  el.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('auto')
  const [resolved, setResolved] = useState<ResolvedTheme>('light')
  const [beijingHour, setBeijingHour] = useState(12)
  const mounted = useRef(false)

  // 挂载后读取真实模式与时间（首帧样式由 root layout 内联脚本预设，避免闪烁）
  useEffect(() => {
    const m = readStoredMode()
    const h = beijingHourNow()
    const r = resolveTheme(m, h)
    setModeState(m)
    setBeijingHour(h)
    setResolved(r)
    applyTheme(r, false)
    mounted.current = true
  }, [])

  // auto 模式：每分钟校正一次，跨过昼夜分界时自动换肤（带过渡）
  useEffect(() => {
    if (mode !== 'auto') return
    const tick = () => {
      const h = beijingHourNow()
      setBeijingHour(h)
      const r = resolveTheme('auto', h)
      setResolved((prev) => {
        if (prev !== r && mounted.current) applyTheme(r, true)
        return r
      })
    }
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [mode])

  const setMode = useCallback((m: ThemeMode) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, m)
    const h = beijingHourNow()
    setModeState(m)
    setBeijingHour(h)
    setResolved(resolveTheme(m, h))
    applyTheme(resolveTheme(m, h), true)
  }, [])

  const value = useMemo(
    () => ({ mode, resolved, beijingHour, setMode }),
    [mode, resolved, beijingHour, setMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}

/** 供 root layout 内联注入的首帧脚本：在 hydration 前按 localStorage + 北京时间设 html.dark，
 *  避免「先亮后暗」的闪烁。与 ThemeProvider 的逻辑保持一致。 */
export const THEME_INIT_SCRIPT = `(function(){try{
var m=localStorage.getItem('${THEME_STORAGE_KEY}')||'auto';
var h=new Date(Date.now()+8*3600000).getUTCHours();
var dark=(m==='dark')||(m!=='light'&&(h<${DAY_START}||h>=${DAY_END}));
var e=document.documentElement;
if(dark)e.classList.add('dark');
e.style.colorScheme=dark?'dark':'light';
}catch(_){}})();`
