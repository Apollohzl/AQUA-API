// 上游进价模型与匹配的测试。
//
// 测试重点（为什么测这些）：
//   - 匹配优先级必须与售价规则完全一致：成本匹配到 A、售价匹配到 B，
//     算出来的毛利就是两条不同规则的差，属于最难发现的错账；
//   - "上游免费（全 0）"与"未录入成本（查不到规则）"必须可区分：
//     前者是结论、后者是未知，混为一谈会让站长以为某模型不花钱；
//   - 公式与售价共用 ComputeTokenQuota，缓存回退规则也必须一致。
package model

import "testing"

func TestMatchChannelModelCost_优先级与售价一致(t *testing.T) {
	costs := []*ChannelModelCost{
		{ID: 1, ChannelID: 9, Model: "*", PromptPrice: 1},
		{ID: 2, ChannelID: 9, Model: "qwen-*", PromptPrice: 10},
		{ID: 3, ChannelID: 9, Model: "qwen-long*", PromptPrice: 100},
		{ID: 4, ChannelID: 9, Model: "qwen-long-latest", PromptPrice: 1000},
	}

	cases := []struct {
		model  string
		wantID uint64
	}{
		{"qwen-long-latest", 4}, // 精确优先
		{"qwen-long-plus", 3},   // 较长的前缀优先
		{"qwen-turbo", 2},       // 较短的前缀
		{"gpt-4o", 1},           // 兜底到全局通配
	}
	for _, tc := range cases {
		got := MatchChannelModelCost(costs, tc.model)
		if got == nil || got.ID != tc.wantID {
			t.Fatalf("模型 %q 应命中 ID=%d 的成本规则，实际 %+v", tc.model, tc.wantID, got)
		}
	}

	if got := MatchChannelModelCost(nil, "任意"); got != nil {
		t.Fatalf("无规则时应返回 nil（表示未录入），实际 %+v", got)
	}
}

func TestMatchChannelModelCost_同具体度取ID最小(t *testing.T) {
	// 理论上被唯一索引拦住，但数据被人工改动时仍应给出稳定结果
	costs := []*ChannelModelCost{
		{ID: 7, ChannelID: 9, Model: "同一模型"},
		{ID: 3, ChannelID: 9, Model: "同一模型"},
	}
	if got := MatchChannelModelCost(costs, "同一模型"); got == nil || got.ID != 3 {
		t.Fatalf("同具体度应取 ID 最小的规则，实际 %+v", got)
	}
}

func TestChannelModelCost_免费与未录入可区分(t *testing.T) {
	free := &ChannelModelCost{ID: 1, ChannelID: 1, Model: "免费模型"}
	if !free.IsFree() {
		t.Fatalf("四个价格全为 0 应判定为上游免费")
	}

	paid := &ChannelModelCost{ID: 2, ChannelID: 1, Model: "付费模型", PromptPrice: 1}
	if paid.IsFree() {
		t.Fatalf("有价格时不应判定为免费")
	}

	// 相同模型名在"有规则但全 0"与"没有规则"两种情形下的结果必须不同：
	// 前者匹配得到规则（成本 0），后者匹配为 nil（未知）。
	if got := MatchChannelModelCost([]*ChannelModelCost{free}, "免费模型"); got == nil || !got.IsFree() {
		t.Fatalf("免费规则应能被匹配到并标记为免费，实际 %+v", got)
	}
	if got := MatchChannelModelCost([]*ChannelModelCost{free}, "别的模型"); got != nil {
		t.Fatalf("未录入的模型应匹配为 nil，实际 %+v", got)
	}
}

func TestChannelModelCost_成本换算与缓存回退(t *testing.T) {
	// 输入 3_000_000 / 1M、缓存 300_000 / 1M（1 折）、输出 15_000_000 / 1M
	cost := &ChannelModelCost{
		ID: 1, ChannelID: 1, Model: "m",
		PromptPrice: 3_000_000, CachePrice: 300_000, CompletionPrice: 15_000_000,
	}

	cases := []struct {
		name       string
		prompt     int64
		completion int64
		cached     int64
		want       int64
	}{
		{"无缓存命中", 1_000_000, 0, 0, 3_000_000},
		{"全部命中缓存", 1_000_000, 0, 1_000_000, 300_000},
		{"一半命中", 1_000_000, 0, 500_000, 1_650_000},
		{"缓存数超上限被夹住", 1_000_000, 0, 9_999_999, 300_000},
		{"输出按输出价", 0, 1_000_000, 0, 15_000_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := cost.ComputeTokenCost(tc.prompt, tc.completion, tc.cached)
			if got != tc.want {
				t.Fatalf("应得 %d，实际 %d", tc.want, got)
			}
		})
	}

	// 未配置缓存价 → 回退输入价；与售价规则的换算结果必须完全一致
	legacy := &ChannelModelCost{ID: 2, ChannelID: 1, Model: "m",
		PromptPrice: 3_000_000, CompletionPrice: 15_000_000}
	price := &ModelPrice{PromptPrice: 3_000_000, CompletionPrice: 15_000_000}

	gotCost := legacy.ComputeTokenCost(1_000_000, 1_000_000, 800_000)
	gotQuota := price.ComputeQuotaWithCache(1_000_000, 1_000_000, 800_000)
	if gotCost != gotQuota {
		t.Fatalf("进价与售价的换算结果必须一致：进价 %d / 售价 %d", gotCost, gotQuota)
	}

	// nil 安全
	var missing *ChannelModelCost
	if got := missing.ComputeTokenCost(1000, 1000, 0); got != 0 {
		t.Fatalf("nil 成本应返回 0，实际 %d", got)
	}
	if got := missing.ComputeCallCost(3); got != 0 {
		t.Fatalf("nil 成本的按次换算应返回 0，实际 %d", got)
	}
}

func TestChannelModelCost_按次成本(t *testing.T) {
	cost := &ChannelModelCost{ID: 1, ChannelID: 1, Model: "sd", PerCallPrice: 500}
	if got := cost.ComputeCallCost(3); got != 1500 {
		t.Fatalf("3 次应得 1500，实际 %d", got)
	}
	// count <= 0 按 1 次处理：缺省即"一次调用"，按 0 算会变成免费
	if got := cost.ComputeCallCost(0); got != 500 {
		t.Fatalf("0 次应按 1 次处理得 500，实际 %d", got)
	}
}

func TestChannelModelCost_Validate(t *testing.T) {
	if err := (&ChannelModelCost{ChannelID: 1, Model: "m", PromptPrice: 1}).Validate(); err != nil {
		t.Fatalf("合法规则不应报错: %v", err)
	}

	invalid := []*ChannelModelCost{
		{ChannelID: 0, Model: "m"},   // 必须归属渠道
		{ChannelID: 1, Model: "   "}, // 模型名不能为空
		{ChannelID: 1, Model: "m", PromptPrice: -1},
		{ChannelID: 1, Model: "m", CachePrice: -1},
		{ChannelID: 1, Model: "m", CompletionPrice: -1},
		{ChannelID: 1, Model: "m", PerCallPrice: -1},
	}
	for _, cost := range invalid {
		if err := cost.Validate(); err == nil {
			t.Errorf("非法规则应报错: %+v", cost)
		}
	}
}
