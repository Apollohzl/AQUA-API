// Tailwind 配置：定义 AQUA-API 的亮色设计令牌。
//
// 意图（Why）：
//   把「颜色/字体/圆角」等设计决策集中成令牌（token），
//   组件里只使用语义化类名（bg-ink-900 / text-brand-700），
//   避免颜色散落在各处导致视觉不一致，也便于后续整体换肤。
//
// 关于 ink 色阶的方向（重要，改色前必读）：
//   本项目采用「数值越大越接近背景」的语义约定：
//     ink-950 = 最接近页面底色，ink-50 = 与底色对比最强。
//   因此亮色主题下 950 是最浅（近白）、50 是最深（近黑），
//   与 Tailwind 默认色阶的方向相反。这样约定的好处是：
//   切换主题时只需替换色值，组件里的 ink-* 类名完全不用动。
//
// 流转（Flow）：
//   tailwind.config.js → postcss（tailwindcss 插件）→ src/style.css 的 @tailwind 指令
//   → 生成工具类 → 各 .vue 模板使用
//
// 扩展（Extend）：
//   新增色板：在 theme.extend.colors 下加一组（如 warn），并同步 style.css 的 @layer components
//   里已有语义类；品牌色统一用 brand-*，中性色统一用 ink-*。
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        // 品牌色（湖蓝，呼应 "AQUA"）：用于主按钮、强调、图表主色。
        // 相比常规 cyan 更深、更偏蓝，让"亮底上的白字按钮"依然有对比度。
        // 文字类用法请取 600/700，500 及更浅的色阶仅用于底色与描边（配透明度）。
        brand: {
          50: '#f0f7ff',
          100: '#e0efff',
          200: '#bde1ff',
          300: '#8cc8ff',
          400: '#55a6f5',
          500: '#2e7fe0',
          600: '#1f66c2',
          700: '#1a53a0',
          800: '#174684',
          900: '#143b6e',
        },
        // 中性色：语义为「数值越大越接近页面底色」（亮色主题 → 越大越浅）。
        // 950/900/850 用于页面底、卡片底与浅色填充；
        // 500-700 用于边框与分隔；50-300 用于各级文字。
        // 底色带极浅的蓝灰冷调，让"白纸感"变成"冷纸感"。
        ink: {
          50: '#0b1526', // 最强对比：标题
          100: '#152640', // 正文
          200: '#29415f', // 次级正文
          300: '#43597c', // 次要文字（说明、表头）
          400: '#5f7494', // 更弱文字（提示、占位说明）
          500: '#8aa0bc', // 输入框占位符、禁用态
          600: '#b6c6da', // 强边框（复选框等需要明确边界处）
          700: '#cbd8e8', // 常规边框
          750: '#d7e2f0', // hover 底色 / 次级按钮 hover
          800: '#e2eaf6', // 次级按钮底、浅色标签底
          850: '#eaf1f9', // 表头底、chip 底、hover 底色
          900: '#ffffff', // 卡片 / 输入框底
          950: '#f4f8fc', // 页面底色（极浅冷调，营造通透感）
        },
      },
      fontFamily: {
        // 正文：Source Sans 3 字腔更开阔、在密集信息界面（表格/表单）的可读性更好
        sans: ['"Source Sans 3"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        // 标题：Source Serif 4 给落地页/大标题带来编辑感与"AQUA"的沉稳气质；
        // 与 sans 拉开字体性格，让"标题是标题、正文是正文"。
        display: ['"Source Serif 4"', 'Georgia', '"Noto Serif SC"', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // 卡片与弹窗的层次感：亮色主题下投影要更轻更散，
        // 否则会在浅色背景上形成生硬的黑色边缘。
        // 两层叠加：一层贴身极轻（让边缘有"抬起"的感觉），一层大偏移浅阴影（环境光）。
        panel: '0 1px 2px 0 rgba(11,21,38,0.05), 0 14px 34px -18px rgba(11,21,38,0.18)',
        pop: '0 26px 64px -26px rgba(11,21,38,0.32)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        // 更长的抬升距离：落地页元素进场时有一个明确的"升上来"动作，
        // 而不是几乎看不出来的 6px；200ms 内完成，不拖泥带水。
        'slide-up': { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        // 落地页 hero 的水面光斑：缓慢起伏，营造"水面"质感
        'hero-drift': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(2%, -3%, 0) scale(1.04)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'hero-drift': 'hero-drift 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
