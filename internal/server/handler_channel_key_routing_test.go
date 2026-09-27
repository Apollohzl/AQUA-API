// 本文件覆盖凭据级「分组 / 模型」分叉接口（迁移 0038）。
//
// 关注三点：
//  1. 新导入的凭据必须默认"不限"（空数组下发），否则升级就会改变既有调度行为；
//  2. 配置的分组与模型必须能保存并原样读回（含通配符），且能改回"不限"；
//  3. 只提交其中一项必须 400——整组覆盖下缺项会被误写成"不限"，
//     那是一个不易察觉的越权分叉。
package server

import (
	"net/http"
	"strconv"
	"testing"
)

// TestChannelKeyRouting_默认与往返 覆盖默认值、保存、读回与清空。
func TestChannelKeyRouting_默认与往返(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	created := createChannelViaAPI(t, fx,
		`{"name":"分叉渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"keys_text":"nvapi-aaaaaa 池1"}`)
	base := "/api/admin/channels/" + channelIDOf(t, created) + "/keys"

	rec, list := doBearerJSON(t, fx.srv, http.MethodGet, base, fx.adminTok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("读取密钥池失败：%d %s", rec.Code, rec.Body.String())
	}
	items, _ := list["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("应导入 1 把凭据，实际 %d", len(items))
	}
	first, _ := items[0].(map[string]any)

	// 1) 默认必须是"不限"（空数组，而不是 null）
	groups, ok := first["groups"].([]any)
	if !ok {
		t.Fatalf("groups 应以数组下发，实际 %#v", first["groups"])
	}
	if len(groups) != 0 {
		t.Fatalf("默认不应限制分组，实际 %v", groups)
	}
	models, ok := first["models"].([]any)
	if !ok {
		t.Fatalf("models 应以数组下发，实际 %#v", first["models"])
	}
	if len(models) != 0 {
		t.Fatalf("默认不应限制模型，实际 %v", models)
	}

	keyID, _ := first["id"].(float64)
	keyPath := "/api/admin/keys/" + strconv.FormatUint(uint64(keyID), 10)

	// 2) 保存分组与模型（模型带通配符）
	rec, saved := doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok,
		`{"groups":["vip","svip"],"models":["gpt-4o","gpt-4*"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("保存分叉失败：%d %s", rec.Code, rec.Body.String())
	}
	savedGroups, _ := saved["groups"].([]any)
	if len(savedGroups) != 2 {
		t.Fatalf("应回传 2 个分组，实际 %v", saved["groups"])
	}

	// 读回校验
	_, list = doBearerJSON(t, fx.srv, http.MethodGet, base, fx.adminTok, "")
	items, _ = list["items"].([]any)
	first, _ = items[0].(map[string]any)
	gotGroups, _ := first["groups"].([]any)
	gotModels, _ := first["models"].([]any)
	if len(gotGroups) != 2 {
		t.Fatalf("分组应保存为 2 项，实际 %v", first["groups"])
	}
	if len(gotModels) != 2 || gotModels[1] != "gpt-4*" {
		t.Fatalf("模型应保存为 2 项且含通配符，实际 %v", first["models"])
	}

	// 3) 清空限制（显式提交空数组）= 不限，必须能真正生效
	rec, _ = doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok, `{"groups":[],"models":[]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("清空分叉失败：%d %s", rec.Code, rec.Body.String())
	}
	_, list = doBearerJSON(t, fx.srv, http.MethodGet, base, fx.adminTok, "")
	items, _ = list["items"].([]any)
	first, _ = items[0].(map[string]any)
	if got, _ := first["groups"].([]any); len(got) != 0 {
		t.Fatalf("清空后分组应为空（不限），实际 %v", first["groups"])
	}
	if got, _ := first["models"].([]any); len(got) != 0 {
		t.Fatalf("清空后模型应为空（不限），实际 %v", first["models"])
	}
}

// TestChannelKeyRouting_部分提交与非法模型名返回400 覆盖两条写入口径。
func TestChannelKeyRouting_部分提交与非法模型名返回400(t *testing.T) {
	fx := newChannelStrategyFixture(t)

	created := createChannelViaAPI(t, fx,
		`{"name":"分叉渠道","type":1,"base_url":"https://api.example.com","group":"default","priority":1,"weight":1,"status":1,"keys_text":"nvapi-cccccc 池1"}`)
	base := "/api/admin/channels/" + channelIDOf(t, created) + "/keys"

	_, list := doBearerJSON(t, fx.srv, http.MethodGet, base, fx.adminTok, "")
	items, _ := list["items"].([]any)
	first, _ := items[0].(map[string]any)
	keyID, _ := first["id"].(float64)
	keyPath := "/api/admin/keys/" + strconv.FormatUint(uint64(keyID), 10)

	// 只给 groups、不给 models：整组覆盖会把 models 误写成"不限"，必须拒绝
	rec, body := doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok, `{"groups":["vip"]}`)
	if rec.Code != http.StatusBadRequest || redeemErrorCode(body) != "incomplete_routing" {
		t.Fatalf("部分提交应返回 400/incomplete_routing，实际 %d %v", rec.Code, body)
	}

	// 模型名含空白：永远匹配不上任何模型，必须拒绝而不是静默保存
	rec, body = doBearerJSON(t, fx.srv, http.MethodPut, keyPath, fx.adminTok,
		`{"groups":[],"models":["gpt 4o"]}`)
	if rec.Code != http.StatusBadRequest || redeemErrorCode(body) != "invalid_routing" {
		t.Fatalf("非法模型名应返回 400/invalid_routing，实际 %d %v", rec.Code, body)
	}
}
