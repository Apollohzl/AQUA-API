// 本文件覆盖渠道级「密钥失败处置策略」接口（迁移 0024）。
//
// 关注三点（都直接对应站长的运营预期）：
//  1. 默认策略必须是「只冷却不摘除」——新建渠道不提交该字段时也要拿到它；
//  2. 显式选择 auto_remove / 自定义冷却时长后能正确保存并读回；
//  3. 非法策略与越界时长必须 400 而不是静默兜底——
//     静默兜底会让站长以为设置生效了，实际行为却不同。
package server

import (
	"net/http"
	"strings"
	"testing"
)

// TestChannelKeyFailurePolicy_默认与往返 覆盖默认值、显式保存与部分更新不重置。
func TestChannelKeyFailurePolicy_默认与往返(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	// 1) 不提交该字段：应拿到默认的「只冷却不摘除」与 0（系统分级退避）
	created := createChannelViaAPI(t, fx,
		`{"name":"默认策略渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"api_key":"sk-x"}`)
	if got, _ := created["key_failure_policy"].(string); got != "cooldown_only" {
		t.Fatalf("默认失败策略应为 cooldown_only，实际 %q", got)
	}
	if got, _ := created["key_cooldown_seconds"].(float64); got != 0 {
		t.Fatalf("默认冷却时长应为 0，实际 %v", got)
	}
	path := "/api/admin/channels/" + channelIDOf(t, created)

	// 2) 显式选择「失败自动摘除」+ 自定义冷却 300 秒
	rec, updated := doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok,
		`{"name":"默认策略渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,`+
			`"key_failure_policy":"auto_remove","key_cooldown_seconds":300}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("保存失败策略失败：%d %s", rec.Code, rec.Body.String())
	}
	if got, _ := updated["key_failure_policy"].(string); got != "auto_remove" {
		t.Fatalf("失败策略应保存为 auto_remove，实际 %q", got)
	}
	if got, _ := updated["key_cooldown_seconds"].(float64); got != 300 {
		t.Fatalf("冷却时长应保存为 300，实际 %v", got)
	}

	// 3) 只提交部分字段（不带这两个字段）时，两者必须保持不变
	rec, partial := doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok,
		`{"name":"改名后的渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("部分更新失败：%d %s", rec.Code, rec.Body.String())
	}
	if got, _ := partial["key_failure_policy"].(string); got != "auto_remove" {
		t.Fatalf("部分更新不应重置失败策略，实际 %q", got)
	}
	if got, _ := partial["key_cooldown_seconds"].(float64); got != 300 {
		t.Fatalf("部分更新不应重置冷却时长，实际 %v", got)
	}

	// 4) 显式把冷却时长改回 0（表示"用系统默认退避"）必须能生效——
	// 这正是需要用指针区分"未提交"与"提交了 0"的原因。
	rec, reset := doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok,
		`{"name":"改名后的渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"key_cooldown_seconds":0}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("改回 0 失败：%d %s", rec.Code, rec.Body.String())
	}
	if got, _ := reset["key_cooldown_seconds"].(float64); got != 0 {
		t.Fatalf("冷却时长应被改回 0，实际 %v", got)
	}
}

// TestChannelKeyFailurePolicy_非法值返回400 覆盖两条路径上的校验。
func TestChannelKeyFailurePolicy_非法值返回400(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	// 非法策略：错误信息里必须列出可选值，管理员才能自助修正
	rec, body := doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/channels", fx.adminTok,
		`{"name":"非法失败策略","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"api_key":"sk-x","key_failure_policy":"never_die"}`)
	if rec.Code != http.StatusBadRequest || redeemErrorCode(body) != "invalid_key_failure_policy" {
		t.Fatalf("非法失败策略应返回 400/invalid_key_failure_policy，实际 %d %v", rec.Code, body)
	}
	if msg := redeemErrorMessage(body); !strings.Contains(msg, "cooldown_only") {
		t.Fatalf("错误信息应列出可选策略，实际 %q", msg)
	}

	// 越界冷却时长（超过上限）必须被拒绝而不是静默夹取
	rec, body = doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/channels", fx.adminTok,
		`{"name":"越界冷却","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"api_key":"sk-x","key_cooldown_seconds":99999999}`)
	if rec.Code != http.StatusBadRequest || redeemErrorCode(body) != "invalid_key_cooldown_seconds" {
		t.Fatalf("越界冷却时长应返回 400/invalid_key_cooldown_seconds，实际 %d %v", rec.Code, body)
	}

	// 更新路径同样拦截
	created := createChannelViaAPI(t, fx,
		`{"name":"正常渠道2","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"api_key":"sk-x"}`)
	path := "/api/admin/channels/" + channelIDOf(t, created)
	rec, body = doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok,
		`{"name":"正常渠道2","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"key_failure_policy":"bogus"}`)
	if rec.Code != http.StatusBadRequest || redeemErrorCode(body) != "invalid_key_failure_policy" {
		t.Fatalf("更新时非法失败策略应返回 400，实际 %d %v", rec.Code, body)
	}
}

// TestKeyFailurePolicyCatalog_目录下发 覆盖策略目录接口（含上限与默认值）。
func TestKeyFailurePolicyCatalog_目录下发(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	rec, body := doBearerJSON(t, fx.srv, http.MethodGet, "/api/admin/key-failure-policies", fx.adminTok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("读取失败策略目录失败：%d %s", rec.Code, rec.Body.String())
	}
	items, ok := body["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("应下发 2 种策略，实际 %v", body["items"])
	}
	// 每项都要有说明文案（前端据此渲染帮助文本，不硬编码）
	first, _ := items[0].(map[string]any)
	if desc, _ := first["description"].(string); desc == "" {
		t.Fatal("策略项必须带说明文案")
	}
	if got, _ := body["max_cooldown_seconds"].(float64); got != 86400 {
		t.Fatalf("应下发冷却时长上限 86400，实际 %v", body["max_cooldown_seconds"])
	}
	if got, _ := body["default_failure_policy"].(string); got != "cooldown_only" {
		t.Fatalf("应下发默认策略 cooldown_only，实际 %q", got)
	}
}
