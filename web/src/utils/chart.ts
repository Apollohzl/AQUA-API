/**
 * 图表通用配色与样式常量（主题感知）。
 *
 * 意图（Why）：
 *   仪表盘与门户共 4 处图表，若各自定义颜色会出现「同一指标在不同页颜色不同」的问题；
 *   集中定义保证「请求=青、Token=靛、额度=绿」在全站一致，降低读图成本。
 *
 * 主题适配（重要）：
 *   站点提供昼 / 夜两套主题，ECharts 的 canvas 不认 CSS 变量，
 *   因此这里导出「按主题取样式」的函数：调用方传 isDark，得到该主题下可读的配色。
 *   昼：坐标轴深灰、tooltip 白底深字；夜：坐标轴浅灰、tooltip 深底浅字。
 *
 * 流转（Flow）：
 *   页面 useTheme() → chartStyles(isDark) → 展开进 EChartsOption → EChart 渲染
 *
 * 扩展（Extend）：
 *   新增指标配色请在 palette 中追加，并同步页面里的显式取色。
 */

/** 图表主色序列（顺序即默认取色顺序：青 → 靛 → 绿 → 琥珀 → 粉 → 蓝） */
export const CHART_PALETTE = ['#0891b2', '#6366f1', '#059669', '#d97706', '#db2777', '#2563eb']

/** 夜间主题下的主色序列：整体提亮一档，保证暗底可读 */
export const CHART_PALETTE_DARK = ['#22d3ee', '#818cf8', '#34d399', '#fbbf24', '#f472b6', '#60a5fa']

export interface ChartStyles {
  palette: string[]
  axisLabel: { color: string; fontSize: number }
  axisLine: { lineStyle: { color: string } }
  splitLine: { lineStyle: { color: string; type: 'dashed' } }
  tooltip: Record<string, unknown>
}

/** 按主题返回一整套图表样式；调用方只需把结果展开进 option */
export function chartStyles(isDark: boolean): ChartStyles {
  if (isDark) {
    return {
      palette: CHART_PALETTE_DARK,
      axisLabel: { color: '#8b93a1', fontSize: 11 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.28)' } },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.16)', type: 'dashed' } },
      tooltip: {
        backgroundColor: 'rgba(27,30,36,0.97)',
        borderColor: 'rgba(58,64,72,1)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#e9e7e2', fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 12px 32px -12px rgba(0,0,0,.6);',
      },
    }
  }
  return {
    palette: CHART_PALETTE,
    axisLabel: { color: '#475569', fontSize: 11 },
    axisLine: { lineStyle: { color: 'rgba(100,116,139,0.35)' } },
    splitLine: { lineStyle: { color: 'rgba(100,116,139,0.22)', type: 'dashed' } },
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderColor: 'rgba(224,232,242,1)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#1e293b', fontSize: 12 },
      extraCssText: 'border-radius:10px;box-shadow:0 12px 32px -12px rgba(15,23,42,.25);',
    },
  }
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
      { offset: 0, color: `${color}40` },
      { offset: 1, color: `${color}00` },
    ],
  }
}
