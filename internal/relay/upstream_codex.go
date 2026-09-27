// 本文件负责「ChatGPT 订阅账号（Codex）」的出站装配：路径、身份头与账号标识头。
//
// 意图（Why）：
//
//	Codex 订阅账号能用的端点不是公开的 /v1/chat/completions，而是 ChatGPT 内部的
//	/backend-api/codex/responses。它对请求的要求比"OpenAI 兼容"苛刻得多：
//	  - 必须携带账号标识头 chatgpt-account-id，缺了直接拒绝；
//	  - 必须携带成套的客户端身份（originator / User-Agent / version 三者互相配套），
//	    上游会校验 originator 与 UA 首段是否一致，错配一律 404；
//	  - 请求体必须是 Responses 协议，且强制 store=false、stream=true。
//	这套差异放在这里，转发主链路与其它上游完全不受影响。
//
// 流转（Flow）：
//
//	prepareChannelUpstream
//	  ├─ encodeUpstreamRequestBody → encodeCodexRequest（请求体转 Responses，见 codex_responses.go）
//	  └─ buildUpstreamRequest
//	       ├─ upstreamPath         → /responses
//	       └─ applyCredentialHeaders → chached 账号标识与身份头（本文件）
//
// 扩展（Extend）：
//
//	上游收紧身份校验时：只需改 codexOriginator / codexClientVersion 两个常量，
//	UA 由它们拼出，不会出现"改了 UA 忘了改 originator"的错配。
//	要支持 /responses/compact 等子路径时，在 codexSubPaths 里加白名单并复用本文件的头注入。
package relay

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"gitee.com/xiaosu4610/aqua-api/internal/channeltype"
)

// Codex 订阅账号的出站端点（相对渠道 base_url）。
const (
	// codexResponsesPath 是对话端点。
	codexResponsesPath = "/responses"
	// codexModelsPath 是模型清单端点。
	//
	// 注意与 OpenAI 兼容上游的区别：这里没有 /v1 前缀（base_url 已含 /backend-api/codex）。
	codexModelsPath = "/models"
)

// Codex 出站身份三元组。
//
// 三者必须互相配套：上游校验 originator 与 User-Agent 的首段（第一个 '/' 之前）
// 是否一致，错配会返回 404（而不是 401），排查时极易误判为"模型不存在"。
//
// 因此这里刻意由同一组常量派生，而不是各写一遍字面量。
// 版本号是上游的"最低客户端版本"门槛，官方客户端升级后需要同步抬高。
const (
	codexOriginator    = "codex_cli_rs"
	codexClientVersion = "0.146.0"
	// codexUserAgentSuffix 是真实 Codex CLI 在 Linux 上的 UA 其余部分（OS / 终端指纹）。
	codexUserAgentSuffix = " (Ubuntu 22.4.0; x86_64) xterm-256color"
)

// codexUserAgent 是最终出站的 User-Agent（由身份三元组派生，保证与 originator 配套）。
var codexUserAgent = codexOriginator + "/" + codexClientVersion + codexUserAgentSuffix

// chatgptAccountIDHeader 是订阅账号的账号标识头名。
const chatgptAccountIDHeader = "chatgpt-account-id"

// CredentialMeta 是"随凭据而来的账号级元数据"。
//
// 为什么单独建类型而不是继续加函数参数：本结构会随协议增加字段
// （未来可能还要 device_id / fedramp 等），逐个加参数会让所有调用点都要改。
type CredentialMeta struct {
	// AccountID 是上游账号标识（Codex 的 chatgpt_account_id）。
	AccountID string
	// PlanType 是套餐标识，仅用于日志与展示，不参与出站。
	PlanType string
}

// isEmpty 判断元数据是否为空（两个字段都为空即视为空）。
func (m CredentialMeta) isEmpty() bool {
	return strings.TrimSpace(m.AccountID) == "" && strings.TrimSpace(m.PlanType) == ""
}

// applyCredentialHeaders 按协议注入"由凭据决定"的请求头。
//
// 与 applyUpstreamAuth 的分工：后者注入的是【凭据本身】（密钥/令牌），
// 本函数注入的是【凭据附带的身份信息】。两者都不出现在日志里。
//
// 目前只有 Codex 需要它。返回错误而不是"静默不带"：缺少账号标识时上游必然拒绝，
// 提前给出可读的原因，比让站长对着上游的 401/404 猜要省事得多。
func applyCredentialHeaders(spec channeltype.Type, meta CredentialMeta, apiKey string, header http.Header) error {
	if spec.Protocol != channeltype.ProtocolCodex {
		return nil
	}
	if header == nil {
		return nil
	}

	accountID := strings.TrimSpace(meta.AccountID)
	if accountID == "" {
		// 兜底：账号标识其实就藏在 access_token 的 JWT 声明里。
		// 从令牌里现取可以覆盖"导入时没带 account_id"与"历史数据未采集"两种情况，
		// 让站长无需为了一个字段重新导入整批账号。
		accountID = codexAccountIDFromToken(apiKey)
	}
	if accountID == "" {
		return fmt.Errorf(
			"relay: 订阅账号缺少账号标识（chatgpt_account_id）：" +
				"请重新导入该账号（需包含 tokens.account_id 或可解析的 access_token）")
	}
	header.Set(chatgptAccountIDHeader, accountID)

	// 身份三元组：整体覆盖客户端透传值。
	//
	// 为什么必须覆盖而不是"缺失才填"：上游按客户端身份分优先级降载，
	// 带着陈旧或第三方身份出站会被降载（表现为 HTTP 200 + 流内 server_is_overloaded），
	// 那种失败看起来像"上游抖动"，实际上是身份问题——统一出口身份才能消除它。
	header.Set("originator", codexOriginator)
	header.Set("version", codexClientVersion)
	header.Set("User-Agent", codexUserAgent)
	// 上游一律以 SSE 返回（请求体里 stream 被强制为 true）：
	// 若这里还带客户端的 application/json，协商结果会自相矛盾。
	header.Set("Accept", "text/event-stream")
	return nil
}

// codexJWTClaims 是 access_token / id_token 里我们需要的那部分 JWT 声明。
//
// OpenAI 把账号信息放在一个以 URL 为键的命名空间下（非标准 claim），
// 因此这里用带命名空间的键名解析，而不是平铺到顶层。
type codexJWTClaims struct {
	OpenAIAuth *struct {
		ChatGPTAccountID string `json:"chatgpt_account_id"`
		ChatGPTPlanType  string `json:"chatgpt_plan_type"`
		OrganizationID   string `json:"organization_id"`
	} `json:"https://api.openai.com/auth"`
	Exp int64 `json:"exp"`
}

// codexAccountIDFromToken 尽力从 JWT 形式的令牌里取出账号标识。
//
// 为什么不校验签名：这是"读自己刚拿到的令牌"的自用解析，不是授权决策——
// 令牌来自上游的令牌端点，签名校验对我们没有新增安全价值，却会把
// 每次请求都变成一次 RSA 验签。真正的授权决策仍在上游那一侧。
//
// 解析失败一律返回空串（而非报错）：调用方据此给出"缺少账号标识"的统一提示，
// 不必区分"令牌格式不对"与"令牌里没有该字段"这两种用户无法处理的差异。
func codexAccountIDFromToken(token string) string {
	claims, ok := decodeCodexJWT(token)
	if !ok || claims.OpenAIAuth == nil {
		return ""
	}
	if id := strings.TrimSpace(claims.OpenAIAuth.ChatGPTAccountID); id != "" {
		return id
	}
	// 少数令牌只在 organization 字段里带标识，作为次选。
	return strings.TrimSpace(claims.OpenAIAuth.OrganizationID)
}

// DecodeCodexTokenClaims 解析 Codex 令牌（access_token / id_token）的声明。
//
// 导出给上层使用：导入账号时要从令牌里补齐账号标识与套餐，避免让使用者手填。
// 返回的第二个值表示解析是否成功。
func DecodeCodexTokenClaims(token string) (accountID, planType string, ok bool) {
	claims, parsed := decodeCodexJWT(token)
	if !parsed {
		return "", "", false
	}
	if claims.OpenAIAuth != nil {
		accountID = strings.TrimSpace(claims.OpenAIAuth.ChatGPTAccountID)
		if accountID == "" {
			accountID = strings.TrimSpace(claims.OpenAIAuth.OrganizationID)
		}
		planType = strings.TrimSpace(claims.OpenAIAuth.ChatGPTPlanType)
	}
	return accountID, planType, true
}

// decodeCodexJWT 解码 JWT 的 payload 段（不校验签名与过期）。
func decodeCodexJWT(token string) (codexJWTClaims, bool) {
	trimmed := strings.TrimSpace(token)
	parts := strings.Split(trimmed, ".")
	if len(parts) != 3 {
		return codexJWTClaims{}, false
	}
	payload := parts[1]
	// JWT 用无填充的 base64url；标准库要求补齐 '=' 才能解码。
	switch len(payload) % 4 {
	case 2:
		payload += "=="
	case 3:
		payload += "="
	}
	decoded, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		return codexJWTClaims{}, false
	}
	var claims codexJWTClaims
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return codexJWTClaims{}, false
	}
	return claims, true
}

// codexModelListPath 返回 Codex 的模型清单路径。
//
// 单独一个函数而不是直接写进 models.go：路径随协议而定，
// 让"哪个协议用哪个路径"这件事集中在本文件里可见，而不是散落在取模型的逻辑中。
func codexModelListPath(spec channeltype.Type) string {
	if spec.Protocol == channeltype.ProtocolCodex {
		return codexModelsPath
	}
	return modelsPath
}
