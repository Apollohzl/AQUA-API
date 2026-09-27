// 计价规则的匹配与换算测试。
//
// 测试重点（为什么测这些）：
//   - 匹配优先级：定价规则常有"全局默认价 + 个别模型特价"，
//     若匹配顺序写反，特价会被默认价覆盖，站长会觉得"配了特价却没生效"；
//   - 换算正确性：这是全站唯一一处把 token 变成钱的地方，算错就是账目错；
//   - 边界：0 token、负数、未启用规则、无匹配规则。
package model

import (
	"strings"
	"testing"
)

func TestModelPrice_Matches(t *testing.T) {
	cases := []struct {
		pattern string
		model   string
		want    bool
	}{
		{"gpt-4o", "gpt-4o", true},
		{"gpt-4o", "gpt-4o-mini", false}, // 精确匹配不负责前缀
		{"gpt-4*", "gpt-4o", true},
		{"gpt-4*", "gpt-4-turbo", true},
		{"gpt-4*", "gpt-3.5-turbo", false},
		{"*", "任意模型", true},
		{"*", "meta/llama-3.1-8b-instruct", true},
	}

	for _, tc := range cases {
		price := &ModelPrice{Model: tc.pattern, Enabled: true}
		if got := price.Matches(tc.model); got != tc.want {
			t.Errorf("模式 %q 匹配 %q 应为 %v，实际 %v", tc.pattern, tc.model, tc.want, got)
		}
	}
}

func TestMatchModelPrice_优先级(t *testing.T) {
	prices := []*ModelPrice{
		{ID: 1, Model: "*", PromptPrice: 1, Enabled: true},
		{ID: 2, Model: "gpt-*", PromptPrice: 10, Enabled: true},
		{ID: 3, Model: "gpt-4*", PromptPrice: 100, Enabled: true},
		{ID: 4, Model: "gpt-4o", PromptPrice: 1000, Enabled: true},
	}

	// 精确匹配胜出
	got := MatchModelPrice(prices, "gpt-4o")
	if got == nil || got.ID != 4 {
		t.Fatalf("gpt-4o 应命中 ID=4 的精确规则，实际 %v", describe(got))
	}

	// 较长的前缀胜出（gpt-4* 比 gpt-* 更具体）
	got = MatchModelPrice(prices, "gpt-4-turbo")
	if got == nil || got.ID != 3 {
		t.Fatalf("gpt-4-turbo 应命中 ID=3（gpt-4*），实际 %v", describe(got))
	}

	// 较短前缀
	got = MatchModelPrice(prices, "gpt-3.5-turbo")
	if got == nil || got.ID != 2 {
		t.Fatalf("gpt-3.5-turbo 应命中 ID=2（gpt-*），实际 %v", describe(got))
	}

	// 兜底到全局通配
	got = MatchModelPrice(prices, "claude-3-opus")
	if got == nil || got.ID != 1 {
		t.Fatalf("其他模型应命中 ID=1（*），实际 %v", describe(got))
	}
}

func TestMatchModelPrice_跳过停用规则(t *testing.T) {
	prices := []*ModelPrice{
		{ID: 1, Model: "gpt-4o", PromptPrice: 1000, Enabled: false}, // 停用
		{ID: 2, Model: "*", PromptPrice: 1, Enabled: true},
	}

	got := MatchModelPrice(prices, "gpt-4o")
	if got == nil || got.ID != 2 {
		t.Fatalf("停用的精确规则应被跳过，应命中通配规则，实际 %v", describe(got))
	}
}

func TestMatchModelPrice_无匹配返回nil(t *testing.T) {
	prices := []*ModelPrice{
		{ID: 1, Model: "gpt-4o", Enabled: true},
	}
	if got := MatchModelPrice(prices, "claude-3"); got != nil {
		t.Fatalf("无匹配时应返回 nil（表示未定价），实际 %v", describe(got))
	}
	if got := MatchModelPrice(nil, "any"); got != nil {
		t.Fatalf("空规则集应返回 nil，实际 %v", describe(got))
	}
}

func TestModelPrice_ComputeQuota(t *testing.T) {
	// 价格口径：每 100 万 token 的额度
	price := &ModelPrice{PromptPrice: 3_000_000, CompletionPrice: 15_000_000, Enabled: true}

	cases := []struct {
		name       string
		prompt     int64
		completion int64
		want       int64
	}{
		{"各 1M token", 1_000_000, 1_000_000, 18_000_000},
		{"1000 / 500", 1000, 500, 3_000 + 7_500},
		{"零用量", 0, 0, 0},
		{"不足 1 个单位向下取整", 1, 0, 0}, // 1 × 3_000_000 / 1_000_000 = 3，此处 3 为正
		{"负数按 0 处理", -100, -100, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := price.ComputeQuota(tc.prompt, tc.completion)
			if tc.name == "不足 1 个单位向下取整" {
				// 1 token × 3_000_000 / 1_000_000 = 3，断言为正即可
				if got <= 0 {
					t.Fatalf("期望正数，实际 %d", got)
				}
				return
			}
			if got != tc.want {
				t.Fatalf("prompt=%d completion=%d 应得 %d，实际 %d", tc.prompt, tc.completion, tc.want, got)
			}
		})
	}

	// nil 价格视为未定价
	var missing *ModelPrice
	if got := missing.ComputeQuota(1000, 1000); got != 0 {
		t.Fatalf("未定价应返回 0，实际 %d", got)
	}
}

func TestModelPrice_ComputeQuotaWithCache(t *testing.T) {
	// 输入 3_000_000 / 1M、缓存 300_000 / 1M（1 折）、输出 15_000_000 / 1M
	price := &ModelPrice{
		PromptPrice: 3_000_000, CachePrice: 300_000, CompletionPrice: 15_000_000,
		Enabled: true,
	}

	cases := []struct {
		name       string
		prompt     int64
		completion int64
		cached     int64
		want       int64
	}{
		// 1M 输入中 0 命中：3_000_000 / 1M × 1M = 3_000_000
		{"无缓存命中", 1_000_000, 0, 0, 3_000_000},
		// 1M 输入全命中：300_000 / 1M × 1M = 300_000
		{"全部命中缓存", 1_000_000, 0, 1_000_000, 300_000},
		// 一半命中：(500k × 3 + 500k × 0.3) = 1_500_000 + 150_000 = 1_650_000
		{"一半命中缓存", 1_000_000, 0, 500_000, 1_650_000},
		// 缓存数超过输入：夹到 prompt，等于全部命中
		{"缓存数超上限被夹住", 1_000_000, 0, 9_999_999, 300_000},
		// 负数缓存按 0 处理
		{"缓存数为负按 0 处理", 1_000_000, 0, -100, 3_000_000},
		// 输出不受缓存影响
		{"输出单独按输出价", 0, 1_000_000, 0, 15_000_000},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := price.ComputeQuotaWithCache(tc.prompt, tc.completion, tc.cached)
			if got != tc.want {
				t.Fatalf("prompt=%d completion=%d cached=%d 应得 %d，实际 %d",
					tc.prompt, tc.completion, tc.cached, tc.want, got)
			}
		})
	}

	// 未配置缓存价（0）：回退输入价，与 ComputeQuota 完全一致
	legacy := &ModelPrice{PromptPrice: 3_000_000, CompletionPrice: 15_000_000, Enabled: true}
	withCache := legacy.ComputeQuotaWithCache(1_000_000, 1_000_000, 800_000)
	if want := legacy.ComputeQuota(1_000_000, 1_000_000); withCache != want {
		t.Fatalf("未配置缓存价时应回退输入价，期望 %d，实际 %d", want, withCache)
	}

	// ComputeQuota 是 cached=0 的特例
	if got := legacy.ComputeQuota(1000, 500); got != legacy.ComputeQuotaWithCache(1000, 500, 0) {
		t.Fatalf("ComputeQuota 应等价于 cached=0 的 ComputeQuotaWithCache")
	}

	// nil 价格视为未定价
	var missing *ModelPrice
	if got := missing.ComputeQuotaWithCache(1000, 1000, 500); got != 0 {
		t.Fatalf("未定价应返回 0，实际 %d", got)
	}
}

func TestModelPrice_ComputeQuota_向下取整不虚增(t *testing.T) {
	// 单价 1 额度 / 1M token：100 token 应得 0（不足 1 单位不计费）
	price := &ModelPrice{PromptPrice: 1, CompletionPrice: 1, Enabled: true}
	if got := price.ComputeQuota(100, 100); got != 0 {
		t.Fatalf("不足 1 额度单位时应为 0，实际 %d", got)
	}
	if got := price.ComputeQuota(1_000_000, 0); got != 1 {
		t.Fatalf("恰好 1M token 应为 1，实际 %d", got)
	}
}

func TestModelPrice_EffectiveBillingMode(t *testing.T) {
	cases := []struct {
		name  string
		price *ModelPrice
		want  string
	}{
		{"显式免费优先", &ModelPrice{BillingMode: BillingModeFree, PromptPrice: 999}, BillingModeFree},
		{"显式按量", &ModelPrice{BillingMode: BillingModeToken, PerCallPrice: 5}, BillingModeToken},
		{"显式按次", &ModelPrice{BillingMode: BillingModePerCall}, BillingModePerCall},
		// 自动判定（历史数据）：只有按次价 → 按次
		{"自动_只有按次价", &ModelPrice{PerCallPrice: 500}, BillingModePerCall},
		// 自动判定：有 token 价 → 按量
		{"自动_有token价", &ModelPrice{PromptPrice: 1, PerCallPrice: 500}, BillingModeToken},
		// 自动判定：有缓存价也算按量口径
		{"自动_只有缓存价", &ModelPrice{CachePrice: 1, PerCallPrice: 500}, BillingModeToken},
		// 自动判定：全 0 走按量，结算结果为 0（与迁移前行为一致）
		{"自动_全零", &ModelPrice{}, BillingModeToken},
		// 无法识别的脏值回退自动判定，而不是当成非法值
		{"无法识别的值回退自动", &ModelPrice{BillingMode: "wat"}, BillingModeToken},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.price.EffectiveBillingMode(); got != tc.want {
				t.Fatalf("EffectiveBillingMode = %q，期望 %q", got, tc.want)
			}
		})
	}

	var missing *ModelPrice
	if got := missing.EffectiveBillingMode(); got != BillingModeToken {
		t.Fatalf("nil 规则应回退按量，实际 %q", got)
	}
	if missing.IsFree() {
		t.Fatalf("nil 规则不是免费（它是未定价）")
	}
}

func TestModelPrice_IsFree只认显式免费(t *testing.T) {
	// 价格为 0 但方式是按量 → 不是免费（它是"按量但恰好为 0"）
	zeroPriced := &ModelPrice{BillingMode: BillingModeToken}
	if zeroPriced.IsFree() {
		t.Fatalf("按量且价格为 0 不应判定为免费")
	}
	free := &ModelPrice{BillingMode: BillingModeFree, PromptPrice: 999}
	if !free.IsFree() {
		t.Fatalf("显式免费应判定为免费（价格字段不生效）")
	}
}

func TestIsValidBillingMode(t *testing.T) {
	for _, mode := range []string{BillingModeFree, BillingModeToken, BillingModePerCall} {
		if !IsValidBillingMode(mode) {
			t.Fatalf("%q 应为合法计费方式", mode)
		}
	}
	for _, mode := range []string{"", "free ", "FREE", "按量", "wat"} {
		if IsValidBillingMode(mode) {
			t.Fatalf("%q 不应被判为合法计费方式", mode)
		}
	}
}

func TestModelPrice_Validate_拒绝非法计费方式(t *testing.T) {
	invalid := &ModelPrice{Model: "m", Group: "default", BillingMode: "tilu"}
	if err := invalid.Validate(); err == nil {
		t.Fatalf("非法计费方式应被拒绝（否则计费会静默走自动判定）")
	}
	for _, mode := range []string{BillingModeAuto, BillingModeFree, BillingModeToken, BillingModePerCall} {
		price := &ModelPrice{Model: "m", Group: "default", BillingMode: mode}
		if err := price.Validate(); err != nil {
			t.Fatalf("合法方式 %q 不应报错: %v", mode, err)
		}
	}
}

func TestModelPrice_Validate(t *testing.T) {
	valid := &ModelPrice{Model: "gpt-4o", Group: "default", PromptPrice: 1, CompletionPrice: 1}
	if err := valid.Validate(); err != nil {
		t.Fatalf("合法规则不应报错: %v", err)
	}

	invalid := []*ModelPrice{
		{Model: "", Group: "default"},
		{Model: "   ", Group: "default"},
		{Model: "gpt-4o", Group: ""},
		{Model: "gpt-4o", Group: "default", PromptPrice: -1},
		{Model: "gpt-4o", Group: "default", CachePrice: -1},
		{Model: "gpt-4o", Group: "default", CompletionPrice: -1},
	}
	for _, price := range invalid {
		if err := price.Validate(); err == nil {
			t.Errorf("非法规则应报错: %+v", price)
		}
	}
}

func TestSortModelPrices_具体优先(t *testing.T) {
	prices := []*ModelPrice{
		{ID: 1, Model: "*"},
		{ID: 2, Model: "gpt-*"},
		{ID: 3, Model: "gpt-4o"},
	}
	SortModelPrices(prices)

	if prices[0].Model != "gpt-4o" {
		t.Fatalf("排序后首个应为精确规则，实际 %q", prices[0].Model)
	}
	if prices[len(prices)-1].Model != "*" {
		t.Fatalf("排序后末个应为全局通配，实际 %q", prices[len(prices)-1].Model)
	}
}

// describe 生成规则的简短描述，便于失败信息定位。
func describe(p *ModelPrice) string {
	if p == nil {
		return "<nil>"
	}
	return strings.Join([]string{"id=", itoa(p.ID), " model=", p.Model}, "")
}

// itoa 是 strconv.FormatUint 的极简封装，避免为一条测试信息引入额外 import。
func itoa(v uint64) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
