// 本文件定义「出站邮件（SMTP）配置」领域模型与仓储接口。
//
// 意图（Why）：
//
//	注册邮箱验证码需要向用户发信，而发信要用站长自己的邮件服务商账号。
//	此前这些参数只能通过环境变量注入（改完还要重启服务），
//	对"单站长自部署"这一实际形态来说门槛过高：每个站长的服务商、域名、
//	授权码都不一样，必须能在后台可视化配置并即时生效。
//
//	本文件把 SMTP 参数建模为一条【单例配置】，并明确两件事：
//	  1) 口令在内存中是明文，落库由 store 层用 AQUA_APP_KEY 加密（见 0023 迁移的说明）；
//	  2) 环境变量作为兜底与预设：后台 enabled=1 时以后台配置为准，
//	     否则使用环境变量（便于用密钥管理系统统一注入密钥的部署方式）。
//
// 流转（Flow）：
//
//	后台读取：GET  /api/admin/smtp  → 仓储 Get → 抹掉口令后返回（只回 password_set）
//	后台保存：PUT  /api/admin/smtp  → 校验 → 仓储 Save（加密落库）→ 通知 mailer 热加载
//	启动装配：main → 仓储 Get → 与环境变量比较取优先者 → mailer.New(cfg)
//
// 扩展（Extend）：
//
//	新增 SMTP 参数（如强制 STARTTLS、自定义回信地址）时：
//	在 SMTPSettings 加字段 + 建迁移加列 + 同步 store/smtp_repo.go 的列清单与存取，
//	并在后台表单与 DTO 补对应项（四处同步，勿遗漏）。
package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// SMTP 参数的取值范围。
//
// 端口刻意限制在 1~65535：0 与负数在 net.JoinHostPort 下会产生非法地址，
// 报错信息晦涩；在保存前挡住能给出可读的中文提示。
const (
	smtpMinPort = 1
	smtpMaxPort = 65535
	// smtpMaxFieldLength 是 host/账号/地址等文本字段的长度上限。
	// 取值宽松（253 是域名的理论最大长度），只为拦住"误粘贴整段配置"。
	smtpMaxFieldLength = 253
)

// ErrSMTPNotConfigured 表示系统尚未配置任何可用的 SMTP 通道。
var ErrSMTPNotConfigured = errors.New("model: SMTP 未配置")

// SMTPSettings 是一条 SMTP 通道配置。
//
// 字段与 services 的常见叫法对齐（host/port/username/from/from_name），
// 便于站长对照自己的服务商文档填写。
type SMTPSettings struct {
	// Host 是 SMTP 服务器地址，如 smtpdm.aliyun.com。
	Host string
	// Port 是端口：465 为 SSL 直连（推荐），587 为 STARTTLS，
	// 25 默认明文且云厂商普遍封禁出站，不建议使用。
	Port int
	// Username 是 SMTP 登录账号（阿里云邮件推送为发信地址本身）。
	Username string
	// From 是发件地址，必须与 Username 同域且已在服务商处验证。
	From string
	// FromName 是收件人看到的发件人显示名。
	FromName string
	// Password 是 SMTP 登录口令/授权码【仅内存明文】，落库由仓储加密。
	Password string
	// Enabled 表示是否启用本条配置。
	//
	// 语义说明：本项为 false 时，系统回退到环境变量配置；
	// 环境变量也没有则视为"未配置"，邮箱验证码流程会给出明确指引。
	Enabled bool
	// UpdatedAt 是最后更新时间（零值表示从未保存过）。
	UpdatedAt time.Time
}

// Validate 校验配置的必填项与取值范围。
//
// 只在"启用本配置"时要求必填：站长可能先把参数粘进来再逐个核对，
// 中途保存不该被拦住；但一旦启用，就必须是完整可用的一组参数，
// 否则会出现"看起来配了、发信时却报错"的最差体验。
func (s *SMTPSettings) Validate() error {
	if !s.Enabled {
		return nil
	}
	if strings.TrimSpace(s.Host) == "" {
		return errors.New("SMTP 服务器地址不能为空")
	}
	if len(strings.TrimSpace(s.Host)) > smtpMaxFieldLength {
		return fmt.Errorf("SMTP 服务器地址最多 %d 个字符", smtpMaxFieldLength)
	}
	if s.Port < smtpMinPort || s.Port > smtpMaxPort {
		return fmt.Errorf("SMTP 端口必须在 %d ~ %d 之间（当前 %d）", smtpMinPort, smtpMaxPort, s.Port)
	}
	if strings.TrimSpace(s.Username) == "" {
		return errors.New("SMTP 登录账号不能为空")
	}
	if strings.TrimSpace(s.From) == "" {
		return errors.New("发件地址不能为空")
	}
	// 发件地址形式做最简校验：必须含 @。
	// 刻意不用正则严格校验邮箱：合法的邮件地址远比常见正则宽松，
	// 过严的正则会把可用的地址误判为非法（例如带 + 标签或域名的地址）。
	if !strings.Contains(s.From, "@") {
		return fmt.Errorf("发件地址格式不正确（缺少 @）：%s", s.From)
	}
	if strings.TrimSpace(s.Password) == "" {
		return errors.New("SMTP 登录口令不能为空")
	}
	return nil
}

// Configured 判断这条配置是否"完整可用"（启用且五项必填齐全）。
func (s SMTPSettings) Configured() bool {
	if !s.Enabled {
		return false
	}
	return strings.TrimSpace(s.Host) != "" &&
		strings.TrimSpace(s.Username) != "" &&
		strings.TrimSpace(s.From) != "" &&
		strings.TrimSpace(s.Password) != ""
}

// SMTPRepository 定义 SMTP 配置的持久化操作。
//
// 约定：实现必须保证 Password 落库时被加密、读取时被解密；
// 未保存过任何配置时 Get 返回 (nil, nil)——"没有配置"不是错误。
type SMTPRepository interface {
	// Get 读取 SMTP 配置；从未保存过时返回 (nil, nil)。
	Get(ctx context.Context) (*SMTPSettings, error)

	// Save 保存（单行 upsert）SMTP 配置。
	Save(ctx context.Context, settings *SMTPSettings) error
}
