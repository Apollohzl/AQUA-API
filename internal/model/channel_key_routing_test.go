// 凭据级「分组 / 模型」分叉的单元测试（迁移 0038）。
//
// 意图（Why）：
//
//	这两列决定"同一渠道下的某把凭据会不会被选中"。写错的方向有两种，代价都不小：
//	  1) 过于宽松（该排除的没排除）→ 请求打到一把其实不能调该模型的账号上，
//	     表现为随机失败，且看起来像"上游不稳定"，极难归因；
//	  2) 过于严格（该选上的没选上）→ 池里明明有可用账号，请求却报"无可用凭据"。
//	因此这里把"留空即不限"与"命中才放行"两条规则分别钉死。
//
// 流转（Flow）：
//
//	channel_keys.group_names / models → ChannelKey.Groups / Models
//	  → MatchesScope(分组, 模型) → relay.filterUsableKeysForRequest
//
// 扩展（Extend）：
//
//	新增分叉维度（如按令牌）时，在 TestChannelKey_MatchesScope 的表里补用例，
//	并把判定加进 MatchesScope。
package model

import "testing"

// TestChannelKey_MatchesScope_分组与模型 覆盖分叉判定的全部组合。
func TestChannelKey_MatchesScope_分组与模型(t *testing.T) {
	cases := []struct {
		name   string
		key    ChannelKey
		group  string
		model  string
		expect bool
	}{
		{
			name:   "都未配置即不限",
			key:    ChannelKey{},
			group:  "vip",
			model:  "gpt-4o",
			expect: true,
		},
		{
			name:   "分组命中",
			key:    ChannelKey{Groups: []string{"vip", "svip"}},
			group:  "svip",
			model:  "gpt-4o",
			expect: true,
		},
		{
			name:   "分组不命中",
			key:    ChannelKey{Groups: []string{"vip"}},
			group:  "free",
			model:  "gpt-4o",
			expect: false,
		},
		{
			name:   "只限分组时模型不受限",
			key:    ChannelKey{Groups: []string{"vip"}},
			group:  "vip",
			model:  "任意模型",
			expect: true,
		},
		{
			name:   "模型精确命中",
			key:    ChannelKey{Models: []string{"gpt-4o"}},
			group:  "free",
			model:  "gpt-4o",
			expect: true,
		},
		{
			name:   "模型不命中",
			key:    ChannelKey{Models: []string{"gpt-4o"}},
			group:  "free",
			model:  "claude-3",
			expect: false,
		},
		{
			name:   "模型前缀通配命中",
			key:    ChannelKey{Models: []string{"gpt-4*"}},
			group:  "free",
			model:  "gpt-4o-mini",
			expect: true,
		},
		{
			name:   "模型前缀通配不越界",
			key:    ChannelKey{Models: []string{"gpt-4*"}},
			group:  "free",
			model:  "gpt-3.5-turbo",
			expect: false,
		},
		{
			name:   "全局通配",
			key:    ChannelKey{Models: []string{"*"}},
			group:  "free",
			model:  "任意模型",
			expect: true,
		},
		{
			name:   "两个维度必须同时满足",
			key:    ChannelKey{Groups: []string{"vip"}, Models: []string{"gpt-4o"}},
			group:  "vip",
			model:  "claude-3",
			expect: false,
		},
		{
			name:   "调用方未给分组时不按分组排除",
			key:    ChannelKey{Groups: []string{"vip"}},
			group:  "",
			model:  "gpt-4o",
			expect: true,
		},
		{
			name:   "调用方未给模型时不按模型排除",
			key:    ChannelKey{Models: []string{"gpt-4o"}},
			group:  "free",
			model:  "",
			expect: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.key.MatchesScope(tc.group, tc.model); got != tc.expect {
				t.Fatalf("MatchesScope(%q, %q) = %v，期望 %v（凭据：%+v）",
					tc.group, tc.model, got, tc.expect, tc.key)
			}
		})
	}
}

// TestChannelKey_MatchesScope_忽略空白项 验证手写数据里的空白不会造成"永不命中"。
func TestChannelKey_MatchesScope_忽略空白项(t *testing.T) {
	key := ChannelKey{Groups: []string{"  vip  ", ""}, Models: []string{" gpt-4o "}}
	if !key.MatchesScope("vip", "gpt-4o") {
		t.Fatal("分组与模型两侧的空白都应被忽略后再比较")
	}
}
