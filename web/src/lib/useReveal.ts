/** useReveal：滚动进场（React 版，等价旧 Vue 指令 v-reveal）。
 *
 * 意图（Why）：
 *   落地页区块按顺序淡入上移，避免一次性全部涌现造成的认知负荷；
 *   尊重 prefers-reduced-motion，并在 JS 未执行时默认可见。
 */
'use client'

import { useEffect, useRef } from 'react'

export function useReveal<T extends HTMLElement = HTMLDivElement>(delayMs = 0) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (reduceMotion || typeof IntersectionObserver === 'undefined') return

    el.classList.add('reveal')
    if (delayMs > 0) el.style.setProperty('--rd', `${delayMs}ms`)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('reveal-in')
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [delayMs])

  return ref
}