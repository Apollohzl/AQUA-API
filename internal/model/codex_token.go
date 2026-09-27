// 本文件负责从「Codex 订阅账号的令牌」里解析出账号标识与套餐。
//
// 意图（Why）：
//
//	ChatGPT 订阅账号的请求必须携带 chatgpt-account-id 头，缺了上游直接拒绝。
//	这个值不在账号表单里，而是藏在令牌（access_token / id_token）的 JWT 声明中。
//	把它解析出来可以让导入者只需粘贴令牌本身，不必再手工查找账号 ID；
//	同时也覆盖"历史数据没采集到该字段"的情况——转发时现取即可。
//
//	为什么放在 model 层而不是 relay：导入解析（model.ParseCredentialList）与
//	出站装配（relay）都要用它，而 relay 依赖 model，反方向会形成循环依赖。
//
// 流转（Flow）：
//
//	导入：ParseCredentialList → DecodeCodexTokenClaims → 写入 CredentialInput.AccountID
//	转发：applyCredentialHeaders → DecodeCodexTokenClaims（仅当库里没有 account_id）
//
// 扩展（Extend）：
//
//	上游把账号信息挪到别的 claim 时，只需改 codexJWTClaims 的字段与命名空间常量，
//	调用方无需改动。
package model

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

// codexAuthClaimNamespace 是 OpenAI 在 JWT 里存放账号信息的命名空间键。
//
// 它不是标准 claim，而是以 URL 为键的私有扩展，因此必须按字面量匹配。
const codexAuthClaimNamespace = "https://api.openai.com/auth"

// codexJWTClaims 是 Codex 令牌里我们用到的声明。
type codexJWTClaims struct {
	OpenAIAuth *struct {
		ChatGPTAccountID string `json:"chatgpt_account_id"`
		ChatGPTPlanType  string `json:"chatgpt_plan_type"`
		OrganizationID   string `json:"organization_id"`
	} `json:"https://api.openai.com/auth"`
	// Exp 是过期时间（Unix 秒）；0 表示未提供。
	Exp int64 `json:"exp"`
}

// CodexOAuthProviderName 是 Codex 订阅账号内置的 OAuth 提供方名称。
//
// 放在 model 层是因为导入与转发两侧都要引用它：导入时用它给凭据打上 provider，
// 转发刷新时用它查配置。写死一个常量可以避免"导入时填了别的名字、
// 刷新时查不到"这类只能靠人工比对才能发现的错误。
const CodexOAuthProviderName = "openai_codex"

// CodexOAuthProviderPreset 返回 Codex 订阅账号的内置 OAuth 提供方配置。
//
// 为什么要有内置预设：刷新令牌需要 token_url / client_id / scope 三个值，
// 而这些是 OpenAI 客户端的公开参数，站长根本无从得知（也不该要求他去查）。
// 由程序内置可以让导入体验变成"粘贴 auth.json 即可用"。
//
// 注意这里【没有】client_secret：Codex CLI 使用的是公开客户端（PKCE），
// 刷新时不需要密钥，多填一个空值反而会让上游校验失败。
func CodexOAuthProviderPreset() *OAuthProvider {
	return &OAuthProvider{
		Name:     CodexOAuthProviderName,
		TokenURL: "https://auth.openai.com/oauth/token",
		ClientID: "app_EMoamEEZ73f0CkXaXp7hrann",
		// 刷新时上游要求回传的作用域（不含 offline_access，与官方客户端一致）。
		Scope:   "openid profile email",
		Remark:  "ChatGPT/Codex 订阅账号的内置刷新配置（导入订阅账号时自动创建）",
		Enabled: true,
	}
}

// DecodeCodexTokenClaims 解析 Codex 令牌（access_token 或 id_token）的声明。
//
// 返回值：账号标识、套餐标识、解析是否成功。
// 账号标识优先取 chatgpt_account_id，缺失时回退 organization_id
// （少数令牌只带组织标识，仍可用于出站头的兜底）。
//
// 刻意不校验 JWT 签名：这是"读自己刚拿到的令牌"的自用解析，不是授权决策——
// 令牌来自上游的令牌端点，验签对我们没有新增价值，却会让每次请求多一次非对称运算。
// 真正的授权仍由上游判定。
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

// CodexTokenExpiry 返回令牌声明的过期时间（Unix 秒）；0 表示未提供。
//
// 用途：导入时若没带 expires_at，可以从令牌里补上，
// 让"令牌已过期"这件事在第一次调用前就可见（而不是等到 401 才发现）。
func CodexTokenExpiry(token string) int64 {
	claims, ok := decodeCodexJWT(token)
	if !ok {
		return 0
	}
	return claims.Exp
}

// decodeCodexJWT 解码 JWT 的 payload 段（不校验签名与有效期）。
func decodeCodexJWT(token string) (codexJWTClaims, bool) {
	parts := strings.Split(strings.TrimSpace(token), ".")
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
