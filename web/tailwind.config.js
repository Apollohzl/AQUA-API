// Tailwind 配置：定义 AQUA-API 的「深水夜航」设计令牌。
//
// 意图（Why）：
//   把「颜色/字体/圆角」等设计决策集中成令牌（token），
//   组件里只使用语义化类名（bg-ink-900 / text-brand-700），
//   避免颜色散落在各处导致视觉不一致，也便于后续整体换肤。
//
// 关于 ink 色阶的方向（重要，改色前必读）：
//   本项目采用「数值越大越接近背景」的语义约定：
//     ink-950 = 最接近页面底色，ink-50 = 与底色对比最强。
//   因此【暗色主题】下 950 是最深（深海墨黑）、50 是最浅（近白）。
//   2026-09-29 全站由亮色切换为暗色时，只替换了本文件的色值，
//   各页面里 ink-* 类名一个都没动 —— 这正是当初做语义约定的回报。
//
// 关于语义色的「暗色覆盖」（第二个关键设计，改动前必读）：
//   页面里存在约 180 处 text-emerald-700 / text-amber-700 这类
//   「亮色档」状态文字（Tailwind 默认 700 在深底上几乎不可读）。
//   逐页改散落写法必然漏改，因此这里【直接覆盖这几个色阶的值】，
//   把 600/700/800 重定义为暗底可读的亮档（如 emerald-700 = #6ee7b7）。
//   副作用是「色阶名与标准 Tailwind 值不同」——这是主题化的正常代价，
//   注释已在此声明，后续新写代码请直接使用这些色阶名。
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
        // 品牌色（湖蓝，呼应 "AQUA"）。
        // 暗色主题下的取舍：50-200 反转成「深青底」（用于深色填充与渐变起点），
        // 500-600 保持高饱和（按钮实底），700-900 重定义为亮青（深底上的文字与强调）。
        // 页面里大量 text-brand-700/800 因此无需改动即获得暗底可读性。
        brand: {
          50: '#03253c',
          100: '#05365a',
          200: '#084a7a',
          300: '#2f9df5', // 深色影像上的亮青（kicker / 图标）
          400: '#5cb4ff',
          500: '#2e8fff', // 主色：描边、光效、选中底（配透明度）
          600: '#1877e8', // 主按钮实底（配白字）
          700: '#6cb6ff', // 暗底强调文字（原亮色主题的深蓝文字位）
          800: '#9ed2ff',
          900: '#c9e8ff',
        },
        // 中性色：语义为「数值越大越接近页面底色」（暗色主题 → 越大越深）。
        // 底色是带蓝调的深海墨黑而非纯黑：纯黑会显得"关灯"，深蓝黑才有
        // "水下夜航"的纵深；卡片底比页面底亮半档，层次靠亮度差而不是阴影。
        ink: {
          50: '#f0f6fd', // 最强对比：标题
          100: '#d9e4f5', // 正文
          200: '#b6c8e0', // 次级正文
          300: '#8ea6c6', // 次要文字（说明、表头）
          400: '#687f9f', // 更弱文字（提示、占位说明）
          500: '#4b6079', // 输入框占位符、禁用态
          600: '#31465f', // 强边框（复选框等需要明确边界处）
          700: '#22344e', // 常规边框
          750: '#1b2b42', // hover 底色
          800: '#15243a', // 次级按钮底、标签底
          850: '#101d31', // 表头底、chip 底
          900: '#0b1626', // 卡片 / 输入框底
          950: '#050d19', // 页面底色（深海墨黑）
        },
        // ── 状态色的暗色覆盖（见文件头「关于语义色的暗色覆盖」）────
        // 只覆盖页面实际使用的 600-800 档；未列出的档位仍是 Tailwind 默认值。
        emerald: {
          600: '#34d399',
          700: '#6ee7b7',
          800: '#a7f3d0',
        },
        amber: {
          600: '#fbbf24',
          700: '#fcd34d',
          800: '#fde68a',
        },
        red: {
          600: '#f87171',
          700: '#fca5a5',
          800: '#fecaca',
        },
        sky: {
          600: '#38bdf8',
          700: '#7dd3fc',
          800: '#bae6fd',
        },
        indigo: {
          600: '#818cf8',
          700: '#a5b4fc',
          800: '#c7d2fe',
        },
        rose: {
          600: '#fb7185',
          700: '#fda4af',
          800: '#fecdd3',
        },
      },
      fontFamily: {
        // 正文：Source Sans 3 字腔开阔，密集信息界面（表格/表单）可读性好
        sans: ['"Source Sans 3"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        // 标题：Unbounded 是几何感极强的未来主义字体，负责"AQUA"这类拉丁大字；
        // 中文标题回退到思源宋体，形成「几何科技 × 衬线编辑」的双性格，
        // 暗色 + 等宽数字下整体呈现精密仪表的气质。
        display: ['Unbounded', '"Source Serif 4"', '"Noto Serif SC"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // 暗色主题的层次语言：阴影退居二线，层次主要靠边框与亮度差。
        // panel：贴身描边光（一圈极淡的品牌光）+ 深环境影；
        // pop：浮层专用，描边光更明显一档。
        panel: '0 0 0 1px rgba(92,180,255,0.03), 0 16px 36px -20px rgba(0,0,0,0.55)',
        pop: '0 0 0 1px rgba(92,180,255,0.07), 0 30px 72px -24px rgba(0,0,0,0.72)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        // 更长的抬升距离：进场有明确的"升上来"动作，260ms 内完成，不拖泥带水。
        'slide-up': { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        // 落地页 hero 的水面光斑：缓慢起伏，营造"水面"质感
        'hero-drift': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(2%, -3%, 0) scale(1.04)' },
        },
        // 扫描线：落地页"实时监测"装饰元素，单条光带从上到下扫过
        'scan-sweep': { from: { transform: 'translateY(-100%)' }, to: { transform: 'translateY(400%)' } },
        // 状态灯呼吸：登录页/监控区的"在线"指示灯
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'hero-drift': 'hero-drift 14s ease-in-out infinite',
        'scan-sweep': 'scan-sweep 7s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'pulse-soft': 'pulse-soft 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
