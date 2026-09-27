// 本文件定义「调用日志」领域模型，它是用量统计与后续计费的数据基础。
//
// 意图（Why）：
//
//	网关必须能回答运营中最常见的几个问题：
//	  「今天用了多少」「哪个模型最热」「谁用得最多」「失败率多高」。
//	这些问题的答案只能来自逐条记录的调用日志，因此每条转发（无论成功失败）
//	都应落一条日志，且记录足够完整（用户、令牌、渠道、模型、耗时、状态码）。
//
// 流转（Flow）：
//
//	relay 转发完成 → 组装 UsageLog → UsageLogRepository.Create
//	  └─ 后台仪表盘：Summary / DailySeries / TopModels 聚合查询
//	  └─ 用户门户：按 UserID 过滤的同一组聚合查询
//
// 扩展（Extend）：
//
//	接入计费后：新增 quota 的精算逻辑（当前由调用方按倍率估算后写入），
//	  并考虑把日志库独立出来（日志写入量远大于业务表）。
//	新增统计维度（如按渠道、按令牌）：在 UsageLogQuery 加条件并在仓储层实现聚合。
package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// 领域错误。
var (
	// ErrUsageLogNotFound 表示未找到指定日志（通常无需对外暴露）。
	ErrUsageLogNotFound = errors.New("model: 调用日志不存在")
)

// LogStatus 是日志查询中使用的状态语义值。
//
// 为什么不直接用 HTTP 状态码：客户端筛选时想表达的是「成功/失败」这类语义，
// 而不是具体是 400 还是 500。仓储层负责把语义翻译为 SQL 条件。
const (
	// LogStatusSuccess 表示按「成功」筛选（2xx）。
	LogStatusSuccess = "success"
	// LogStatusError 表示按「失败」筛选（非 2xx，或存在错误信息）。
	LogStatusError = "error"
)

// UsageLog 表示一次模型接口调用记录。
//
// 字段设计说明：
//   - ChannelID 允许为 0（表示尚未选定渠道就失败，如无可用渠道）；
//   - Error 只记录"面向运维的简短原因"，禁止写入上游返回的原始报错全文
//     （可能包含上游地址或密钥片段）；
//   - RequestID 用于与客户端日志对账，排查"客户端说失败、服务端说成功"这类问题。
type UsageLog struct {
	ID        uint64 // 主键
	UserID    uint64 // 调用者用户 ID（0 表示未认证或系统调用）
	TokenID   uint64 // 使用的访问令牌 ID
	ChannelID uint64 // 命中的上游渠道 ID
	// ChannelKeyID 是本次实际使用的【池内密钥记录 ID】（迁移 0032）。
	//
	// 0 表示不适用或未采集：渠道使用单密钥模式、请求在选渠道前就失败、
	// 或本条是迁移之前写入的历史日志。
	// 记下它的意义：可以回答"这把密钥被用了多少"，进而结合上游进价
	// 算出"余额还剩多少"——否则余额永远只是一个静态的人工快照。
	ChannelKeyID     uint64
	Model            string // 请求的模型名（对外模型名）
	UpstreamModel    string // 实际发给上游的模型名（经渠道映射改写）；空串表示与 Model 相同
	PromptTokens     int    // 输入 token 数
	CompletionTokens int    // 输出 token 数
	TotalTokens      int    // 总 token 数
	// CachedTokens 是输入中命中上游缓存的 token 数（迁移 0026）。
	//
	// 为什么单独记：这部分通常按更低价计费，是核对账单与评估
	// "提示词前缀复用"效果的唯一依据；0 表示上游未返回该字段（不是"没有命中"）。
	CachedTokens int
	// ReasoningTokens 是输出中属于"推理过程"的 token 数（迁移 0026）。
	//
	// 它计入输出但用户看不到，出账时最容易引起争议，必须单独可查。
	ReasoningTokens int
	// FirstTokenMS 是首个响应字节的到达时间（TTFB，毫秒；0 = 未采集/非流式）。
	//
	// 只对非流式请求没有意义：那种情况响应一次性返回，不存在"首 token 延迟"。
	FirstTokenMS int
	// TokensPerSecond 是输出速率（tokens/s；0 表示无法计算）。
	//
	// 计算口径：CompletionTokens / (总耗时 − 首 token 延迟)。
	// 用总耗时会随回答变长而低估生成速度，因此必须扣除排队与首包时间。
	TokensPerSecond float64
	Quota           int64     // 本次消耗额度（内部单位）
	LatencyMS       int       // 总耗时（毫秒）
	IsStream        bool      // 是否流式请求
	StatusCode      int       // 回写给客户端的状态码
	Error           string    // 失败原因（已脱敏、简短）
	RequestID       string    // 请求标识
	CreatedAt       time.Time // 记录时间
}

// Validate 校验日志的必要字段。
//
// 说明：日志的校验刻意宽松——它是可观测性数据，宁可记录一条字段不全的日志，
// 也不要因为校验失败而丢失"某次调用发生过"这一事实。
func (l *UsageLog) Validate() error {
	if l.StatusCode < 0 || l.StatusCode > 599 {
		return fmt.Errorf("状态码非法: %d", l.StatusCode)
	}
	if l.LatencyMS < 0 {
		return fmt.Errorf("耗时不能为负数: %d", l.LatencyMS)
	}
	if l.PromptTokens < 0 || l.CompletionTokens < 0 {
		return errors.New("token 数不能为负数")
	}
	return nil
}

// IsSuccess 判断本次调用是否成功（以回写给客户端的状态码为准）。
func (l *UsageLog) IsSuccess() bool {
	return l.StatusCode >= 200 && l.StatusCode < 300
}

// UsageLogQuery 描述调用日志的查询与聚合条件。
//
// 同一结构体同时用于列表查询与聚合统计，避免两套条件出现语义漂移
// （例如"列表按用户过滤、统计忘了过滤"这类难以发现的偏差）。
type UsageLogQuery struct {
	UserID    *uint64    // 按用户过滤；nil 表示不过滤
	TokenID   *uint64    // 按令牌过滤
	ChannelID *uint64    // 按渠道过滤
	Model     string     // 按模型精确匹配；空表示不过滤
	Status    string     // LogStatusSuccess / LogStatusError / 空=不过滤
	Since     *time.Time // 起始时间（含）；nil 表示不限
	Until     *time.Time // 结束时间（含）；nil 表示不限
	Limit     int        // 条数上限（仅列表查询使用）
	Offset    int        // 偏移量（仅列表查询使用）
}

// UsageSummary 是某条件下的用量汇总。
type UsageSummary struct {
	Requests int64 // 请求总数
	Success  int64 // 成功数（2xx）
	Tokens   int64 // token 总量
	Quota    int64 // 额度总量
	// PromptTokens / CompletionTokens 把总量拆成"输入"与"输出"。
	//
	// 为什么必须拆：两者的成本与优化手段完全不同（输入可缓存复用、输出受生成速度限制），
	// 只看 total 无法回答"成本涨在输入还是输出上"。
	PromptTokens     int64
	CompletionTokens int64
	// CachedTokens 是输入中命中上游缓存的 token 总量（评估缓存收益的依据）。
	CachedTokens int64
	// ReasoningTokens 是输出中的推理 token 总量（出账争议的主要来源）。
	ReasoningTokens int64
	// LatencySumMS 是总耗时之和与成功请求数，用于算平均总延迟。
	LatencySumMS int64
	// FirstTokenSumMS / FirstTokenSamples 用于算平均首 token 延迟（TTFB）。
	//
	// 单独统计样本数而不是复用 Requests：非流式请求不产生 TTFB（值为 0），
	// 若把它算进平均会把"平均首 token 延迟"拉低成没有意义的数字。
	FirstTokenSumMS   int64
	FirstTokenSamples int64
	// TPSSum / TPSSamples 用于算平均输出速率。
	//
	// 同样单独计样本：速率只在"有输出 token 且时长可算"时才存在，
	// 用请求总数做分母会得到偏低且不可解释的平均值。
	TPSSum     float64
	TPSSamples int64
}

// SuccessRate 返回成功率（0~1）；无请求时返回 0。
func (s UsageSummary) SuccessRate() float64 {
	if s.Requests <= 0 {
		return 0
	}
	return float64(s.Success) / float64(s.Requests)
}

// CacheHitRate 返回输入缓存命中率（0~1）；输入为 0 时返回 0。
//
// 口径：CachedTokens / PromptTokens。上游把"命中缓存的输入"算在 PromptTokens 内，
// 因此这个比值就是"输入里有多大比例是复用的"。
func (s UsageSummary) CacheHitRate() float64 {
	if s.PromptTokens <= 0 {
		return 0
	}
	return float64(s.CachedTokens) / float64(s.PromptTokens)
}

// AvgLatencyMS 返回平均总耗时（毫秒）；无请求时返回 0。
func (s UsageSummary) AvgLatencyMS() int64 {
	if s.Requests <= 0 {
		return 0
	}
	return s.LatencySumMS / s.Requests
}

// AvgFirstTokenMS 返回平均首 token 延迟（毫秒）；无样本时返回 0。
func (s UsageSummary) AvgFirstTokenMS() int64 {
	if s.FirstTokenSamples <= 0 {
		return 0
	}
	return s.FirstTokenSumMS / s.FirstTokenSamples
}

// AvgTokensPerSecond 返回平均输出速率（tokens/s）；无样本时返回 0。
func (s UsageSummary) AvgTokensPerSecond() float64 {
	if s.TPSSamples <= 0 {
		return 0
	}
	return s.TPSSum / float64(s.TPSSamples)
}

// DailyUsage 是单日用量，用于趋势图。
type DailyUsage struct {
	Date     string // 日期，格式 2006-01-02
	Requests int64  // 请求数
	Tokens   int64  // token 数
	Quota    int64  // 额度
	// CachedTokens 是当日输入中命中上游缓存的 token 数。
	//
	// 放进趋势而不仅仅放汇总：缓存命中率的"趋势"比单点数字更有价值——
	// 它反映提示词前缀复用是否在持续生效，掉下去往往意味着代码改动破坏了前缀。
	CachedTokens int64
}

// ModelUsage 是单个模型的用量，用于排行榜。
type ModelUsage struct {
	Model    string // 模型名
	Requests int64  // 请求数
	Tokens   int64  // token 数
}

// UsageLogRepository 定义调用日志的持久化与聚合操作。
type UsageLogRepository interface {
	// Create 写入一条调用日志。
	Create(ctx context.Context, log *UsageLog) error

	// List 按条件返回日志列表，按时间倒序（最新在前）。
	List(ctx context.Context, q UsageLogQuery) ([]*UsageLog, error)

	// Count 返回符合条件的日志总数，用于分页。
	Count(ctx context.Context, q UsageLogQuery) (int, error)

	// Summary 返回符合条件的用量汇总。
	Summary(ctx context.Context, q UsageLogQuery) (*UsageSummary, error)

	// DailySeries 按天聚合，返回按日期升序的趋势数据。
	//
	// 实现要求：必须补全"没有请求的日期"（补 0），否则前端折线图会出现断点，
	// 让人误以为那些天服务中断了。补零逻辑放在实现层，避免每个调用方各自处理。
	DailySeries(ctx context.Context, q UsageLogQuery) ([]DailyUsage, error)

	// TopModels 返回用量最高的前 N 个模型，按请求数降序。
	TopModels(ctx context.Context, q UsageLogQuery, limit int) ([]ModelUsage, error)

	// SumUsageByChannelKey 按 (密钥, 模型) 汇总某渠道的用量，用于密钥余额核算。
	//
	// 口径（重要）：
	//   - 只统计 status_code < 400 的【成功】请求：失败请求通常不消耗上游额度，
	//     把它们算进成本会让余额看起来比实际掉得更快；
	//   - 只统计 channel_key_id > 0 的行：单密钥模式与历史数据无法归属到具体凭据；
	//   - 统计范围为【全部历史】（余额是累计量，不能只看某个时间窗）。
	SumUsageByChannelKey(ctx context.Context, channelID uint64) ([]*ChannelKeyUsage, error)
}

// ChannelKeyUsage 是一把密钥在某个模型上的用量汇总（密钥余额核算的输入）。
//
// 按 (密钥, 模型) 而不是只按密钥分组，是因为不同模型的进价差别极大，
// 必须逐模型匹配进价后再累加，否则算出的成本会明显失真。
type ChannelKeyUsage struct {
	ChannelKeyID uint64 // 池内密钥记录 ID（> 0）
	ChannelID    uint64 // 所属渠道
	Model        string // 请求的对外模型名
	// UpstreamModel 是实际发给上游的模型名（映射改写后的名字）；空串表示与 Model 相同。
	//
	// 匹配上游进价时必须用它：钱是上游按上游模型名收的。
	UpstreamModel    string
	Requests         int64 // 成功请求数
	PromptTokens     int64 // 输入 token 合计
	CompletionTokens int64 // 输出 token 合计
	CachedTokens     int64 // 其中命中缓存合计
}

// CostModelName 返回用于匹配上游进价的模型名。
//
// 优先用上游模型名（成本由上游按该名字决定），为空时回退对外名——
// 与 usage_logs.upstream_model 的空值语义一致（空 = 映射未改写，两者相同）。
func (u *ChannelKeyUsage) CostModelName() string {
	if u == nil {
		return ""
	}
	if name := strings.TrimSpace(u.UpstreamModel); name != "" {
		return name
	}
	return u.Model
}
