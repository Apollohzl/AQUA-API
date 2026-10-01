/** 联系方式页（/contact）。
 *
 * 意图（Why）：
 *   合规公示：向访客提供可联系的客服渠道（邮箱），无邮箱时显示群入口。
 */
'use client'

import { LegalDocLayout } from '@/components/site/LegalDocLayout'
import { useSite } from '@/lib/site/site-context'

export default function ContactPage() {
  const { status } = useSite()
  return (
    <LegalDocLayout title="联系方式" updatedAt="最近更新：2026-09-30">
      <h2>客服邮箱</h2>
      <p>
        如需业务咨询、合作或使用帮助，可发送邮件至：
        {status?.contact_email ? (
          <a href={`mailto:${status.contact_email}`} className="font-medium text-brand hover:underline">
            {status.contact_email}
          </a>
        ) : (
          <span className="text-ink-3">（暂未配置公开邮箱，请通过交流群联系）</span>
        )}
      </p>
      <h2>交流群</h2>
      <p>遇到使用问题可以加入交流群寻求帮助：<a href="/join" className="text-brand hover:underline">加入交流群</a>。</p>
      <h2>工作时间</h2>
      <p>我们会尽力在 48 小时内回复邮件。紧急问题（如账号被盗）请同时通过交流群通知管理员。</p>
    </LegalDocLayout>
  )
}