#!/usr/bin/env node
/**
 * 安装后确保 dist/ 可被 go:embed 编译。
 *
 * 意图（Why）：
 *   go build 要求 web/dist 下至少存在一个可嵌入文件；
 *   全新克隆（未构建前端）时 dist/ 若为空，Go 编译会直接失败。
 *   本脚本在 npm install 后重建占位文件，保证「只装依赖就能 go build」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TARGET = path.join(__dirname, '..', 'dist', 'PLACEHOLDER.txt')
fs.mkdirSync(path.dirname(TARGET), { recursive: true })
fs.writeFileSync(
  TARGET,
  '前端占位文件：go:embed 需要 web/dist 至少存在一个文件。执行 npm run build 后会被真实产物替代。',
)
console.log('[ensure-dist] dist/PLACEHOLDER.txt 已就绪')