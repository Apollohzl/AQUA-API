// 本文件定义「限时试用额度」的领域模型与仓储接口。
//
// 意图（Why）：
//
//	运营需要发一种**会过期**的额度：给全站用户加一笔试用额，24 小时内有效、
//	到期自动清除。而 users.quota 是一个永久池，额度进去就永不失效，
//	现有体系没有任何"这笔额度会过期"的表达能力。
//
//	因此引入「发放台账」：额度仍然进 users.quota（**刻意不动鉴权/预扣/结算
//	这条热路径**，并发与幂等语义完全沿用既有实现），台账只回答一个问题——
//	"发放之后用户到底花掉了多少、到期该收回多少"。
//
//	回收口径（见 store.trialGrantRepository 的实现与迁移 0040 的注释）：
//	  约定「试用额先花、自有余额后花」，于是
//	    花掉的量 S = max(0, used_quota − used_baseline)
//	    应回收   = max(0, amount − S)，再按用户当前剩余额度封顶。
//
//	记账单位与全站一致（1 元 = payment_exchange_rate 个额度单位），
//	本层不参与"元↔额度"的换算，换算在 handler 层完成。
//
// 流转（Flow）：
//
//	后台 POST /api/admin/trial-grants → GrantAll（写台账 + 加余额）
//	后台定时协程                      → ReclaimExpired（到期扣回未用完的部分）
//	门户 GET /api/user/trial          → ActiveFor（还剩多少、几时过期）
//
// 扩展（Extend）：
//
//	新增"只发给某类用户"的发放规则：改发放 SQL 的 WHERE 条件即可，
//	台账结构与回收逻辑无需变动；要支持"多次叠加发放"，按行回收的写法天然支持。
package model

import (
	"context"
	"errors"
	"strings"
	"time"
)

// ErrTrialBatchExists 表示同一批次已经发放过。
//
// 为什么要有这个闸门：发放是一次性的批量写操作，误点两次就等于给全站用户
// 发了两倍额度（且要等到期才能收回）。用批次标识做唯一闸门，比"人工检查"可靠。
var ErrTrialBatchExists = errors.New("model: 该批次已发放过")

// TrialGrantStatus 表示一条发放记录的生命周期状态。
//
// 取值与数据库 trial_grants.status 一一对应，禁止改动已落库的字面值。
type TrialGrantStatus string

const (
	// TrialGrantPending 在效期内：额度已进用户余额，尚未到期。
	TrialGrantPending TrialGrantStatus = "pending"
	// TrialGrantReclaimed 已回收：到期后未用完的部分已从余额扣回，终态。
	TrialGrantReclaimed TrialGrantStatus = "reclaimed"
)

// TrialGrant 是一次「限时试用额度」的发放记录。
type TrialGrant struct {
	ID uint64 // 主键
	// UserID 是收件用户。
	UserID uint64
	// Batch 是批次标识（同一次发放共用），用于防止重复发放与事后对账。
	Batch string
	// Amount 是本次发放的额度（内部单位）。
	Amount int64
	// UsedBaseline 是发放瞬间 users.used_quota 的快照。
	//
	// 它是回收计算的全部依据：没有它就无法区分"花掉的是试用额"还是
	// "花掉的是用户自己充的钱"，回收时会把自有余额一起扣掉。
	UsedBaseline int64
	// Status 见 TrialGrantStatus。
	Status TrialGrantStatus
	// ExpiresAt 是到期时间；到点后由后台协程回收未用完的部分。
	ExpiresAt time.Time
	// ReclaimedAmount 是实际回收走的额度（0 表示用户已全部用完，属正常结果）。
	ReclaimedAmount int64
	CreatedAt       time.Time
	// ReclaimedAt 为回收时间；零值表示尚未回收。
	ReclaimedAt time.Time
}

// TrialGrantRequest 描述一次「给全站用户发放试用额」的请求。
type TrialGrantRequest struct {
	// Batch 是批次标识，不可为空；同一批次只允许发放一次。
	Batch string
	// Amount 是每位用户获得的额度（内部单位），必须为正。
	Amount int64
	// TTL 是有效时长（自发放时刻起算），必须为正。
	TTL time.Duration
}

// Normalize 清理批次标识两端的空白，便于"带空格输入"与"无空格输入"视为同一批次。
func (r *TrialGrantRequest) Normalize() {
	r.Batch = strings.TrimSpace(r.Batch)
}

// Validate 校验发放请求的合法性。
func (r TrialGrantRequest) Validate() error {
	if strings.TrimSpace(r.Batch) == "" {
		return errors.New("model: 发放批次标识不能为空")
	}
	if len(r.Batch) > 64 {
		return errors.New("model: 发放批次标识过长（上限 64 字符）")
	}
	if r.Amount <= 0 {
		return errors.New("model: 发放额度必须为正")
	}
	if r.TTL <= 0 {
		return errors.New("model: 有效时长必须为正")
	}
	return nil
}

// TrialGrantResult 是一次发放的结果汇总。
type TrialGrantResult struct {
	Batch string
	// Recipients 是实际发放人数（仅统计"启用且额度非不限"的用户）。
	Recipients int64
	// Amount 是每人获得的额度。
	Amount int64
	// ExpiresAt 是本批次的统一到期时间。
	ExpiresAt time.Time
}

// TrialActive 是某用户当前仍有效的试用额汇总（供门户展示）。
//
// 口径：只统计"未到期且未用完"的部分；已到期但尚未被后台回收的记录
// 一律不算（对用户而言它已经失效），避免界面显示一个实际上已经过期的数字。
type TrialActive struct {
	// Remaining 是仍可用的试用额度合计；0 表示当前没有生效中的试用额。
	Remaining int64
	// ExpiresAt 是上述额度的最早到期时间；Remaining 为 0 时为零值。
	ExpiresAt time.Time
}

// IsActive 判断是否存在生效中的试用额。
func (t TrialActive) IsActive() bool {
	return t.Remaining > 0 && !t.ExpiresAt.IsZero()
}

// TrialGrantRepository 定义限时试用额发放台账的持久化操作。
//
// 实现约定（关键，防资损）：
//   - GrantAll 必须对同一批次幂等：重复调用返回 ErrTrialBatchExists 且不产生任何发放；
//   - GrantAll 必须以**单事务**完成"写台账（含 used_quota 快照）+ 加余额"，
//     否则崩在中间会留下"有台账没加钱"或"加了钱没台账"的不一致；
//   - ReclaimExpired 必须以 status 为幂等闸门（先改状态再动余额），
//     多实例并发回收时只有一方生效，不会重复扣款。
type TrialGrantRepository interface {
	// GrantAll 给全站「启用且额度非不限」的用户发放一笔限时试用额。
	//
	// 幂等：同一 Batch 已发放过时返回 ErrTrialBatchExists。
	// 返回的 Recipients 是实际发放人数。
	GrantAll(ctx context.Context, req TrialGrantRequest) (TrialGrantResult, error)

	// ReclaimExpired 回收"已到期且在效期内"的发放记录中未用完的部分，返回处理条数。
	//
	// 已用完（应回收 0）的记录同样会被置为终态并计入返回值——它确实被处理了，
	// 只是没有可回收的余额。这样"处理条数"就能直接反映"清掉了几笔试用额"。
	ReclaimExpired(ctx context.Context, now time.Time) (int, error)

	// ActiveFor 返回某用户当前仍有效的试用额汇总。
	ActiveFor(ctx context.Context, userID uint64, now time.Time) (TrialActive, error)
}
