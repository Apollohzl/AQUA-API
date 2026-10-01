/** AppIcon：全站统一图标渲染（React 版，等价旧 AppIcon.vue）。
 *
 * 意图（Why）：
 *   复用纯数据模块 icons.ts 的描边路径，导出统一的 SVG 图标组件；
 *   保持全站线条风格一致（24×24 视口、currentColor 描边）。
 */
import { ICON_PATHS, type IconName } from './icons'

export type { IconName }

interface AppIconProps {
  name: IconName
  /** 尺寸（px）；默认 20，随父容器可用 */
  size?: number
  /** 颜色：传 Tailwind 颜色类或 CSS 变量 */
  className?: string
}

export function AppIcon({ name, size = 20, className }: AppIconProps) {
  const paths = ICON_PATHS[name]
  if (!paths) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}