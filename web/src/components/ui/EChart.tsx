/** EChart：echarts 的 React 容器（等价旧 EChart.vue）。
 *
 * 意图（Why）：
 *   统一图表初始化/销毁/resize 生命周期，页面只提供 option。
 *   主题取色来自 utils/chart.ts（亮色适配），保证全站图表一致。
 */
'use client'

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DatasetComponent, TitleComponent, CanvasRenderer])

interface EChartProps {
  option: echarts.EChartsCoreOption
  height?: number
  className?: string
}

export function EChart({ option, height = 280, className }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el)
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={containerRef} className={className} style={{ height }} />
}