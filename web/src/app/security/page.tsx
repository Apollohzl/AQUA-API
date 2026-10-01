/** 安全致谢页（/security）。
 *
 * 意图（Why）：
 *   公示漏洞披露渠道与致谢名单（负责任的披露文化）。
 */
'use client'

import { useState } from 'react'

import { LegalDocLayout } from '@/components/site/LegalDocLayout'

export default function SecurityCreditsPage() {
  const [revealed, setRevealed] = useState(false)
  return (
    <LegalDocLayout title="安全致谢" updatedAt="最近更新：2026-09-30">
      <h2>漏洞报告</h2>
      <p>
        如果你发现本站存在安全漏洞，欢迎负责任地披露：请勿公开传播漏洞细节，
        先通过邮件/群聊联系管理员，我们会在修复后公开致谢。
      </p>
      <h2>报告内容</h2>
      <p>请描述：漏洞类型、影响范围、复现步骤（尽量简洁）、建议修复方案。请勿进行破坏性测试。</p>
      <h2>致谢名单</h2>
      <p>我们感谢以下研究者对本站安全做出的贡献：</p>
      <button type="button" onClick={() => setRevealed(true)} className="text-brand hover:underline" disabled={revealed}>
        {revealed ? '（名单将在收到有效报告后在此公布）' : '查看已致谢研究者'}
      </button>
    </LegalDocLayout>
  )
}