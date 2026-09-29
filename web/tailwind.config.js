// Tailwind 配置：定义 AQUA-API 的「白昼工程」亮色设计令牌。
//
// 意图（Why）：
//   把「颜色/字体/圆角」等设计决策集中成令牌（token），
//   组件里只使用语义化类名（bg-ink-900 / text-brand-700），
//   避免颜色散落在各处导致视觉不一致，也便于后续整体换肤。
//
// 关于 ink 色阶的方向（重要，改色前必读）：
//   本项目采用「数值越大越接近背景」的语义约定：
//     ink-950 = 最接近页面底色，ink-50 = 与底色对比最强。
//   因此亮色主题下 950 是最浅（近白）、50 是最深（近黑）。
//   2026-09-29 曾整体切换暗色，30 日依站长反馈回到亮色：
//   「以白天亮色为主，太花里胡哨」—— 本次亮色版的设计基调是
//   「干净的白 + 克制的蓝 + 充实的内容」，装饰只保留细网格与
//   极淡光晕，不做大面积动效。
//
// 流转（Flow）：
//   tailwind.config.js → postcss（tailwindcss 插件）→ src/style.css 的 @tailwind 指令
//   → 生成工具类 → 各 .vue 模板使用
//
// 扩展（Extend）：
//   新增色板：在 theme.extend.colors 下加一组，并同步 style.css 的 @layer components
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
          50: '#0b1524', // 最强对比：标题
          100: '#17293f', // 正文
          200: '#2c4362', // 次级正文
          300: '#48607f', // 次要文字（说明、表头）
          400: '#61779a', // 更弱文字（提示、占位说明）
          500: '#8ba0bc', // 输入框占位符、禁用态
          600: '#b9c9dd', // 强边框（复选框等需要明确边界处）
          700: '#cdd9e8', // 常规边框
          750: '#dde7f3', // hover 底色 / 次级按钮 hover
          800: '#e8eef7', // 次级按钮底、浅色标签底
          850: '#eef3f9', // 表头底、chip 底、hover 底色
          900: '#ffffff', // 卡片 / 输入框底
          950: '#f7f9fc', // 页面底色（极浅冷白，通透干净）
        },
      },
      fontFamily: {
        // 正文：Source Sans 3 字腔更开阔、在密集信息界面（表格/表单）的可读性更好
        sans: ['"Source Sans 3"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        // 标题：Source Serif 4 给大标题带来编辑感与"AQUA"的沉稳气质；
        // 中文回退思源宋体，与 sans 拉开字体性格，让"标题是标题、正文是正文"。
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
        // 更长的抬升距离：进场有明确的"升上来"的动作，
        // 而不是几乎看不出来的 6px；260ms 内完成，不拖泥带水。
        'slide-up': { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        // 状态灯呼吸：终端演示的"在线"指示灯（浅色页面里唯一的深色块内）
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'pulse-soft': 'pulse-soft 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
