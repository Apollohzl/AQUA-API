// 本文件定义「全站通知邮件群发」的领域模型与仓储接口。
//
// 意图（Why）：
//
//	向全站用户发一封通知，本质上是一件"不可撤回、且绝不能重复"的操作：
//	  1) 不可撤回 —— 内容发错只能再发一封更正，等于第二次打扰全体用户；
//	  2) 绝不能重复 —— 重复投递既招投诉，也直接推高垃圾邮件评分。
//	因此这里把一次群发建模为【批次 + 逐人明细】两层：
//	  批次记录"这一次发的是什么内容、进行到哪、谁发起的"；
//	  明细记录"每一个收件人现在是什么状态"，它是断点续发与去重的唯一依据。
//
//	两个刻意的取舍：
//	  · 主题与正文在【创建时】快照落库，而不是发送时再渲染：
//	    管理员预览到的内容必须与实际发出去的逐字一致；
//	    若模板在预览之后被改动（代码重新部署），发送时再渲染就会出现
//	    "我看到的不是用户收到的"，这是最难被发现的失误。
//	  · 进度计数（total/sent/failed）只是展示用的冗余，每次推进都由仓储从
//	    明细表重算（见 RefreshProgress）——内存计数器一旦中断就失真，
//	    而"发了多少"直接影响要不要补发，不能靠不住。
//
// 流转（Flow）：
//
//	后台创建 → EmailBroadcast（快照）+ AddRecipients（逐人入队）
//	  → 发送器按 NextPending 取人 → Send → MarkRecipient
//	  → RefreshProgress 重算进度 → 全部处理完置 done
//	进程重启 → ListUnfinished → 从各批次剩余的 pending 继续
//
// 扩展（Extend）：
//
//	新增通知模板：在 mailer 的模板目录里加一条即可，本模型的字段无需改动
//	（template 列只作分类与审计用，不参与渲染）。
//	新增人群筛选（如"仅已充值用户"）：在创建批次时改查询条件，
//	明细表天然能承载任意人群。
package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// 群发相关的领域错误。
var (
	// ErrEmailBroadcastNotFound 表示群发批次不存在。
	ErrEmailBroadcastNotFound = errors.New("model: 群发批次不存在")
)

// BroadcastStatus 是群发批次的状态。
type BroadcastStatus string

const (
	// BroadcastStatusPending 已创建，尚未开始发送。
	BroadcastStatusPending BroadcastStatus = "pending"
	// BroadcastStatusRunning 正在发送。
	BroadcastStatusRunning BroadcastStatus = "running"
	// BroadcastStatusDone 已处理完所有收件人（含失败，失败明细见收件人表）。
	BroadcastStatusDone BroadcastStatus = "done"
	// BroadcastStatusCanceled 被管理员停止；剩余未发的人不会再发。
	BroadcastStatusCanceled BroadcastStatus = "canceled"
)

// IsValid 判断批次状态是否合法。
func (s BroadcastStatus) IsValid() bool {
	switch s {
	case BroadcastStatusPending, BroadcastStatusRunning, BroadcastStatusDone, BroadcastStatusCanceled:
		return true
	default:
		return false
	}
}

// IsActive 表示该批次还没处理完（进程重启后需要继续）。
func (s BroadcastStatus) IsActive() bool {
	return s == BroadcastStatusPending || s == BroadcastStatusRunning
}

// 收件人状态。
const (
	// RecipientStatusPending 待发送。
	RecipientStatusPending = "pending"
	// RecipientStatusSent 已成功投递。
	RecipientStatusSent = "sent"
	// RecipientStatusFailed 投递失败（原因见 Error 字段），不会再重试。
	//
	// 为什么不自动重试：邮件服务商的失败多为"地址不存在/被拒收"，
	// 反复重试无意义且会恶化发信声誉；失败明细可查，需要时由站长人工决定是否补发。
	RecipientStatusFailed = "failed"
)

// EmailBroadcast 表示一次全站邮件群发批次。
type EmailBroadcast struct {
	ID        uint64          // 主键
	Template  string          // 模板键（分类与审计用）
	Subject   string          // 邮件主题（创建时快照）
	BodyHTML  string          // 邮件正文（创建时快照）
	Status    BroadcastStatus // 批次状态
	Total     int             // 收件人总数
	Sent      int             // 成功数
	Failed    int             // 失败数
	CreatedBy uint64          // 发起的管理员用户 id
	CreatedAt time.Time
	UpdatedAt time.Time
	// StartedAt / FinishedAt 零值分别表示"尚未开始"与"尚未结束"。
	StartedAt  time.Time
	FinishedAt time.Time
}

// Validate 校验批次的必要字段。
//
// 为什么要求正文非空：空正文的邮件发出去只会被标记为垃圾邮件，
// 而全站群发一旦发生就无法撤回，宁可在创建时就拦下。
func (b *EmailBroadcast) Validate() error {
	if strings.TrimSpace(b.Subject) == "" {
		return errors.New("邮件主题不能为空")
	}
	if strings.TrimSpace(b.BodyHTML) == "" {
		return errors.New("邮件正文不能为空")
	}
	if b.Status == "" {
		b.Status = BroadcastStatusPending
	}
	if !b.Status.IsValid() {
		return fmt.Errorf("群发状态非法：%q", b.Status)
	}
	return nil
}

// IsFinished 表示批次已不再推进（完成或被停止）。
func (b *EmailBroadcast) IsFinished() bool {
	return b != nil && !b.Status.IsActive()
}

// EmailBroadcastRecipient 表示某个批次里的一个收件人。
type EmailBroadcastRecipient struct {
	ID          uint64 // 主键
	BroadcastID uint64 // 所属批次
	UserID      uint64 // 收件用户 id
	// Email 统一按"裁剪空白 + 转小写"归一化后存储。
	//
	// 转小写的理由：邮箱在实际投递中一律按大小写不敏感处理，
	// 归一化后"同一邮箱只发一次"的去重才能用简单的字符串比较完成
	// （否则 A@x.com 与 a@x.com 会被当成两个人，同一邮箱收两封）。
	Email     string
	Status    string // 见 RecipientStatus* 常量
	Error     string // 失败原因（成功时为空）
	SentAt    time.Time
	CreatedAt time.Time
}

// EmailBroadcastRepository 定义群发批次的持久化操作。
type EmailBroadcastRepository interface {
	// Create 新建批次并回填 ID 与创建时间。
	Create(ctx context.Context, item *EmailBroadcast) error

	// GetByID 按主键查询，不存在时返回 ErrEmailBroadcastNotFound。
	GetByID(ctx context.Context, id uint64) (*EmailBroadcast, error)

	// List 按创建时间倒序返回批次（含总数），供后台历史列表使用。
	List(ctx context.Context, limit, offset int) ([]*EmailBroadcast, int, error)

	// ListUnfinished 返回所有"尚未处理完"的批次（按 id 升序），用于进程重启后继续发送。
	ListUnfinished(ctx context.Context) ([]*EmailBroadcast, error)

	// AddRecipients 批量写入收件人，返回【实际新增】的条数。
	//
	// 语义：同一批次里已存在同一用户时跳过（不覆盖、不报错），
	// 因此重复调用是安全的——这保证"点两次发送"不会导致重复入队。
	AddRecipients(ctx context.Context, broadcastID uint64, items []*EmailBroadcastRecipient) (int, error)

	// NextPending 取该批次里最前面的 N 个待发收件人（按 id 升序，保证顺序稳定）。
	NextPending(ctx context.Context, broadcastID uint64, limit int) ([]*EmailBroadcastRecipient, error)

	// MarkRecipient 更新单个收件人的最终状态（sent / failed）。
	MarkRecipient(ctx context.Context, id uint64, status, errMsg string, at time.Time) error

	// UpdateProgress 落库批次进度。
	//
	// startedAt / finishedAt 为零值时保持原值不变（便于"开始"与"结束"分两次写入）。
	UpdateProgress(ctx context.Context, id uint64, status BroadcastStatus, total, sent, failed int,
		startedAt, finishedAt time.Time) error

	// CountRecipients 统计该批次下指定状态的收件人数；status 为空表示全部。
	CountRecipients(ctx context.Context, broadcastID uint64, status string) (int, error)

	// ListRecipients 分页返回收件人明细（按 id 升序），供"失败明细可查"使用。
	ListRecipients(ctx context.Context, broadcastID uint64, status string, limit, offset int) ([]*EmailBroadcastRecipient, int, error)
}
