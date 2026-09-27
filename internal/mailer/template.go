// 本文件的职责：构造邮件的主题与正文文案。
//
// 意图（Why）：
//
//	把"用户看到的邮件长什么样"与"邮件怎么发出去"分开。
//	前者是产品文案（会频繁调整），后者是协议细节（很少变动），
//	混在一起会让每次改文案都要动传输代码，容易引入回归。
//
// 设计取舍（为什么是纯内联样式的 HTML）：
//   - 邮件客户端对 CSS 的支持极不一致，<style> 标签常被剥离，
//     因此所有样式必须内联；
//   - 不使用外部图片与字体：外链图片是垃圾邮件评分的重要负面信号；
//   - 正文同时给出"纯文本可读"的关键信息（验证码单独成行、字号大），
//     即使样式被剥离也不影响使用。
package mailer

import (
	"fmt"
	"html"
	"strings"
	"time"
)

// RegisterCodeEmail 构造注册验证码邮件的主题与 HTML 正文。
//
// 参数：
//   - siteName：站点显示名（来自后台设置）；
//   - code：验证码明文；
//   - ttl：有效期。
func RegisterCodeEmail(siteName, code string, ttl time.Duration) (subject, htmlBody string) {
	// 站点名来自后台设置，属于半可信输入：这里做 HTML 转义，
	// 避免管理员无意间填入的字符破坏邮件结构（或在客户端触发脚本解析）。
	name := html.EscapeString(strings.TrimSpace(siteName))
	if name == "" {
		name = "AQUA-API"
	}

	minutes := int(ttl.Minutes())
	if minutes <= 0 {
		minutes = 5
	}

	subject = fmt.Sprintf("【%s】注册验证码", name)

	// 用 fmt.Sprintf 拼装而非 html/template：结构固定且只有三个变量，
	// 引入模板引擎的复杂度不值得；转义已在上方显式完成。
	htmlBody = fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>%[1]s</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;">
    <h1 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">%[1]s</h1>
    <p style="margin:0 0 20px;font-size:13px;color:#64748b;">您正在注册账号，请使用以下验证码完成验证。</p>

    <div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:12px;padding:18px;text-align:center;">
      <div style="font-size:12px;color:#0e7490;letter-spacing:1px;">验证码</div>
      <div style="margin-top:8px;font-size:32px;font-weight:700;letter-spacing:8px;color:#0891b2;font-family:'SFMono-Regular',Consolas,monospace;">%[2]s</div>
    </div>

    <p style="margin:20px 0 0;font-size:13px;color:#475569;line-height:1.7;">
      验证码 <strong>%[3]d 分钟</strong>内有效，且只能使用一次。<br>
      若非本人操作，请忽略本邮件，您的账号不会受到影响。
    </p>

    <hr style="margin:22px 0 14px;border:none;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">本邮件由系统自动发送，请勿直接回复。</p>
  </div>
</body>
</html>`, name, code, minutes)

	return subject, htmlBody
}

// ---------------------------------------------------------------------------
// 全站通知邮件（群发）模板目录
// ---------------------------------------------------------------------------

// BroadcastTemplate 描述一个可在后台选用的全站通知模板。
type BroadcastTemplate struct {
	Key   string // 模板键（落库到 EmailBroadcast.Template，仅作分类与审计用）
	Label string // 后台下拉里的展示名
}

// BroadcastTemplateBillingLine 是「计费专线上线 + 官方交流群」通知的模板键。
const BroadcastTemplateBillingLine = "billing_line"

// BroadcastTemplates 返回可用的通知模板清单。
//
// 为什么做成目录而不是让调用方直接调具体函数：后台下拉据此渲染，
// 新增一个通知模板（如"价格调整""维护窗口"）只需在下面加一条 + 写一个渲染函数，
// 前后端都不必改动（与 channel-types / key-strategies 的做法一致）。
func BroadcastTemplates() []BroadcastTemplate {
	return []BroadcastTemplate{
		{Key: BroadcastTemplateBillingLine, Label: "计费专线上线 + 官方交流群"},
	}
}

// RenderBroadcast 按模板键渲染通知邮件的主题与 HTML 正文。
//
// 返回 ok=false 表示模板键未知。调用方【必须】据此拒绝请求，
// 而不是降级发一封空邮件出去 —— 群发无法撤回，宁可报错也不发错。
func RenderBroadcast(templateKey, siteName string) (subject, htmlBody string, ok bool) {
	switch templateKey {
	case BroadcastTemplateBillingLine:
		return billingLineEmail(siteName)
	default:
		return "", "", false
	}
}

// billingLineEmail 构造「计费专线上线 + 官方交流群」通知的主题与正文。
//
// 两条硬约束（改动文案时必须守住）：
//  1. 正文【不出现任何网址/超链接】，包括本官网域名 —— 运营要求"引导用户前往官网"
//     但不挂链接；同时纯文本对垃圾邮件评分更友好；
//  2. 不承诺缓存命中折扣（上游实测 cached_tokens 恒为 0），
//     也不提上游会注入系统提示等实现细节：说了却兑现不了、或把用户劝退，都是负收益。
func billingLineEmail(siteName string) (subject, htmlBody string, ok bool) {
	name := html.EscapeString(strings.TrimSpace(siteName))
	if name == "" {
		name = "AQUA-API"
	}

	subject = fmt.Sprintf("【%s】高速稳定计费专线已上线（官网价约 6 折）", name)

	htmlBody = fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>计费专线已上线</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;">
    <h1 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">%[1]s</h1>
    <p style="margin:0 0 22px;font-size:13px;color:#64748b;">这是一封站点通知，有两件新东西想告诉你。</p>

    <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">一、高速稳定的计费专线已上线</h2>
    <p style="margin:0 0 12px;font-size:13px;color:#475569;line-height:1.8;">
      我们已接入官方中转的计费专线，按量计费、高速稳定，适合生产环境长期使用。
    </p>
    <ul style="margin:0 0 12px;padding-left:20px;font-size:13px;color:#475569;line-height:1.9;">
      <li>价格约为模型厂商官网价的 <strong>6 折</strong></li>
      <li>首期覆盖 7 个主力模型，对外名称统一带 <code style="font-family:Consolas,monospace;">AQUA/</code> 前缀：
        deepseek-v4-flash、deepseek-v4-pro、deepseek-v4.1-flash、doubao-seed-2.1-turbo、
        doubao-seed-evolving、glm-5.3、glm-5.3-flash</li>
      <li>按上游返回的实际用量结算：输入与输出分别计价，每一笔都能在「调用日志」里
        查到输入 / 输出 token 与扣费金额</li>
      <li>原有「免费公益」分组保持不变、照常可用；计费专线是多出来的一个选择，不影响你现在的调用</li>
    </ul>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:0 0 8px;">
      <div style="font-size:12px;color:#64748b;letter-spacing:.5px;margin-bottom:8px;">怎么开始用（在官网操作，三步）</div>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#0f172a;line-height:1.9;">
        <li>进入「访问令牌」页，新建一个访问令牌</li>
        <li>把新令牌的「所属分组」选为「计费专线」</li>
        <li>调用时模型名填 <code style="font-family:Consolas,monospace;">AQUA/</code> 开头的名称（例如 <code style="font-family:Consolas,monospace;">AQUA/glm-5.3</code>）</li>
      </ol>
    </div>
    <p style="margin:8px 0 22px;font-size:12px;color:#94a3b8;line-height:1.7;">
      建议新建令牌而不是改现有的那一个：免费与计费并存，方便对比，也方便随时切回去。
      各模型的详细价格与全部可用模型，请在官网「模型广场」查看。
    </p>

    <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">二、官方交流群已开通</h2>
    <p style="margin:0 0 10px;font-size:13px;color:#475569;line-height:1.8;">
      官网首页新增了「加入交流群」入口，点进去可以看到两个 QQ 群的群号与入群入口。
    </p>
    <ul style="margin:0 0 10px;padding-left:20px;font-size:13px;color:#475569;line-height:1.9;">
      <li>主群（AQUA开源项目交流群）：<strong style="font-family:Consolas,monospace;">1103667832</strong></li>
      <li>备用群（AQUA开源项目交流二群）：<strong style="font-family:Consolas,monospace;">1006740220</strong></li>
    </ul>
    <p style="margin:0 0 22px;font-size:13px;color:#475569;line-height:1.8;">
      建议先加主群，主群满员了再加备用群。使用中遇到的问题、想要的模型、对计费的疑问，
      都可以直接在群里问，比等邮件回复快得多，其他用户也能一起参考。
    </p>

    <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">三、用量较大的用户，欢迎对接专属方案</h2>
    <p style="margin:0 0 22px;font-size:13px;color:#475569;line-height:1.8;">
      如果你的用量较大，或者有接入、定制方面的需求，欢迎加入交流群后私信管理员对接。
      我们会按你的实际用量谈专属方案，量大从优。
    </p>

    <p style="margin:0;font-size:13px;color:#475569;">感谢你的使用。<br>%[1]s</p>

    <hr style="margin:22px 0 14px;border:none;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">本邮件由系统自动发送，请勿直接回复。</p>
  </div>
</body>
</html>`, name)

	return subject, htmlBody, true
}
