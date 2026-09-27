// channel_retry_test.go 校验渠道/模型级重试策略的解析与归一化。
//
// 意图（Why）：
//
//	这套解析决定"一次请求到底会向上游打几次"。它没有显式的失败反馈——
//	配错了只会表现为"错误率偏高"或"延迟偏大"，因此必须用断言把解析次序钉死。
//
// 流转（Flow）：
//
//	Channel{RetryMode, RetryMaxAttempts, ModelRetryRules} → RetryPolicyFor(对外模型名)
//	  → relay.forwardWithFallback 的尝试预算
//
// 扩展（Extend）：
//
//	新增解析层级时，在 TestRetryPolicyFor_解析次序 中补一组用例，
//	并明确它与既有层级的优先关系。
package model

import "testing"

// TestRetryPolicyFor_零值渠道按开启处理 保护"忘记赋值"的渠道不改变既有行为。
func TestRetryPolicyFor_零值渠道按开启处理(t *testing.T) {
	ch := &Channel{}
	policy := ch.RetryPolicyFor("gpt-4o")
	if !policy.Enabled {
		t.Fatal("零值渠道必须视为开启重试（否则任何漏赋值都会静默拉高错误率）")
	}
	if policy.MaxAttempts != DefaultRetryMaxAttempts {
		t.Fatalf("重试次数 = %d，期望默认 %d", policy.MaxAttempts, DefaultRetryMaxAttempts)
	}
}

// TestRetryPolicyFor_解析次序 锁定「精确 > 最长前缀 > 渠道级」。
func TestRetryPolicyFor_解析次序(t *testing.T) {
	ch := &Channel{
		RetryMode:        RetryModeOff,
		RetryMaxAttempts: 2,
		ModelRetryRules: []ModelRetryRule{
			{Model: "gpt-4*", Enabled: true, MaxAttempts: 7},
			{Model: "gpt-4o", Enabled: false, MaxAttempts: 1},
		},
	}

	// 1) 精确匹配优先于前缀匹配
	if policy := ch.RetryPolicyFor("gpt-4o"); policy.Enabled || policy.MaxAttempts != 1 {
		t.Fatalf("精确规则应生效（关闭 + 1 次），实际 %+v", policy)
	}
	// 2) 无精确规则时用最长前缀
	if policy := ch.RetryPolicyFor("gpt-4o-mini"); !policy.Enabled || policy.MaxAttempts != 7 {
		t.Fatalf("前缀规则应生效（开启 + 7 次），实际 %+v", policy)
	}
	// 3) 都不命中则回落到渠道级
	if policy := ch.RetryPolicyFor("claude-3"); policy.Enabled || policy.MaxAttempts != 2 {
		t.Fatalf("应回落到渠道级（关闭 + 2 次），实际 %+v", policy)
	}
}

// TestRetryPolicyFor_最长前缀优先 验证同族多条前缀规则时的取舍。
func TestRetryPolicyFor_最长前缀优先(t *testing.T) {
	ch := &Channel{
		RetryMode: RetryModeOn,
		ModelRetryRules: []ModelRetryRule{
			{Model: "gpt-*", Enabled: false},
			{Model: "gpt-4-*", Enabled: true, MaxAttempts: 9},
		},
	}
	policy := ch.RetryPolicyFor("gpt-4-turbo")
	if !policy.Enabled || policy.MaxAttempts != 9 {
		t.Fatalf("更长的前缀应胜出，实际 %+v", policy)
	}
}

// TestNormalizeRetryMaxAttempts_夹取区间 验证越界值不会传到转发层。
func TestNormalizeRetryMaxAttempts_夹取区间(t *testing.T) {
	cases := []struct {
		in   int
		want int
	}{
		{-5, DefaultRetryMaxAttempts},
		{0, DefaultRetryMaxAttempts},
		{1, 1},
		{MaxRetryMaxAttempts, MaxRetryMaxAttempts},
		{MaxRetryMaxAttempts + 100, MaxRetryMaxAttempts},
	}
	for _, tc := range cases {
		if got := NormalizeRetryMaxAttempts(tc.in); got != tc.want {
			t.Fatalf("NormalizeRetryMaxAttempts(%d) = %d，期望 %d", tc.in, got, tc.want)
		}
	}
}

// TestNormalizeModelRetryRules_去空白与去重 保护落库内容的整洁。
func TestNormalizeModelRetryRules_去空白与去重(t *testing.T) {
	rules := NormalizeModelRetryRules([]ModelRetryRule{
		{Model: "  gpt-4o  ", Enabled: true, MaxAttempts: 2},
		{Model: "", Enabled: true},
		{Model: "gpt-4o", Enabled: false, MaxAttempts: 5},
	})
	if len(rules) != 1 {
		t.Fatalf("应只保留 1 条规则，实际 %d 条：%+v", len(rules), rules)
	}
	if rules[0].Model != "gpt-4o" {
		t.Fatalf("模型名应去除空白，实际 %q", rules[0].Model)
	}
	if !rules[0].Enabled || rules[0].MaxAttempts != 2 {
		t.Fatalf("去重应保留首次出现的规则，实际 %+v", rules[0])
	}
}

// TestChannelValidate_拒绝非法重试配置 验证写入口径。
func TestChannelValidate_拒绝非法重试配置(t *testing.T) {
	base := func() *Channel {
		return &Channel{
			Name:    "测试渠道",
			Type:    1,
			BaseURL: "https://upstream.example.com",
			Weight:  1,
			Group:   "default",
			Status:  ChannelStatusEnabled,
		}
	}

	bad := base()
	bad.RetryMaxAttempts = MaxRetryMaxAttempts + 1
	if err := bad.Validate(); err == nil {
		t.Fatal("重试次数超出上限应被拒绝")
	}

	bad = base()
	bad.RetryMode = RetryMode(99)
	if err := bad.Validate(); err == nil {
		t.Fatal("非法的重试开关取值应被拒绝")
	}

	bad = base()
	bad.ModelRetryRules = []ModelRetryRule{{Model: "gpt 4o", Enabled: true}}
	if err := bad.Validate(); err == nil {
		t.Fatal("模型名含空白应被拒绝（否则规则永远匹配不上）")
	}

	ok := base()
	ok.RetryMode = RetryModeOn
	ok.RetryMaxAttempts = 5
	ok.ModelRetryRules = []ModelRetryRule{{Model: "gpt-4*", Enabled: false, MaxAttempts: 2}}
	if err := ok.Validate(); err != nil {
		t.Fatalf("合法配置不应报错：%v", err)
	}
}
