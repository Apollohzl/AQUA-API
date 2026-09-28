/**
 * 浮层（弹窗 / 抽屉）的公共无障碍行为与滚动锁。
 *
 * 意图（Why）：
 *   Modal 与 Drawer 要处理同样的三件事：ESC 关闭、Tab 焦点留在浮层内、
 *   打开期间锁住 body 滚动。此前两者各自实现，且滚动锁是"直接置 hidden / 直接置空"，
 *   因此暴露出两个真实缺陷：
 *     1) 浮层叠浮层时（编辑渠道抽屉 → 打开密钥池抽屉），关闭上层会把 body 解锁，
 *        此时下层仍开着，背景却已经能跟着手指滚 —— 观感上像"抽屉在漏"；
 *     2) 关闭浮层后焦点没有归还给触发它的按钮，键盘/读屏用户被"扔"回页面顶部。
 *
 *   所以这里收敛成一处：滚动锁用引用计数（谁最后释放谁负责恢复原值，
 *   且恢复的是进入前的原值而不是硬编码的空串），焦点做"进入移入 / 退出归还"。
 *
 * 流转（Flow）：
 *   打开 → acquireScrollLock() + 记录触发元素 + 焦点移入浮层首个可聚焦元素
 *   关闭 → releaseScrollLock() + 焦点归还触发元素
 *   AppShell 的移动端抽屉只用 acquire/release（它自带视觉焦点，不需要陷阱）
 *
 * 扩展（Extend）：
 *   需要"多层浮层只关最上层"时，在此维护一个浮层栈，栈顶负责响应 ESC。
 */
import { onBeforeUnmount, watch, type Ref } from 'vue'

/** 当前有多少个浮层持有滚动锁（>0 时 body 不可滚动） */
let lockCount = 0
/** 第一个浮层进入前的 body overflow 原值，最后一个浮层退出时原样恢复 */
let savedOverflow = ''

/** 获取滚动锁（可重入：同一浮层重复调用只会加一次，见下方的 acquired 标记） */
export function acquireScrollLock(): void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
}

/** 释放滚动锁（计数归零才真正解锁） */
export function releaseScrollLock(): void {
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount === 0) document.body.style.overflow = savedOverflow
}

/** 可聚焦元素的候选选择器（与浏览器默认的可 Tab 顺序基本一致） */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return []
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * 为浮层安装 ESC 关闭、Tab 焦点陷阱、滚动锁与焦点归还。
 *
 * @param options.open    浮层开关（传 getter，如 `() => props.open`）
 * @param options.panel   浮层面板元素引用（需带 tabindex="-1" 作为无子元素时的焦点落点）
 * @param options.onEscape 按下 ESC 时的处理（通常是 emit('close')）
 */
export function useDialogA11y(options: {
  open: () => boolean
  panel: Ref<HTMLElement | null>
  onEscape: () => void
}): void {
  /** 关闭后要把焦点还回去的元素（打开时的 document.activeElement） */
  let restoreTo: HTMLElement | null = null
  /** 本实例是否持有滚动锁，避免卸载时误减别人的计数 */
  let acquired = false

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      options.onEscape()
      return
    }
    if (event.key !== 'Tab') return

    const panel = options.panel.value
    if (!panel) return
    const items = focusableIn(panel)
    if (!items.length) {
      // 没有任何可聚焦子元素时，焦点保持在面板上，不逃到背景页
      event.preventDefault()
      panel.focus()
      return
    }

    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement

    // 焦点跑到浮层之外（例如用户点了地址栏再按 Tab 回来）也拉回面板内
    if (!panel.contains(active)) {
      event.preventDefault()
      first.focus()
      return
    }
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  /**
   * 打开后把焦点移到哪里。
   *
   * 优先级：带 autofocus 的控件 → 面板本身。
   * 为什么不是"面板内第一个可聚焦元素"：弹窗结构里第一个可聚焦元素几乎总是
   * 右上角的关闭按钮，打开即聚焦它意味着按一次回车就把弹窗关了；
   * 聚焦面板（tabindex="-1"）则会让读屏先念出 aria-label 的标题，
   * 再按 Tab 进入内容，顺序更自然，也不会误关。
   */
  function focusOnOpen(): void {
    const panel = options.panel.value
    if (!panel) return
    const autofocusTarget = panel.querySelector<HTMLElement>('[autofocus]')
    ;(autofocusTarget ?? panel).focus()
  }

  watch(
    options.open,
    (open) => {
      if (open) {
        restoreTo = (document.activeElement as HTMLElement | null) ?? null
        document.addEventListener('keydown', onKeydown)
        acquireScrollLock()
        acquired = true
        // flush: 'post' 保证此时面板已渲染，焦点移入才有落点
        focusOnOpen()
      } else {
        document.removeEventListener('keydown', onKeydown)
        if (acquired) {
          releaseScrollLock()
          acquired = false
        }
        restoreTo?.focus?.()
        restoreTo = null
      }
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    if (acquired) {
      releaseScrollLock()
      acquired = false
    }
  })
}
