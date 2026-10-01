/** BrandMark：AQUA-API 品牌形象标识（原创水波纹 logo）。
 *
 * 意图（Why）：
 *   全站所有 logo 位置（顶栏/页脚/落地页/外壳/登录页）共用同一个品牌标，
 *   而不是散落的通用图标。AQUA 意为"水"，用三条向上收拢的水波纹
 *   （下宽上窄 → 上升感）表达"汇聚多路上游、向上流动"的产品语义。
 *
 * 流转（Flow）：
 *   SiteHeader / SiteFooter / AppShell / Landing / 认证页 → <BrandMark />
 *
 * 扩展（Extend）：
 *   需要换品牌标时只改本文件；size 控制图标尺寸，文字排版由调用方决定。
 */

interface BrandMarkProps {
  /** 图标尺寸（px） */
  size?: number
  /** 是否深色模式（深底浅标）；默认亮色（浅底深标） */
  dark?: boolean
}

export function BrandMark({ size = 24, dark = false }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={dark ? '#f6f7f9' : '#ffffff'}
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden="true"
      className="block"
    >
      {/* 三条向上收拢的水波纹：越往上越短，形成汇聚上升的视觉 */}
      <path d="M2.5 16.5c3.2-2.6 5.6-2.6 8.8 0s5.6 2.6 8.8 0" />
      <path d="M3.5 11.5c3.2-2.4 5.2-2.4 8.4 0s5.2 2.4 8.4 0" />
      <path d="M5 6.8c2.6-1.9 4.1-1.9 6.7 0s4.1 1.9 6.7 0" />
    </svg>
  )
}

/** BrandLogo：品牌标 + 名称的组合（顶栏/页脚常用） */
interface BrandLogoProps {
  name?: string
  /** 图标尺寸 */
  iconSize?: number
  /** 文字颜色（Tailwind 类） */
  textClass?: string
  /** 图标底色（Tailwind 类） */
  boxClass?: string
  dark?: boolean
}

export function BrandLogo({
  name = 'AQUA-API',
  iconSize = 20,
  textClass = 'text-ink',
  boxClass = 'bg-brand',
  dark = false,
}: BrandLogoProps) {
  return (
    <span className="flex items-center gap-2">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${boxClass}`}>
        <BrandMark size={iconSize} dark={dark} />
      </span>
      <span className={`font-semibold ${textClass}`}>{name}</span>
    </span>
  )
}