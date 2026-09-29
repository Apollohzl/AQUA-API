/**
 * 图表通用配色与样式常量。
 *
 * 意图（Why）：
 *   仪表盘与门户共 4 处图表，若各自定义颜色会出现「同一指标在不同页颜色不同」的问题；
 *   集中定义保证「请求=青色、Token=紫色、额度=绿色」在全站一致，降低读图成本。
 *
 * 关于暗色主题下的取色（重要，2026-09-29 全站换肤）：
 *   深色背景上必须使用「高亮度、高饱和」的颜色；原先为亮色底选的
 *   中深色（如 #0891b2）在墨黑底上会"沉下去"，因此整体上浮一个明度档，
 *   同时保持色相不变以维持原有的"指标—颜色"记忆。
 *
 * 流转（Flow）：
 *   views/* 构造 EChartsOption → 引用本文件的常量 → components/EChart.vue 渲染
 *
 * 扩展（Extend）：
 *   新增指标配色请在 CHART_PALETTE 追加，并同步 views 中的显式取色；
 *   颜色值需与 tailwind.config.js 的品牌色保持同一色系。
 */

/** 图表主色序列（顺序即默认取色顺序：青 → 靛 → 绿 → 琥珀 → 粉 → 蓝） */
export const CHART_PALETTE = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#fb7185', '#5cb4ff']

/** 坐标轴标签样式：比正文弱一档，避免图表抢主体内容的视觉权重 */
export const AXIS_LABEL_STYLE = { color: '#8ea6c6', fontSize: 11 } as const

/** 坐标轴线样式：暗色下线条取次级边框色，可见但不抢戏 */
export const AXIS_LINE_STYLE = { lineStyle: { color: 'rgba(49,70,95,0.6)' } } as const

/** 网格分割线：虚线 + 低透明度，深色底上不喧宾夺主 */
export const SPLIT_LINE_STYLE = {
  lineStyle: { color: 'rgba(49,70,95,0.45)', type: 'dashed' as const },
} as const

/**
 * 统一的 tooltip 外观（与 .card 的圆角/描边语言一致）。
 *
 * 暗色主题下用「深色浮层 + 亮青描边 + 浅色文字」，
 * 与页面的暗色面板保持同一视觉语言；亮色 tooltip 会在
 * 墨黑页面里显得像一块"灯箱"，突兀且廉价。
 *
 * 注意：此处刻意不加 `as const` —— padding 若被推断为 readonly 元组，
 * 将无法赋值给 echarts 的 `number | number[]` 类型。
 */
export const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(11,22,38,0.96)',
  borderColor: 'rgba(47,157,245,0.35)',
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: '#d9e4f5', fontSize: 12 },
  extraCssText: 'border-radius:10px;box-shadow:0 16px 40px -12px rgba(0,0,0,.6);',
}

/** 面积图渐变（用于折线下方的填充，让趋势更易读） */
export function areaGradient(color: string): Record<string, unknown> {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: `${color}4d` },
      { offset: 1, color: `${color}00` },
    ],
  }
}
