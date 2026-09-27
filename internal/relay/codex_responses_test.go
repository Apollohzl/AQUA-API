// Codex（ChatGPT 订阅账号）协议转换的单元测试。
//
// 意图（Why）：
//
//	这一层是"订阅账号能不能用"的全部关键——上游对请求体的约束很硬
//	（store/stream/instructions/不支持字段），响应又是与 chat.completions
//	完全不同的事件流。任何一处写错都不会编译失败，只会表现为
//	"配好了却 400"或"回答缺字少句"，因此必须把行为钉死在测试里。
//
// 流转（Flow）：
//
//	go test ./internal/relay/ -run Codex
//	  ├─ 请求方向：字段映射、硬约束、模型名后缀拆分、工具声明转换
//	  └─ 响应方向：事件流 → 分片、工具调用不重复、用量归一、非流式聚合、错误体
//
// 扩展（Extend）：
//
//	上游新增事件类型时：在 streamEvents 里补一条真实事件样例并断言转换结果。
package relay

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

// decodeCodexRequest 是测试辅助：转换并解析回 map，便于按字段断言。
func decodeCodexRequest(t *testing.T, body string) map[string]any {
	t.Helper()

	converted, err := encodeCodexRequest([]byte(body))
	if err != nil {
		t.Fatalf("转换请求失败: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(converted, &out); err != nil {
		t.Fatalf("解析转换结果失败: %v（原文 %s）", err, converted)
	}
	return out
}

// TestEncodeCodexRequest_硬约束与字段剥离 是请求方向最核心的一条。
func TestEncodeCodexRequest_硬约束与字段剥离(t *testing.T) {
	out := decodeCodexRequest(t, `{
		"model": "gpt-5.4",
		"messages": [
			{"role": "system", "content": "你是严谨的助手"},
			{"role": "user", "content": "你好"}
		],
		"store": true,
		"stream": false,
		"temperature": 0.7,
		"top_p": 0.9,
		"max_tokens": 1024,
		"metadata": {"trace": "abc"},
		"stream_options": {"include_usage": true}
	}`)

	// 三条硬约束：不满足上游直接拒绝，因此必须被强制覆盖
	if out["store"] != false {
		t.Errorf("store = %v，期望 false（下游显式传 true 也要被覆盖）", out["store"])
	}
	if out["stream"] != true {
		t.Errorf("stream = %v，期望 true（上游只支持流式）", out["stream"])
	}
	if got, _ := out["instructions"].(string); got != "你是严谨的助手" {
		t.Errorf("instructions = %q，期望取自 system 消息", got)
	}

	// 下游常见但上游不接受的字段必须消失，否则会 400
	for _, field := range []string{"temperature", "top_p", "max_tokens", "metadata", "stream_options"} {
		if _, exists := out[field]; exists {
			t.Errorf("字段 %q 不应出现在 Codex 请求体里（上游会拒绝）", field)
		}
	}

	input, ok := out["input"].([]any)
	if !ok || len(input) != 1 {
		t.Fatalf("input 应只含 1 条 user 消息（system 已提升为 instructions），实际 %#v", out["input"])
	}
	first, _ := input[0].(map[string]any)
	if first["role"] != "user" {
		t.Errorf("input[0].role = %v，期望 user", first["role"])
	}
	content, _ := first["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("user content 应有 1 个 part，实际 %#v", content)
	}
	part, _ := content[0].(map[string]any)
	if part["type"] != "input_text" || part["text"] != "你好" {
		t.Errorf("user part = %#v，期望 {type:input_text, text:你好}", part)
	}
}

// TestEncodeCodexRequest_无system时注入默认instructions 覆盖"字段不能缺"这条约束。
func TestEncodeCodexRequest_无system时注入默认instructions(t *testing.T) {
	out := decodeCodexRequest(t, `{"model":"gpt-5.4","messages":[{"role":"user","content":"hi"}]}`)

	instructions, _ := out["instructions"].(string)
	if strings.TrimSpace(instructions) == "" {
		t.Fatal("instructions 为空会让上游拒绝请求，必须注入默认值")
	}
	if instructions != codexDefaultInstructions {
		t.Errorf("instructions = %q，期望默认指令", instructions)
	}
}

// TestEncodeCodexRequest_模型名强度后缀 覆盖"后缀要变成 reasoning.effort"。
func TestEncodeCodexRequest_模型名强度后缀(t *testing.T) {
	cases := []struct {
		model      string
		wantModel  string
		wantEffort string
	}{
		{"gpt-5.4-high", "gpt-5.4", "high"},
		{"gpt-5.4", "gpt-5.4", ""},
		{"gpt-5.4-mini", "gpt-5.4-mini", ""}, // -mini 不是强度词，不能误拆
		{"gpt-5.4-xhigh", "gpt-5.4", "xhigh"},
		{"gpt-5.4-max", "gpt-5.4", "xhigh"}, // max 收敛为上游认的 xhigh
	}

	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			out := decodeCodexRequest(t, `{"model":"`+tc.model+`","messages":[{"role":"user","content":"hi"}]}`)
			if out["model"] != tc.wantModel {
				t.Errorf("model = %v，期望 %q", out["model"], tc.wantModel)
			}
			reasoning, _ := out["reasoning"].(map[string]any)
			if tc.wantEffort == "" {
				if reasoning != nil {
					t.Errorf("不应出现 reasoning，实际 %#v", reasoning)
				}
				return
			}
			if reasoning == nil || reasoning["effort"] != tc.wantEffort {
				t.Errorf("reasoning = %#v，期望 effort=%q", reasoning, tc.wantEffort)
			}
			// 带推理时必须请求加密推理内容，否则上游不回传 reasoning 事件
			include, _ := out["include"].([]any)
			if len(include) != 1 || include[0] != "reasoning.encrypted_content" {
				t.Errorf("include = %#v，期望 [reasoning.encrypted_content]", include)
			}
		})
	}
}

// TestEncodeCodexRequest_工具声明与选择 覆盖 tools/functions 与 tool_choice 的形态差异。
func TestEncodeCodexRequest_工具声明与选择(t *testing.T) {
	out := decodeCodexRequest(t, `{
		"model": "gpt-5.4",
		"messages": [{"role": "user", "content": "北京天气"}],
		"tools": [{"type":"function","function":{"name":"get_weather","description":"查天气","parameters":{"type":"object","properties":{"city":{"type":"string"}}}}}],
		"tool_choice": {"type":"function","function":{"name":"get_weather"}}
	}`)

	tools, _ := out["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("tools 应有 1 项，实际 %#v", out["tools"])
	}
	tool, _ := tools[0].(map[string]any)
	// Responses 的工具声明是扁平的：没有 function 这一层
	if tool["name"] != "get_weather" {
		t.Errorf("tool.name = %v，期望扁平结构里的 get_weather（实际 %#v）", tool["name"], tool)
	}
	if _, nested := tool["function"]; nested {
		t.Error("工具声明不应保留 function 嵌套层（上游按扁平形态解析）")
	}

	choice, _ := out["tool_choice"].(map[string]any)
	if choice["type"] != "function" || choice["name"] != "get_weather" {
		t.Errorf("tool_choice = %#v，期望 {type:function, name:get_weather}", choice)
	}
}

// TestEncodeCodexRequest_旧functions字段 覆盖老客户端的兼容路径。
func TestEncodeCodexRequest_旧functions字段(t *testing.T) {
	out := decodeCodexRequest(t, `{
		"model": "gpt-5.4",
		"messages": [{"role": "user", "content": "hi"}],
		"functions": [{"name":"ping","description":"probe","parameters":{"type":"object"}}],
		"function_call": {"name":"ping"}
	}`)

	tools, _ := out["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("旧 functions 应被转换成 tools，实际 %#v", out["tools"])
	}
	if choice, _ := out["tool_choice"].(map[string]any); choice["name"] != "ping" {
		t.Errorf("旧 function_call 应被转换成 tool_choice，实际 %#v", out["tool_choice"])
	}
	// 旧字段本身不能残留（上游会拒绝未知字段）
	for _, field := range []string{"functions", "function_call"} {
		if _, exists := out[field]; exists {
			t.Errorf("字段 %q 应被剥离", field)
		}
	}
}

// TestEncodeCodexRequest_多模态与工具结果 覆盖 content 形态转换。
func TestEncodeCodexRequest_多模态与工具结果(t *testing.T) {
	out := decodeCodexRequest(t, `{
		"model": "gpt-5.4",
		"messages": [
			{"role":"user","content":[{"type":"text","text":"看图"},{"type":"image_url","image_url":{"url":"https://example.com/a.png"}}]},
			{"role":"assistant","content":"我来查","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":1}"}}]},
			{"role":"tool","tool_call_id":"call_1","content":"结果 42"}
		]
	}`)

	input, _ := out["input"].([]any)
	if len(input) != 4 {
		t.Fatalf("input 应有 4 项（1 user + 1 assistant 文本 + 1 function_call + 1 function_call_output），实际 %d：%#v",
			len(input), input)
	}

	userItem, _ := input[0].(map[string]any)
	parts, _ := userItem["content"].([]any)
	imagePart, _ := parts[1].(map[string]any)
	if imagePart["type"] != "input_image" || imagePart["image_url"] != "https://example.com/a.png" {
		t.Errorf("图片 part = %#v，期望 {type:input_image, image_url:...}", imagePart)
	}

	callItem, _ := input[2].(map[string]any)
	if callItem["type"] != "function_call" || callItem["call_id"] != "call_1" || callItem["name"] != "lookup" {
		t.Errorf("工具调用项 = %#v", callItem)
	}

	outputItem, _ := input[3].(map[string]any)
	if outputItem["type"] != "function_call_output" || outputItem["call_id"] != "call_1" || outputItem["output"] != "结果 42" {
		t.Errorf("工具结果项 = %#v", outputItem)
	}
}

// codexTestStream 是一段贴近上游真实形态的事件流：
// 创建 → 推理摘要 → 正文分片 → 完成（带 usage）。
const codexTestStream = `event: response.created
data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.4","status":"in_progress"}}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","delta":"先想一下"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"你好"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"，世界"}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.4","status":"completed","usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18,"input_tokens_details":{"cached_tokens":3},"output_tokens_details":{"reasoning_tokens":2}}}}

`

// convertCodexStream 把上游事件流喂给转换器，返回所有下游分片（已解析）。
func convertCodexStream(t *testing.T, stream string) []map[string]any {
	t.Helper()

	converter := newCodexStreamConverter()
	var chunks []map[string]any
	var done bool

	for _, line := range strings.Split(stream, "\n") {
		payload, ok := codexSSEPayload([]byte(line))
		if !ok {
			continue
		}
		out := converter.consume(payload)
		for _, frame := range strings.Split(string(out), "\n\n") {
			frame = strings.TrimSpace(frame)
			if frame == "" {
				continue
			}
			body, ok := strings.CutPrefix(frame, "data:")
			if !ok {
				continue
			}
			body = strings.TrimSpace(body)
			if body == "[DONE]" {
				done = true
				continue
			}
			var chunk map[string]any
			if err := json.Unmarshal([]byte(body), &chunk); err != nil {
				t.Fatalf("下游分片不是合法 JSON: %s", body)
			}
			chunks = append(chunks, chunk)
		}
	}
	// 上游已给终止事件，finalize 不应再补一份
	if extra := converter.finalize(); len(extra) > 0 {
		t.Errorf("已有终止事件时 finalize 不应再输出，实际 %s", extra)
	}
	if !done {
		t.Error("转换结果缺少 [DONE] 结束标记")
	}
	return chunks
}

// collectDeltaText 拼接所有 content 分片。
func collectDeltaText(chunks []map[string]any, key string) string {
	var builder strings.Builder
	for _, chunk := range chunks {
		choices, _ := chunk["choices"].([]any)
		if len(choices) == 0 {
			continue
		}
		choice, _ := choices[0].(map[string]any)
		delta, _ := choice["delta"].(map[string]any)
		if text, _ := delta[key].(string); text != "" {
			builder.WriteString(text)
		}
	}
	return builder.String()
}

// TestCodexStream_正文推理与用量 覆盖事件流 → 分片的核心映射。
func TestCodexStream_正文推理与用量(t *testing.T) {
	chunks := convertCodexStream(t, codexTestStream)

	if got := collectDeltaText(chunks, "content"); got != "你好，世界" {
		t.Errorf("正文分片拼接 = %q，期望 %q", got, "你好，世界")
	}
	if got := collectDeltaText(chunks, "reasoning_content"); got != "先想一下" {
		t.Errorf("推理分片拼接 = %q，期望 %q", got, "先想一下")
	}

	// 首片应带 role=assistant（OpenAI 流式约定）
	first, _ := chunks[0]["choices"].([]any)
	firstChoice, _ := first[0].(map[string]any)
	firstDelta, _ := firstChoice["delta"].(map[string]any)
	if firstDelta["role"] != "assistant" {
		t.Errorf("首个分片应带 role=assistant，实际 %#v", firstDelta)
	}

	// 终止分片应给出 finish_reason，并单独给出用量分片
	var finishSeen bool
	var usage map[string]any
	for _, chunk := range chunks {
		choices, _ := chunk["choices"].([]any)
		if len(choices) == 0 {
			if value, ok := chunk["usage"].(map[string]any); ok {
				usage = value
			}
			continue
		}
		choice, _ := choices[0].(map[string]any)
		if reason, ok := choice["finish_reason"].(string); ok && reason != "" {
			finishSeen = true
			if reason != "stop" {
				t.Errorf("finish_reason = %q，期望 stop", reason)
			}
		}
	}
	if !finishSeen {
		t.Error("缺少带 finish_reason 的终止分片")
	}
	if usage == nil {
		t.Fatal("缺少用量分片（计费依赖它，丢了等于这条调用不记账）")
	}
	if usage["prompt_tokens"] != float64(11) || usage["completion_tokens"] != float64(7) {
		t.Errorf("用量未按 OpenAI 口径归一：%#v", usage)
	}
	if details, _ := usage["prompt_tokens_details"].(map[string]any); details["cached_tokens"] != float64(3) {
		t.Errorf("缓存命中未归一：%#v", usage["prompt_tokens_details"])
	}
	if details, _ := usage["completion_tokens_details"].(map[string]any); details["reasoning_tokens"] != float64(2) {
		t.Errorf("推理 token 未归一：%#v", usage["completion_tokens_details"])
	}
}

// TestCodexStream_工具调用参数不重复 覆盖 done 事件与前缀差量逻辑。
//
// 这是最容易写错的地方：上游的 done 带的是【完整参数】，
// 若不做前缀判断就会把已经发过的参数再发一遍，客户端拼出的 JSON 直接坏掉。
func TestCodexStream_工具调用参数不重复(t *testing.T) {
	stream := `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_9","name":"get_weather"}}

data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\"city\":"}

data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"\"北京\"}"}

data: {"type":"response.function_call_arguments.done","output_index":0,"arguments":"{\"city\":\"北京\"}"}

data: {"type":"response.completed","response":{"id":"resp_2","status":"completed"}}

`
	chunks := convertCodexStream(t, stream)

	var arguments strings.Builder
	var nameSeen bool
	for _, chunk := range chunks {
		choices, _ := chunk["choices"].([]any)
		if len(choices) == 0 {
			continue
		}
		choice, _ := choices[0].(map[string]any)
		delta, _ := choice["delta"].(map[string]any)
		calls, _ := delta["tool_calls"].([]any)
		for _, item := range calls {
			call, _ := item.(map[string]any)
			function, _ := call["function"].(map[string]any)
			if name, _ := function["name"].(string); name != "" {
				nameSeen = true
				if name != "get_weather" {
					t.Errorf("工具名 = %q，期望 get_weather", name)
				}
			}
			if fragment, _ := function["arguments"].(string); fragment != "" {
				arguments.WriteString(fragment)
			}
		}
	}

	if !nameSeen {
		t.Error("缺少携带工具名的首个分片")
	}
	if got := arguments.String(); got != `{"city":"北京"}` {
		t.Errorf("工具参数拼接 = %q，期望 %q（重复下发或漏发都会在这里暴露）", got, `{"city":"北京"}`)
	}
}

// TestAggregateCodexStream_非流式聚合 覆盖"上游只流式、下游要非流式"这条路。
func TestAggregateCodexStream_非流式聚合(t *testing.T) {
	raw := aggregateCodexStream([]byte(codexTestStream))

	var response struct {
		Object  string `json:"object"`
		ID      string `json:"id"`
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Role             string `json:"role"`
				Content          string `json:"content"`
				ReasoningContent string `json:"reasoning_content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatalf("聚合结果不是合法 JSON: %v（原文 %s）", err, raw)
	}

	if response.Object != "chat.completion" {
		t.Errorf("object = %q，期望 chat.completion（非流式响应的标识）", response.Object)
	}
	if response.ID != "resp_1" || response.Model != "gpt-5.4" {
		t.Errorf("id/model 未回填：%q / %q", response.ID, response.Model)
	}
	if len(response.Choices) != 1 {
		t.Fatalf("choices 应为 1 项，实际 %d", len(response.Choices))
	}
	choice := response.Choices[0]
	if choice.Message.Content != "你好，世界" {
		t.Errorf("聚合正文 = %q，期望 你好，世界", choice.Message.Content)
	}
	if choice.Message.ReasoningContent != "先想一下" {
		t.Errorf("聚合推理内容 = %q，期望 先想一下", choice.Message.ReasoningContent)
	}
	if choice.FinishReason != "stop" {
		t.Errorf("finish_reason = %q，期望 stop", choice.FinishReason)
	}
	if response.Usage.PromptTokens != 11 || response.Usage.CompletionTokens != 7 || response.Usage.TotalTokens != 18 {
		t.Errorf("聚合用量不符：%#v", response.Usage)
	}
}

// TestCodexFinishReason_长度截断 覆盖未完成状态的映射。
func TestCodexFinishReason_长度截断(t *testing.T) {
	event := &codexStreamEvent{}
	event.Response = &struct {
		ID     string `json:"id"`
		Model  string `json:"model"`
		Status string `json:"status"`
		Usage  *struct {
			InputTokens        int `json:"input_tokens"`
			OutputTokens       int `json:"output_tokens"`
			TotalTokens        int `json:"total_tokens"`
			PromptTokens       int `json:"prompt_tokens"`
			CompletionTokens   int `json:"completion_tokens"`
			InputTokensDetails *struct {
				CachedTokens int `json:"cached_tokens"`
			} `json:"input_tokens_details"`
			OutputTokensDetails *struct {
				ReasoningTokens int `json:"reasoning_tokens"`
			} `json:"output_tokens_details"`
		} `json:"usage"`
		IncompleteDetails *struct {
			Reason string `json:"reason"`
		} `json:"incomplete_details"`
	}{Status: "incomplete"}
	event.Response.IncompleteDetails = &struct {
		Reason string `json:"reason"`
	}{Reason: "max_output_tokens"}

	if got := codexFinishReason(event, false); got != "length" {
		t.Errorf("finish_reason = %q，期望 length", got)
	}
}

// TestCodexErrorBody_错误体改写 覆盖错误方向的结构映射。
func TestCodexErrorBody_错误体改写(t *testing.T) {
	cases := []struct {
		name     string
		raw      string
		wantText string
	}{
		{name: "error 对象", raw: `{"error":{"message":"Store must be set to false","type":"invalid_request_error"}}`, wantText: "Store must be set to false"},
		{name: "detail 字符串", raw: `{"detail":"Unauthorized"}`, wantText: "Unauthorized"},
		{name: "纯文本", raw: `upstream exploded`, wantText: "upstream exploded"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := codexErrorBody([]byte(tc.raw), 400)
			var parsed struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(body, &parsed); err != nil {
				t.Fatalf("改写结果不是合法 JSON: %v", err)
			}
			if !strings.Contains(parsed.Error.Message, tc.wantText) {
				t.Errorf("message = %q，期望包含 %q", parsed.Error.Message, tc.wantText)
			}
		})
	}
}

// TestCodexAccountIDFromToken_从JWT取账号标识 覆盖"导入时没带 account_id"的兜底。
func TestCodexAccountIDFromToken_从JWT取账号标识(t *testing.T) {
	payload := `{"https://api.openai.com/auth":{"chatgpt_account_id":"acc_123","chatgpt_plan_type":"plus"}}`
	token := "header." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".signature"

	if got := codexAccountIDFromToken(token); got != "acc_123" {
		t.Errorf("codexAccountIDFromToken = %q，期望 acc_123", got)
	}
	accountID, planType, ok := DecodeCodexTokenClaims(token)
	if !ok || accountID != "acc_123" || planType != "plus" {
		t.Errorf("DecodeCodexTokenClaims = (%q,%q,%v)，期望 (acc_123,plus,true)", accountID, planType, ok)
	}

	// 非 JWT 形态一律返回空，由上层给出统一的"缺少账号标识"提示
	if got := codexAccountIDFromToken("not-a-jwt"); got != "" {
		t.Errorf("非 JWT 应返回空串，实际 %q", got)
	}
}

// TestApplyCredentialHeaders_缺少账号标识时报错 验证"不静默不带凭据"这条底线。
func TestApplyCredentialHeaders_缺少账号标识时报错(t *testing.T) {
	spec := mustType(t, "openai_codex_subscription")

	err := applyCredentialHeaders(spec, CredentialMeta{}, "not-a-jwt", map[string][]string{})
	if err == nil {
		t.Fatal("缺少账号标识时应报错（否则会以 401/404 的形式在上游暴露）")
	}
	if !strings.Contains(err.Error(), "chatgpt_account_id") {
		t.Errorf("错误信息应指明缺少的是账号标识，实际 %v", err)
	}
}
