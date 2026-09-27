// 全站通知邮件（群发）模板的单元测试。
//
// 测试重点（为什么测这些）：
//   - 正文【不含任何网址/超链接】：这是运营给出的硬要求（引导去官网但不挂链接），
//     同时纯文本对垃圾邮件评分更友好；一旦有人在改文案时顺手贴了个链接，
//     本用例会立刻拦住；
//   - 关键信息必须在：6 折、7 个模型名、三步操作、两个群号 —— 少一个，
//     用户收到的就是一封"说了等于没说"的通知，而群发发了就收不回来；
//   - 站点名必须转义：它来自后台设置，属于半可信输入。
package mailer

import (
	"strings"
	"testing"
)

// TestRenderBroadcast_模板目录与未知键 覆盖"目录里有 key、渲染器不认的键必须失败"。
func TestRenderBroadcast_模板目录与未知键(t *testing.T) {
	templates := BroadcastTemplates()
	if len(templates) == 0 {
		t.Fatal("模板目录不应为空，否则后台无从选择")
	}
	found := false
	for _, item := range templates {
		if item.Key == BroadcastTemplateBillingLine {
			found = true
		}
		if item.Label == "" {
			t.Errorf("模板 %s 缺少展示名（后台下拉会是空白项）", item.Key)
		}
	}
	if !found {
		t.Fatalf("模板目录里缺少 %s", BroadcastTemplateBillingLine)
	}

	// 未知键必须返回 ok=false：调用方据此拒绝请求，而不是发一封空邮件出去
	if _, _, ok := RenderBroadcast("not-a-template", "AQUA-API"); ok {
		t.Fatal("未知模板键应返回 ok=false")
	}
}

// TestRenderBroadcast_计费专线通知关键信息齐全且无链接 覆盖内容约束。
func TestRenderBroadcast_计费专线通知关键信息齐全且无链接(t *testing.T) {
	subject, body, ok := RenderBroadcast(BroadcastTemplateBillingLine, "AQUA-API")
	if !ok {
		t.Fatal("计费专线模板应可渲染")
	}

	if !strings.Contains(subject, "AQUA-API") || !strings.Contains(subject, "6 折") {
		t.Errorf("主题应含站点名与利益点，实际 %q", subject)
	}

	// 关键信息逐项核对（每一项缺失都会让通知失去意义）
	required := []string{
		"高速稳定", "6 折",
		"deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4.1-flash",
		"doubao-seed-2.1-turbo", "doubao-seed-evolving",
		"glm-5.3", "glm-5.3-flash",
		"访问令牌", "所属分组", "计费专线",
		"免费公益",
		"1103667832", "1006740220",
	}
	for _, want := range required {
		if !strings.Contains(body, want) {
			t.Errorf("正文缺少关键信息 %q", want)
		}
	}

	// 硬约束：不含任何网址（含本站域名），也不含 <a> 超链接
	for _, forbidden := range []string{"http://", "https://", "<a ", "aqua.is3.cc", "www."} {
		if strings.Contains(body, forbidden) {
			t.Errorf("正文不应出现 %q（运营要求引导去官网但不挂链接）", forbidden)
		}
	}

	// 不该出现的承诺：缓存命中折扣（上游实测 cached_tokens 恒为 0，说了兑现不了）
	if strings.Contains(body, "缓存") {
		t.Error("正文不应承诺缓存相关能力（实测上游不回报缓存命中）")
	}
}

// TestRenderBroadcast_站点名被转义 覆盖"半可信输入不得破坏邮件结构"。
func TestRenderBroadcast_站点名被转义(t *testing.T) {
	_, body, ok := RenderBroadcast(BroadcastTemplateBillingLine, `<script>x</script>`)
	if !ok {
		t.Fatal("模板应可渲染")
	}
	if strings.Contains(body, "<script>") {
		t.Fatal("站点名中的标签必须被转义，否则会在邮件客户端里被当作脚本解析")
	}

	// 站点名为空时回退默认名，而不是留下一处空白
	_, fallback, _ := RenderBroadcast(BroadcastTemplateBillingLine, "   ")
	if !strings.Contains(fallback, "AQUA-API") {
		t.Error("站点名为空时应回退为 AQUA-API")
	}
}
