/**
 * PostCSS 配置：Tailwind CSS v4 以 PostCSS 插件方式接入。
 *
 * Tailwind v4 采用 CSS-first 配置（@theme 写在 globals.css），
 * 因此这里只需要注册插件，不再需要 tailwind.config.js 与 autoprefixer。
 */
export default {
  plugins: {
    // Tailwind v4 的 PostCSS 插件（内置浏览器前缀处理，无需 autoprefixer）
    '@tailwindcss/postcss': {},
  },
}