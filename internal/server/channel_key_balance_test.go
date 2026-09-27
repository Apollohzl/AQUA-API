// 渠道凭据「余额」能力的接口测试。
//
// 意图（Why）：
//
//	余额是站长人工维护的运营数据，只允许出现在管理员接口。本组用例锁死三件事：
//	  1) 批量粘贴里的"余额标记行"能把余额正确落到各把密钥上，未标记的为"未录入"；
//	  2) 单把密钥接口能可选地更新余额（nil 不改、-1 置未知、0 表示耗尽），
//	     且余额字段会随密钥列表原样读回；
//	  3) 安全底线：公开的模型广场接口绝不能出现余额（或任何渠道/密钥维度）字段。
//
// 流转（Flow）：
//
//	go test ./internal/server/ -run 余额 → httptest 直接调用 Handler（带管理员会话）
//
// 扩展（Extend）：
//
//	余额字段的展示口径若有变化，同步更新本文件的断言与 dto.go 的 channelKeyDTO。
package server

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// channelKeyItemByLabel 从密钥列表响应中按备注定位一条密钥（顺序不可依赖，
// 因为仓储落库时的插入顺序由 map 迭代决定）。
func channelKeyItemByLabel(t *testing.T, items []any, label string) map[string]any {
	t.Helper()
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if got, _ := item["label"].(string); got == label {
			return item
		}
	}
	t.Fatalf("密钥列表中找不到备注为 %q 的项：%v", label, items)
	return nil
}

// TestChannelKeys_余额_导入更新与读回 覆盖"按标记导入 → 读回 → 单把更新余额"的主链路。
func TestChannelKeys_余额_导入更新与读回(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	// 第一把出现在任何余额标记之前 → 未录入；其后的两把共用标记 49。
	keysText := "nvapi-unknown,未知池\n49余额\nnvapi-aaaaaa,池A\nnvapi-bbbbbb,池B"
	createBody := `{"name":"余额渠道","type":1,"base_url":"https://api.example.com","group":"default",` +
		`"priority":1,"weight":1,"status":1,"keys_text":` + strconv.Quote(keysText) + `}`
	created := createChannelViaAPI(t, fx, createBody)
	base := "/api/admin/channels/" + channelIDOf(t, created) + "/keys"

	rec, list := doBearerJSON(t, fx.srv, http.MethodGet, base, fx.adminTok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("读取密钥池失败：%d %s", rec.Code, rec.Body.String())
	}
	items, _ := list["items"].([]any)
	if len(items) != 3 {
		t.Fatalf("应导入 3 把凭据，实际 %d", len(items))
	}

	// 标记之前的密钥：余额未知
	unknown := channelKeyItemByLabel(t, items, "未知池")
	if u, _ := unknown["balance_unknown"].(bool); !u {
		t.Fatalf("未标记的密钥应 balance_unknown=true，实际 %v", unknown)
	}
	if b, _ := unknown["balance"].(float64); int64(b) != -1 {
		t.Fatalf("未标记的密钥余额应为 -1，实际 %v", unknown["balance"])
	}
	if e, _ := unknown["balance_exhausted"].(bool); e {
		t.Fatalf("未知余额不应判定为耗尽，实际 %v", unknown)
	}
	if at, _ := unknown["balance_updated_at"].(float64); at != 0 {
		t.Fatalf("未录入余额的更新时间应为 0，实际 %v", unknown["balance_updated_at"])
	}

	// 标记之后的密钥：余额 49，且非未知、非耗尽
	for _, label := range []string{"池A", "池B"} {
		item := channelKeyItemByLabel(t, items, label)
		if b, _ := item["balance"].(float64); int64(b) != 49 {
			t.Fatalf("%s 余额应为 49，实际 %v", label, item["balance"])
		}
		if u, _ := item["balance_unknown"].(bool); u {
			t.Fatalf("%s 余额不应为未知，实际 %v", label, item)
		}
		if e, _ := item["balance_exhausted"].(bool); e {
			t.Fatalf("%s 余额 49 不应判定为耗尽，实际 %v", label, item)
		}
		if at, _ := item["balance_updated_at"].(float64); at <= 0 {
			t.Fatalf("%s 已知余额应记录更新时间，实际 %v", label, item["balance_updated_at"])
		}
	}

	keyID := uint64(channelKeyItemByLabel(t, items, "池A")["id"].(float64))
	keyPath := "/api/admin/keys/" + strconv.FormatUint(keyID, 10)

	// 更新余额为 0（耗尽）
	rec, resp := doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok, `{"balance":0}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("更新余额失败：%d %s", rec.Code, rec.Body.String())
	}
	if e, _ := resp["balance_exhausted"].(bool); !e {
		t.Fatalf("余额 0 应返回 balance_exhausted=true，实际 %v", resp)
	}

	// 读回确认耗尽
	_, list = doBearerJSON(t, fx.srv, http.MethodGet, base, fx.adminTok, "")
	items, _ = list["items"].([]any)
	after := channelKeyItemByLabel(t, items, "池A")
	if b, _ := after["balance"].(float64); int64(b) != 0 {
		t.Fatalf("余额应已更新为 0，实际 %v", after["balance"])
	}
	if e, _ := after["balance_exhausted"].(bool); !e {
		t.Fatalf("读回余额 0 应 balance_exhausted=true，实际 %v", after)
	}

	// 置回未知
	rec, resp = doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok, `{"balance":-1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("置为未知失败：%d %s", rec.Code, rec.Body.String())
	}
	if u, _ := resp["balance_unknown"].(bool); !u {
		t.Fatalf("余额 -1 应返回 balance_unknown=true，实际 %v", resp)
	}

	// 非法值（小于 -1）应被拒绝
	rec, errBody := doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok, `{"balance":-2}`)
	if rec.Code != http.StatusBadRequest || redeemErrorCode(errBody) != "invalid_balance" {
		t.Fatalf("余额 -2 应返回 400/invalid_balance，实际 %d %v", rec.Code, errBody)
	}

	// 只提交余额也能成功（不要求同时给调度参数），且不影响原有状态更新能力
	rec, resp = doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok, `{"status":2,"balance":20}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("同时更新状态与余额失败：%d %s", rec.Code, rec.Body.String())
	}
	if s, _ := resp["status"].(float64); s != 2 {
		t.Fatalf("状态应更新为 2，实际 %v", resp["status"])
	}
	if b, _ := resp["balance"].(float64); int64(b) != 20 {
		t.Fatalf("余额应更新为 20，实际 %v", resp["balance"])
	}
}

// TestModelPlaza_不暴露余额字段 是安全回归：公开的模型广场绝不能带出余额等运营数据。
func TestModelPlaza_不暴露余额字段(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	// 先造一个确实带余额的渠道，确保"数据里存在余额"这一前提成立
	createChannelViaAPI(t, fx,
		`{"name":"余额渠道","type":1,"base_url":"https://api.example.com","group":"default",`+
			`"priority":1,"weight":1,"status":1,"keys_text":"49余额\nnvapi-aaaaaa"}`)

	rec, _ := doBearerJSON(t, fx.srv, http.MethodGet, "/api/models", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("读取模型广场失败：%d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "balance") {
		t.Fatalf("公开模型广场不应出现余额字段：%s", rec.Body.String())
	}
}
