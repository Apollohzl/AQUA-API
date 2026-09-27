// 本文件覆盖用量细节的采集口径：缓存命中、推理 token、首 token 延迟与输出速率。
//
// 为什么单独测：这些指标是"账单为什么是这个数""模型到底快不快"的唯一依据，
// 解析错一行就会给出一整套看起来合理、实则错误的运营结论。
package relay

import (
	"encoding/json"
	"testing"
	"time"
)

// TestRawUsage_解析缓存与推理明细 验证不同上游的明细字段都能取到。
func TestRawUsage_解析缓存与推理明细(t *testing.T) {
	cases := []struct {
		name          string
		body          string
		wantPrompt    int
		wantCache     int
		wantReasoning int
	}{
		{
			name: "OpenAI 嵌套明细",
			body: `{"prompt_tokens":1000,"completion_tokens":50,"total_tokens":1050,
				"prompt_tokens_details":{"cached_tokens":896},
				"completion_tokens_details":{"reasoning_tokens":32}}`,
			wantPrompt: 1000, wantCache: 896, wantReasoning: 32,
		},
		{
			name:       "Anthropic 口径（顶层缓存字段）",
			body:       `{"input_tokens":800,"output_tokens":20,"cache_read_input_tokens":768}`,
			wantPrompt: 800, wantCache: 768, wantReasoning: 0,
		},
		{
			name:       "上游未提供明细时不臆造",
			body:       `{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}`,
			wantPrompt: 10, wantCache: 0, wantReasoning: 0,
		},
	}
	for _, tc := range cases {
		var raw rawUsage
		if err := json.Unmarshal([]byte(tc.body), &raw); err != nil {
			t.Fatalf("%s：解析失败 %v", tc.name, err)
		}
		usage, ok := raw.normalize()
		if !ok {
			t.Fatalf("%s：应解析出有效用量", tc.name)
		}
		if usage.PromptTokens != tc.wantPrompt {
			t.Errorf("%s：PromptTokens = %d，期望 %d", tc.name, usage.PromptTokens, tc.wantPrompt)
		}
		if usage.CachedTokens != tc.wantCache {
			t.Errorf("%s：CachedTokens = %d，期望 %d", tc.name, usage.CachedTokens, tc.wantCache)
		}
		if usage.ReasoningTokens != tc.wantReasoning {
			t.Errorf("%s：ReasoningTokens = %d，期望 %d", tc.name, usage.ReasoningTokens, tc.wantReasoning)
		}
	}
}

// TestTokensPerSecond_扣除首包时间 验证速率口径（输出 token / 生成时长）。
func TestTokensPerSecond_扣除首包时间(t *testing.T) {
	cases := []struct {
		name      string
		output    int
		totalMS   int
		firstMS   int
		wantAbout float64
	}{
		// 200 个输出 token，总耗时 5s，首包 1s → 生成 4s → 50 tokens/s
		{"流式：扣除首包", 200, 5000, 1000, 50},
		// 非流式没有首包（firstMS=0），总耗时即生成时长 → 40 tokens/s
		{"非流式：用总耗时", 200, 5000, 0, 40},
		// 首包大于总耗时（异常数据）：退回总耗时，不产生负数或无穷
		{"首包异常：退回总耗时", 100, 2000, 3000, 50},
		{"无输出：不可计算", 0, 5000, 1000, 0},
	}
	for _, tc := range cases {
		got := tokensPerSecond(tc.output, tc.totalMS, tc.firstMS)
		if diff := got - tc.wantAbout; diff > 0.01 || diff < -0.01 {
			t.Errorf("%s：tokens/s = %.2f，期望 %.2f", tc.name, got, tc.wantAbout)
		}
	}
}

// TestUsageSniffer_记录首字节时刻 验证 TTFB 取自首个非空分片。
func TestUsageSniffer_记录首字节时刻(t *testing.T) {
	sniffer := newUsageSniffer()
	if !sniffer.FirstByteAt().IsZero() {
		t.Fatal("未写入任何数据时不应有首字节时刻")
	}

	// 空分片不算"首字节"：上游可能先发一个空心跳，那不是真正的首包
	_, _ = sniffer.Write(nil)
	if !sniffer.FirstByteAt().IsZero() {
		t.Fatal("空分片不应被当作首字节")
	}

	_, _ = sniffer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n"))
	first := sniffer.FirstByteAt()
	if first.IsZero() {
		t.Fatal("写入数据后应记录首字节时刻")
	}

	// 后续分片不得覆盖首字节时刻（TTFB 只认第一次）
	time.Sleep(2 * time.Millisecond)
	_, _ = sniffer.Write([]byte("data: [DONE]\n\n"))
	if !sniffer.FirstByteAt().Equal(first) {
		t.Fatal("首字节时刻应只记录一次，后续分片不得覆盖")
	}
}
