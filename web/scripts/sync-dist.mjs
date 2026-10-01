#!/usr/bin/env node
/**
 * 构建后把 Next 静态导出产物从 out/ 同步到 web/dist（go:embed 的固定路径）。
 *
 * 意图（Why）：
 *   Next.js 的 output:'export' 固定输出到 out/，而后端根包 webui.go 用
 *   //go:embed all:web/dist 嵌入前端。若不把产物搬到 dist/，go build 会失效。
 *
 * 流转（Flow）：
 *   next build（产出 out/）→ 本脚本清空 dist 旧产物 → 复制 out/* → dist/
 *   → go build 嵌入 → 单二进制部署
 *
 * 扩展（Extend）：
 *   若将来调整 go:embed 目录，同步修改本文件的 TARGET 与 webui.go 即可。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'out')
const TARGET = path.join(ROOT, 'dist')

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

function copyDir(src, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

if (!fs.existsSync(SRC)) {
  console.error('[sync-dist] 未找到 out/ 目录，请先执行 next build')
  process.exit(1)
}

// 全量清空再复制：避免旧版哈希资源残留导致 go build 后线上引用过期文件
rmrf(path.join(TARGET, '_next'))
for (const name of fs.readdirSync(TARGET)) {
  // 保留 PLACEHOLDER.txt 占位文件（仓库未构建时的 go:embed 兜底，内容不要动）
  if (name !== 'PLACEHOLDER.txt') rmrf(path.join(TARGET, name))
}

// 确保占位文件存在且内容不变（构建产物未入库时 go:embed 需要至少一个文件）
const placeholder = path.join(TARGET, 'PLACEHOLDER.txt')
if (!fs.existsSync(placeholder)) {
  fs.writeFileSync(
    placeholder,
    '前端占位文件：go:embed 需要 web/dist 至少存在一个文件。执行 npm run build 后会被真实产物替代。',
  )
}

copyDir(SRC, TARGET)
console.log(`[sync-dist] out/ 已同步到 dist/（${fs.readdirSync(TARGET).length} 项）`)