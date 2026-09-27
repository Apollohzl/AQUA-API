// 本文件覆盖渠道级「上游错误重试」接口（迁移 0037）。
//
// 关注三点（都直接对应站长的运营预期）：
//  1. 不提交该字段时必须拿到"与旧版本一致"的默认值（开启 + 默认次数），
//     否则升级本身就会悄悄改变线上行为；
//  2. 显式配置（关闭 / 自定义次数 / 模型级规则）必须能保存并读回；
//  3. 越界取值必须 400 而不是静默兜底——静默兜底会让站长以为配置生效了。
package server

import (
	"encoding/json"
	"net/http"
	"testing"
)

// decodeRetryRules 把接口返回的模型级规则解码为结构切片，便于断言。
func decodeRetryRules(t *testing.T, raw map[string]any) []map[string]any {
	t.Helper()
	value, ok := raw["model_retry_rules"]
	if !ok {
		t.Fatal("响应缺少 model_retry_rules 字段")
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("序列化模型级规则失败：%v", err)
	}
	var rules []map[string]any
	if err := json.Unmarshal(encoded, &rules); err != nil {
		t.Fatalf("解析模型级规则失败：%v", err)
	}
	return rules
}

// TestChannelRetryPolicy_默认与往返 覆盖默认值、显式保存与部分更新不重置。
func TestChannelRetryPolicy_默认与往返(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	// 1) 不提交重试字段：默认必须是"开启 + 默认次数"，且规则清单为空数组
	created := createChannelViaAPI(t, fx,
		`{"name":"默认重试渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"api_key":"sk-x"}`)
	if enabled, _ := created["retry_enabled"].(bool); !enabled {
		t.Fatalf("默认应开启重试（与升级前行为一致），实际 %v", created["retry_enabled"])
	}
	if got, _ := created["retry_max_attempts"].(float64); got != 3 {
		t.Fatalf("默认重试次数应为 3，实际 %v", created["retry_max_attempts"])
	}
	if rules := decodeRetryRules(t, created); len(rules) != 0 {
		t.Fatalf("默认不应有模型级规则，实际 %v", rules)
	}
	path := "/api/admin/channels/" + channelIDOf(t, created)

	// 2) 显式关闭重试 + 自定义次数 + 两条模型级规则
	rec, updated := doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok,
		`{"name":"默认重试渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,`+
			`"retry_enabled":false,"retry_max_attempts":6,`+
			`"model_retry_rules":[{"model":"gpt-4o","enabled":true,"max_attempts":5},{"model":"dall-e-*","enabled":false,"max_attempts":0}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("保存重试配置失败：%d %s", rec.Code, rec.Body.String())
	}
	if enabled, _ := updated["retry_enabled"].(bool); enabled {
		t.Fatalf("重试开关应被关闭，实际 %v", updated["retry_enabled"])
	}
	if got, _ := updated["retry_max_attempts"].(float64); got != 6 {
		t.Fatalf("重试次数应保存为 6，实际 %v", got)
	}
	rules := decodeRetryRules(t, updated)
	if len(rules) != 2 {
		t.Fatalf("应保存 2 条模型级规则，实际 %d 条：%v", len(rules), rules)
	}
	if rules[0]["model"] != "gpt-4o" || rules[0]["enabled"] != true || rules[0]["max_attempts"] != float64(5) {
		t.Fatalf("第一条规则内容不符：%v", rules[0])
	}
	if rules[1]["model"] != "dall-e-*" || rules[1]["enabled"] != false {
		t.Fatalf("第二条规则内容不符：%v", rules[1])
	}

	// 3) 只提交部分字段（不带重试字段）时，三项配置必须保持不变
	rec, partial := doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok,
		`{"name":"改名后的渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("部分更新失败：%d %s", rec.Code, rec.Body.String())
	}
	if enabled, _ := partial["retry_enabled"].(bool); enabled {
		t.Fatalf("部分更新不应重置重试开关，实际 %v", partial["retry_enabled"])
	}
	if got, _ := partial["retry_max_attempts"].(float64); got != 6 {
		t.Fatalf("部分更新不应重置重试次数，实际 %v", got)
	}
	if rules := decodeRetryRules(t, partial); len(rules) != 2 {
		t.Fatalf("部分更新不应清空模型级规则，实际 %v", rules)
	}
}

// TestChannelRetryPolicy_越界次数返回400 验证取值校验落在写入口。
func TestChannelRetryPolicy_越界次数返回400(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	rec, body := doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/channels", fx.adminTok,
		`{"name":"越界重试次数","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"api_key":"sk-x","retry_max_attempts":99}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("越界重试次数应返回 400，实际 %d %s", rec.Code, rec.Body.String())
	}
	if msg := redeemErrorMessage(body); msg == "" {
		t.Fatalf("应给出可读的错误说明，实际 %v", body)
	}
}
