/** 投诉举报页（/report）。
 *
 * 意图（Why）：
 *   合规公示：接受用户对本站服务与内容的投诉举报，并给出处理路径。
 */
'use client'

import { LegalDocLayout } from '@/components/site/LegalDocLayout'
import { useSite } from '@/lib/site/site-context'

export default function ReportPage() {
  const { status } = useSite()
  return (
    <LegalDocLayout title="投诉举报" updatedAt="最近更新：2026-09-30">
      <h2>受理范围</h2>
      <p>
        1) 对本站服务质量的投诉；2) 发现本站或用户发布的内容涉嫌违法违规；
        3) 发现账号被盗、被滥用等安全问题。
      </p>
      <h2>举报方式</h2>
      <p>
        请通过邮箱提交举报：
        {status?.contact_email ? (
          <a href={`mailto:${status.contact_email}`} className="font-medium text-brand hover:underline">
            {status.contact_email}
          </a>
        ) : (
          <span className="text-ink-3">（暂未配置公开举报邮箱）</span>
        )}
        。请尽量附上相关证据（截图、时间、涉及内容），便于我们快速核查。
      </p>
      <h2>处理时限</h2>
      <p>我们承诺在 48 小时内响应举报，并在核查后依法采取必要措施（删除内容、处置账号、向监管报告等）。</p>
      <h2>诬告责任</h2>
      <p>故意捏造事实进行诬告陷害的，我们将保留追究法律责任的权利。</p>
    </LegalDocLayout>
  )
}