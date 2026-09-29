<script setup lang="ts">
/**
 * 深海焦散流场（原创算法艺术背景，全站视觉的"工艺"核心）。
 *
 * 意图（Why）：
 *   品牌名 AQUA = 水。此前落地页用的是一张外链生成的照片，
 *   "谁的图"一眼可辨、加载受第三方域名可用性影响，且更换困难。
 *   本组件用纯数学把"深水下的光"画出来：
 *     · 多组不同频率/相位/方向的正弦波叠加成一张缓慢演化的干涉场
 *       —— 这正是真实浅水焦散（caustics）的成因：波动的水面
 *       像一组不断变形的透镜，把光聚成亮网；
 *     · 对场值做非线性增强（锐化 + 阈值聚光），亮纹因此聚成"光丝"，
 *       暗处退回深海底色，而不是均匀的波纹墙纸；
 *     · 叠加一组缓慢上升的"气泡"微光，提供"水在呼吸"的纵深。
 *   视觉结果：深色页面上有一层活着的、方向缓慢漂移的水下光网。
 *
 * 性能设计（为什么敢在登录页/落地页常驻）：
 *   1) 低分辨率计算：画布内部只有 ~240×135 逻辑像素（按屏幕比例），
 *      逐像素计算量是全分辨率的 1/70 以下；再由 GPU 把它拉伸到满屏，
 *      双线性插值天然带来柔和的光晕，"糊"在这里是特性不是缺陷；
 *   2) 一切都在 requestAnimationFrame 里，页面不可见（切标签页）时
 *      自动暂停；prefers-reduced-motion 时只画一帧静帧；
 *   3) 不用 blur/shadow 等逐像素后处理，成本只有一遍正弦叠加。
 *
 * 流转（Flow）：
 *   LandingView / LoginView / RegisterView 等深底页面
 *   → <CausticCanvas :intensity="0.5"/> 铺满父容器（父容器需 relative）
 *
 * 扩展（Extend）：
 *   想换"水色"只改 props（hue 色相 / intensity 亮度 / speed 流速）；
 *   想加新图层（如水平扫描光带）在 drawFrame 内追加，不动现有三层。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 亮度系数（0~1）：落地页整屏用 1，登录页做背景用 0.4 左右 */
    intensity?: number
    /** 流速系数（0~2）：1 为正常缓速 */
    speed?: number
    /** 光的色相（度）：215 = 品牌湖蓝；调 185 偏青、260 偏靛 */
    hue?: number
  }>(),
  { intensity: 1, speed: 1, hue: 215 },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)

/** 内部分辨率：只算这么宽，GPU 拉伸放大。
 *  取 240 是"够看清光丝走向"的下限；更小会让光纹碎成噪点。 */
const LOGICAL_W = 240

let raf = 0
let running = false
let startedAt = 0

/** 三个波源：真实焦散由多组不同尺度的水面波叠加，
 *  各自的 dirX/dirY 决定干涉网的整体漂移方向。 */
const WAVES = [
  { fx: 2.1, fy: 3.3, sx: 0.00023, sy: 0.00019, dx: 0.7, dy: 0.35 },
  { fx: 4.7, fy: 1.9, sx: 0.00011, sy: 0.00027, dx: -0.4, dy: 0.6 },
  { fx: 1.3, fy: 5.9, sx: 0.00031, sy: 0.00013, dx: 0.25, dy: -0.5 },
]

/** 气泡：位置随机，缓慢上升 + 水平摆动，到顶回到底部重生。
 *  半径 0 的画成单像素光点（imgdata 直写），>0 的画柔光圆。 */
interface Bubble {
  x: number
  y: number
  r: number
  vy: number
  sway: number
  phase: number
}
let bubbles: Bubble[] = []

function seedBubbles(w: number, h: number): void {
  const count = Math.round((w * h) / 900)
  bubbles = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() < 0.85 ? 0 : 0.6 + Math.random() * 1.1,
    vy: 0.06 + Math.random() * 0.22,
    sway: 0.3 + Math.random() * 0.7,
    phase: Math.random() * Math.PI * 2,
  }))
}

/** 计算干涉场在 (x,y,t) 的值：三组波叠加后的锐化聚光。
 *  pow(v, 2.6)：把中等亮度压暗、把高点进一步拔尖 ——
 *  正是"光丝"与"底色"分离的关键一步。 */
function fieldAt(x: number, y: number, t: number): number {
  let v = 0
  for (const w of WAVES) {
    const nx = x * w.fx + t * w.dx
    const ny = y * w.fy + t * w.dy
    v += Math.sin(nx * w.sx * 1000 + t * 0.0007) * Math.cos(ny * w.sy * 1000 - t * 0.0005)
  }
  // 归一化到 0~1 后做非线性增强
  const n = (v + WAVES.length) / (WAVES.length * 2)
  return Math.pow(n, 2.6)
}

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const img = ctx.createImageData(w, h)
  const data = img.data
  const hue = props.hue
  // 主色（亮）与底色（暗）在 HSL 空间只差亮度与饱和度，
  // 保证光丝与深海是"同一片水"，不会出现两种割裂的色块。
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = fieldAt(x, y, t) * props.intensity
      // 光丝亮部抬一点饱和，暗部沉底
      const l = 3 + f * 52
      const s = 60 + f * 40
      const i = (y * w + x) * 4
      data[i] = hue
      data[i + 1] = s
      data[i + 2] = l
      data[i + 3] = 255
    }
  }

  // HSL 直写的是快速近似（只为省一个渐变表）：
  // 暗部近似线性，亮部（l>8）才展开标准转换。
  for (let i = 0; i < data.length; i += 4) {
    const hh = data[i] / 360
    const ss = data[i + 1] / 100
    const ll = data[i + 2] / 100
    let r: number
    let g: number
    let b: number
    if (ss === 0) {
      r = g = b = ll
    } else {
      const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
      const p = 2 * ll - q
      r = hue2rgb(p, q, hh + 1 / 3)
      g = hue2rgb(p, q, hh)
      b = hue2rgb(p, q, hh - 1 / 3)
    }
    data[i] = r * 255
    data[i + 1] = g * 255
    data[i + 2] = b * 255
  }

  ctx.putImageData(img, 0, 0)

  // 气泡层：光点直写在画布上（同分辨率，随场一起被拉伸放大）
  ctx.globalCompositeOperation = 'lighter'
  for (const b of bubbles) {
    const y = b.y - ((t * b.vy * props.speed * 0.06) % (h + 20))
    const yy = y < -10 ? y + h + 20 : y
    const x = b.x + Math.sin(t * 0.0004 + b.phase) * b.sway * 4
    const alpha = 0.05 + Math.sin(t * 0.001 + b.phase) * 0.04 + props.intensity * 0.06
    if (b.r === 0) {
      ctx.fillStyle = `hsla(${hue},80%,75%,${Math.max(alpha, 0.03)})`
      ctx.fillRect(x, yy, 1, 1)
    } else {
      const grad = ctx.createRadialGradient(x, yy, 0, x, yy, b.r * 2)
      grad.addColorStop(0, `hsla(${hue},85%,80%,${Math.max(alpha, 0.04)})`)
      grad.addColorStop(1, 'hsla(0,0%,0%,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, yy, b.r * 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

function tick(now: number): void {
  const canvas = canvasRef.value
  if (!canvas || !running) return
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return
  drawFrame(ctx, canvas.width, canvas.height, (now - startedAt) * props.speed)
  raf = requestAnimationFrame(tick)
}

function resize(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const ratio = canvas.clientHeight / Math.max(canvas.clientWidth, 1)
  canvas.width = LOGICAL_W
  canvas.height = Math.max(1, Math.round(LOGICAL_W * ratio))
  seedBubbles(canvas.width, canvas.height)
  // 尺寸变化先画一帧，避免从黑到亮之间出现可感知的空档
  const ctx = canvas.getContext('2d', { alpha: false })
  if (ctx) drawFrame(ctx, canvas.width, canvas.height, 0)
}

/** 页面不可见时暂停（省电、省 CPU），回来时重新对表 */
function onVisibility(): void {
  if (document.hidden) {
    running = false
    cancelAnimationFrame(raf)
  } else {
    running = true
    startedAt = performance.now()
    raf = requestAnimationFrame(tick)
  }
}

onMounted(() => {
  const reduceMotion =
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  resize()
  window.addEventListener('resize', resize)

  if (reduceMotion) {
    // 动效被系统关掉：只画一帧静帧，不进入渲染循环
    const ctx = canvasRef.value?.getContext('2d', { alpha: false })
    if (ctx && canvasRef.value) drawFrame(ctx, canvasRef.value.width, canvasRef.value.height, 4000)
    return
  }

  startedAt = performance.now()
  running = true
  raf = requestAnimationFrame(tick)
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  running = false
  cancelAnimationFrame(raf)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('resize', resize)
})

// props 运行时变化（如登录页把强度调低）时立即重画一帧，
// 避免"等下一个 raf"造成可感知的延迟。
watch(
  () => [props.intensity, props.hue, props.speed],
  () => {
    const ctx = canvasRef.value?.getContext('2d', { alpha: false })
    if (ctx && canvasRef.value) {
      drawFrame(ctx, canvasRef.value.width, canvasRef.value.height, performance.now() - startedAt)
    }
  },
)
</script>

<template>
  <canvas
    ref="canvasRef"
    class="absolute inset-0 h-full w-full"
    style="image-rendering: auto"
    aria-hidden="true"
  />
</template>
