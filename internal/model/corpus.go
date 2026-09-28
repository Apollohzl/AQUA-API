// 本文件定义「语料共建计划」的领域模型与仓储接口。
//
// 意图（Why）：
//
//	自研模型需要真实对话语料。落地方式是：把**指定模型**的调用在转发时原文留存
//	（用户请求体 + 上游返回正文），供站长离线导出、脱敏后作为训练语料。
//
//	三件事刻意拆成三个实体，因为它们的变化频率与责任人完全不同：
//	  CorpusModel —— "采哪些模型"：运营随时会增删，属于配置；
//	  CorpusSample —— "采到的原文"：只增不改，属于数据；
//	  CorpusGrant —— "谁免计费"：极少数特批账户，属于权益。
//
//	采集与计费**彻底解耦**：免费分组照采、收费专线照采，收费的照旧扣钱；
//	只有福利账户（CorpusGrant）在指定模型上跳过计费。
//
//	合规边界（写在这里，避免实现时被"顺手放宽"）：
//	  · 只留请求体与返回正文，**不留任何请求头**（因此不含 Authorization / 令牌明文）；
//	  · **站内不做脱敏**，脱敏与匿名化由站长离线完成；
//	  · 单次采集有上限，超限截断并标注（见 store 层的实现）。
//
// 流转（Flow）：
//
//	corpus_models → corpus.Guard（内存快照）→ relay 判定"这次要不要采"
//	relay 采集    → CorpusRepository.CreateCorpusSample（一次成功调用一行）
//	corpus_grants → corpus.Guard（内存快照）→ 鉴权/计费跳过扣费
//	后台导出      → IterateCorpusSamples → JSONL
//
// 扩展（Extend）：
//
//	要支持"用户退出采集"：新增一张 optouts 表 + Guard 里加一个集合，
//	本文件的实体与接口不需要改动。
package model

import (
	"context"
	"errors"
	"strings"
	"time"
)

// 语料共建计划相关领域错误。
var (
	// ErrCorpusModelRequired 表示清单项缺少模型名。
	ErrCorpusModelRequired = errors.New("model: 语料模型名不能为空")
	// ErrCorpusModelTooLong 表示模型名过长（超过 200 字符，正常模型名远小于此）。
	ErrCorpusModelTooLong = errors.New("model: 语料模型名过长")
	// ErrCorpusSampleExists 表示该 request_id 的样本已存在（采集重试时的幂等信号）。
	ErrCorpusSampleExists = errors.New("model: 该请求的语料样本已存在")
	// ErrCorpusSampleNotFound 表示样本不存在。
	ErrCorpusSampleNotFound = errors.New("model: 语料样本不存在")
)

// CorpusGrantStatus 表示一条福利资格的状态。
type CorpusGrantStatus int

const (
	// CorpusGrantActive 生效中。
	CorpusGrantActive CorpusGrantStatus = 1
	// CorpusGrantRevoked 已撤销（保留行以便追溯"曾经授过什么"）。
	CorpusGrantRevoked CorpusGrantStatus = 2
)

// CorpusModel 是语料采集清单里的一个模型。
type CorpusModel struct {
	ID uint64
	// Model 是**对外模型名**（用户实际调用的名字）。
	//
	// 用对外名而不是上游名：清单是按"用户看得见、点得着的模型"挑的，
	// 且同一对外名在不同渠道可能映射到不同上游名。
	Model     string
	Enabled   bool
	Remark    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Normalize 归一化模型名（去空白）。空名视为非法。
func (m *CorpusModel) Normalize() {
	m.Model = strings.TrimSpace(m.Model)
	m.Remark = strings.TrimSpace(m.Remark)
}

// Validate 校验清单项的基本合法性。
func (m CorpusModel) Validate() error {
	if m.Model == "" {
		return ErrCorpusModelRequired
	}
	if len(m.Model) > 200 {
		return ErrCorpusModelTooLong
	}
	return nil
}

// CorpusSample 是一条语料样本（一次成功上游调用的原文）。
//
// 只增不改：它是训练语料的原始素材，任何"原地改写"都会破坏可追溯性。
type CorpusSample struct {
	ID uint64
	// RequestID 与 usage_logs.request_id 对应，用于把"花了多少"与"说了什么"对上。
	RequestID     string
	UserID        uint64
	TokenID       uint64
	Model         string
	UpstreamModel string
	ChannelID     uint64
	ChannelKeyID  uint64
	IsStream      bool
	StatusCode    int
	// RequestBody / ResponseBody 是**原文**：站内绝不改写（脱敏离线做）。
	RequestBody   string
	ResponseBody  string
	RequestBytes  int64
	ResponseBytes int64
	// Truncated 表示超过单次上限被截断；Incomplete 表示客户端中途断开只采到一部分。
	Truncated  bool
	Incomplete bool
	CreatedAt  time.Time
}

// CorpusSampleQuery 是样本列表 / 导出的筛选条件。
type CorpusSampleQuery struct {
	Model  string
	UserID uint64
	From   time.Time
	To     time.Time
	Limit  int
	Offset int
}

// CorpusStat 是语料库的规模统计（供后台看"攒了多少、会不会撑爆磁盘"）。
type CorpusStat struct {
	Samples       int64
	Users         int64
	RequestBytes  int64
	ResponseBytes int64
	EarliestAt    time.Time
	LatestAt      time.Time
}

// CorpusGrant 是一条特殊福利账户资格（按"用户 × 模型"授予）。
type CorpusGrant struct {
	ID uint64
	// UserID 是享受福利的用户。
	UserID uint64
	// Model 是对外模型名：只免这一个模型，其他模型照常计费。
	Model string
	// FreeAccess 为真时该用户调用该模型不计费（不扣用户额度、也不扣令牌额度）。
	FreeAccess bool
	Status     CorpusGrantStatus
	Remark     string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// IsActive 判断该资格是否生效。
func (g *CorpusGrant) IsActive() bool {
	return g != nil && g.Status == CorpusGrantActive
}

// CorpusRepository 定义语料共建计划三张表的持久化操作。
//
// 设计约定：
//   - 采集路径只依赖 CreateCorpusSample，其余都是后台/导出用；
//   - 列表查询**不返回正文全文**（只回前几百字节供预览），避免"看一眼列表"
//     就把几 MB 正文读进内存；要看全文走 GetCorpusSample（接口层会写审计日志）。
type CorpusRepository interface {
	// ListCorpusModels 返回全部清单项（含已停用的）。
	ListCorpusModels(ctx context.Context) ([]*CorpusModel, error)

	// EnabledCorpusModels 返回启用中的模型名集合（供 Guard 加载快照）。
	EnabledCorpusModels(ctx context.Context) ([]string, error)

	// UpsertCorpusModel 新增或更新一个清单项（按模型名匹配）。
	UpsertCorpusModel(ctx context.Context, item *CorpusModel) error

	// DeleteCorpusModel 从清单中移除一个模型。
	DeleteCorpusModel(ctx context.Context, model string) error

	// CreateCorpusSample 写入一条语料样本。
	//
	// request_id 已存在时返回 ErrCorpusSampleExists（幂等：重试不会写两条）。
	CreateCorpusSample(ctx context.Context, sample *CorpusSample) error

	// ListCorpusSamples 分页查询样本（正文只回预览片段），返回列表与总数。
	ListCorpusSamples(ctx context.Context, q CorpusSampleQuery) ([]*CorpusSample, int, error)

	// GetCorpusSample 取单条样本（含正文全文），不存在时返回 ErrCorpusSampleNotFound。
	GetCorpusSample(ctx context.Context, id uint64) (*CorpusSample, error)

	// IterateCorpusSamples 按游标遍历样本（含正文全文），供导出用。
	//
	// 为什么是回调而不是返回切片：导出可能涉及几十万条、每条几十 KB，
	// 一次性读进内存会把进程撑爆；回调式可以让调用方边读边写下载流。
	IterateCorpusSamples(ctx context.Context, q CorpusSampleQuery, fn func(*CorpusSample) error) error

	// StatCorpusSamples 返回语料库规模统计。
	StatCorpusSamples(ctx context.Context) (CorpusStat, error)

	// DeleteCorpusSamplesBefore 删除某时间点之前的样本（导出后按期清理），返回删除条数。
	DeleteCorpusSamplesBefore(ctx context.Context, before time.Time) (int64, error)

	// ListCorpusGrants 返回全部福利资格（含已撤销）。
	ListCorpusGrants(ctx context.Context) ([]*CorpusGrant, error)

	// ActiveCorpusGrants 返回生效中的福利资格（供 Guard 加载快照）。
	ActiveCorpusGrants(ctx context.Context) ([]*CorpusGrant, error)

	// UpsertCorpusGrant 新增或更新一条福利资格（按"用户 × 模型"匹配）。
	UpsertCorpusGrant(ctx context.Context, grant *CorpusGrant) error

	// DeleteCorpusGrant 撤销一条福利资格。
	DeleteCorpusGrant(ctx context.Context, userID uint64, model string) error
}
