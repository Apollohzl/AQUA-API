// 订阅账号批量导入解析的单元测试。
//
// 意图（Why）：
//
//	导入是站长最直接的接触面：他手上是 Codex CLI 导出的 auth.json，
//	粘进来必须"能认出来、能自动补齐账号标识"。解析写错的后果不是报错，
//	而是静默少导入几个账号（或把不同账号判成重复只留一个），
//	表现为"池子里账号数对不上"，极难排查。因此把这些形态都钉成用例。
//
// 流转（Flow）：
//
//	ParseCredentialList(raw, provider) → 断言条数与关键字段
//
// 扩展（Extend）：
//
//	收到新的导出格式时：先在这里加一条最小样例，再改解析实现。
package model

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

// codexTestJWT 生成一个含账号声明的 JWT（不校验签名，仅用于解析测试）。
func codexTestJWT(accountID, planType string) string {
	payload := `{"https://api.openai.com/auth":{"chatgpt_account_id":"` + accountID +
		`","chatgpt_plan_type":"` + planType + `"}}`
	return "header." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".signature"
}

// TestParseCredentialList_CodexAuthJSON 覆盖最典型的一种输入：CLI 导出的 auth.json。
func TestParseCredentialList_CodexAuthJSON(t *testing.T) {
	raw := `{
		"OPENAI_API_KEY": null,
		"tokens": {
			"access_token": "` + codexTestJWT("acc_json", "plus") + `",
			"refresh_token": "rt_json_value",
			"account_id": "acc_json",
			"id_token": ""
		},
		"last_refresh": "2026-09-27T10:00:00Z"
	}`

	inputs := ParseCredentialList(raw, CodexOAuthProviderName)
	if len(inputs) != 1 {
		t.Fatalf("应解析出 1 条凭据，实际 %d 条", len(inputs))
	}

	got := inputs[0]
	if got.Kind != CredentialKindOAuth {
		t.Errorf("Kind = %q，期望 oauth", got.Kind)
	}
	if got.RefreshToken != "rt_json_value" {
		t.Errorf("refresh_token = %q，未正确提取", got.RefreshToken)
	}
	if got.AccountID != "acc_json" {
		t.Errorf("account_id = %q，期望 acc_json", got.AccountID)
	}
	if got.Provider != CodexOAuthProviderName {
		t.Errorf("provider = %q，期望 %q（刷新时靠它找到配置）", got.Provider, CodexOAuthProviderName)
	}
}

// TestParseCredentialList_账号标识从令牌补齐 覆盖"JSON 里没写 account_id"的常见情况。
func TestParseCredentialList_账号标识从令牌补齐(t *testing.T) {
	raw := `{"tokens":{"access_token":"` + codexTestJWT("acc_from_jwt", "pro") + `","refresh_token":"rt_1"}}`

	inputs := ParseCredentialList(raw, "")
	if len(inputs) != 1 {
		t.Fatalf("应解析出 1 条凭据，实际 %d 条", len(inputs))
	}
	if inputs[0].AccountID != "acc_from_jwt" {
		t.Errorf("account_id = %q，期望从 access_token 的 JWT 里补齐 acc_from_jwt", inputs[0].AccountID)
	}
	if inputs[0].PlanType != "pro" {
		t.Errorf("plan_type = %q，期望从令牌里补齐 pro", inputs[0].PlanType)
	}
}

// TestParseCredentialList_驼峰与数组形态 覆盖不同工具导出的字段命名。
func TestParseCredentialList_驼峰与数组形态(t *testing.T) {
	raw := `[
		{"tokens":{"accessToken":"` + codexTestJWT("acc_a", "plus") + `","refreshToken":"rt_a"},"email":"a@example.com"},
		{"refreshToken":"rt_b","chatgptAccountId":"acc_b","planType":"team"}
	]`

	inputs := ParseCredentialList(raw, "")
	if len(inputs) != 2 {
		t.Fatalf("应解析出 2 条凭据，实际 %d 条：%#v", len(inputs), inputs)
	}
	if inputs[0].AccountHint != "a@example.com" {
		t.Errorf("账号标识（邮箱）= %q，期望 a@example.com", inputs[0].AccountHint)
	}
	if inputs[1].RefreshToken != "rt_b" || inputs[1].AccountID != "acc_b" || inputs[1].PlanType != "team" {
		t.Errorf("第 2 条解析不正确：%#v", inputs[1])
	}
}

// TestParseCredentialList_JSONL与无关字段 覆盖每行一个 JSON 与"混入无关对象"。
func TestParseCredentialList_JSONL与无关字段(t *testing.T) {
	raw := strings.Join([]string{
		`{"version":"1.2.3","exported_at":"2026-09-27"}`,
		`{"tokens":{"refresh_token":"rt_line_1","account_id":"acc_l1"}}`,
		`{"tokens":{"refresh_token":"rt_line_2","account_id":"acc_l2"}}`,
	}, "\n")

	inputs := ParseCredentialList(raw, "")
	if len(inputs) != 2 {
		t.Fatalf("无关对象应被跳过、其余两条应保留，实际 %d 条：%#v", len(inputs), inputs)
	}
	if inputs[0].RefreshToken != "rt_line_1" || inputs[1].RefreshToken != "rt_line_2" {
		t.Errorf("JSONL 顺序或内容错误：%#v", inputs)
	}
}

// TestParseCredentialList_纯文本行仍然可用 保证历史用法不被破坏。
func TestParseCredentialList_纯文本行仍然可用(t *testing.T) {
	raw := "# 注释行\nrt_plain_1 账号甲\nrt_plain_2,账号乙\n"

	inputs := ParseCredentialList(raw, "custom_provider")
	if len(inputs) != 2 {
		t.Fatalf("应解析出 2 条凭据，实际 %d 条", len(inputs))
	}
	if inputs[0].RefreshToken != "rt_plain_1" || inputs[0].AccountHint != "账号甲" {
		t.Errorf("第 1 条解析不正确：%#v", inputs[0])
	}
	if inputs[1].RefreshToken != "rt_plain_2" || inputs[1].AccountHint != "账号乙" {
		t.Errorf("第 2 条解析不正确：%#v", inputs[1])
	}
}

// TestIdentityHash_仅有访问令牌时不互相判重 覆盖"只导短期令牌"的退化分支。
//
// 若把"空 refresh_token"直接拿去算摘要，一批只带 access_token 的账号
// 会被整体判为重复，导入 50 个只留下 1 个——而界面上不会有任何提示。
func TestIdentityHash_仅有访问令牌时不互相判重(t *testing.T) {
	hash := func(value string) string { return "h:" + value }

	first := CredentialInput{Kind: CredentialKindOAuth, AccessToken: "at_1"}
	second := CredentialInput{Kind: CredentialKindOAuth, AccessToken: "at_2"}
	if first.IdentityHash(hash) == second.IdentityHash(hash) {
		t.Fatal("两个不同的 access_token 被判为同一凭据（会导致导入时相互覆盖）")
	}

	withRefresh := CredentialInput{Kind: CredentialKindOAuth, RefreshToken: "rt_1", AccessToken: "at_x"}
	if withRefresh.IdentityHash(hash) != hash("rt_1") {
		t.Error("有 refresh_token 时应以它作为去重标识（access_token 每次刷新都变）")
	}
}

// TestCredentialInputValidate_两种OAuth形态都接受 钉住导入边界。
func TestCredentialInputValidate_两种OAuth形态都接受(t *testing.T) {
	cases := []struct {
		name    string
		input   CredentialInput
		wantErr bool
	}{
		{"带 refresh_token", CredentialInput{Kind: CredentialKindOAuth, RefreshToken: "rt"}, false},
		{"只有 access_token", CredentialInput{Kind: CredentialKindOAuth, AccessToken: "at"}, false},
		{"两者都空", CredentialInput{Kind: CredentialKindOAuth}, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.input.Validate()
			if tc.wantErr && err == nil {
				t.Error("期望报错，实际通过")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("期望通过，实际报错: %v", err)
			}
		})
	}
}

// TestNeedsRefresh_没有refresh_token时不刷新 覆盖"只导短期令牌"的调度行为。
//
// 若在这里返回 true，刷新必然失败并被记成凭据故障，
// 一个只是过期需重导的账号会被误当坏账号处理。
func TestNeedsRefresh_没有refresh_token时不刷新(t *testing.T) {
	key := &ChannelKey{
		Kind:        CredentialKindOAuth,
		AccessToken: "at",
		// ExpiresAt 为零值（未知）：按旧逻辑会判定"需要刷新"
	}
	if key.NeedsRefresh(time.Now()) {
		t.Error("缺少 refresh_token 时不应要求刷新（没得刷，只会被记成故障）")
	}

	refreshable := &ChannelKey{Kind: CredentialKindOAuth, RefreshToken: "rt", AccessToken: "at"}
	if !refreshable.NeedsRefresh(time.Now()) {
		t.Error("有过期时间未知但带 refresh_token 的凭据应要求刷新")
	}
}
