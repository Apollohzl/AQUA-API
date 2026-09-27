// 本文件定义渠道的「上游错误重试」策略：渠道级总开关 + 模型级覆盖规则。
//
// 意图（Why）：
//
//	重试此前是硬编码的（渠道级 3 次、密钥级 8 次），站长无法按渠道/模型调节。
//	但不同上游的诉求相反：免费额度池希望"多试几把密钥"把可恢复的失败在站内消化掉
//	（下游几乎看不到错误，这是降低下游错误率的主要手段）；而按次计费或强幂等的上游
//	重复请求可能造成重复扣费，希望"一次就够"。本文件把这套判断收敛到一处纯函数，
//	保证"后台配置的值"与"转发时的行为"永远同源。
//
// 流转（Flow）：
//
//	channels.retry_enabled / retry_max_attempts / model_retry_rules
//	  └─ store/channel_repo.go 读写 → model.Channel.RetryPolicyFor(对外模型名)
//	       └─ relay.forwardWithFallback：决定本次请求允许尝试几次、是否换密钥/换渠道
//
// 扩展（Extend）：
//
//	新增层级（如按分组、按令牌）时，在 RetryPolicyFor 里插入新的解析分支，
//	并保持"越具体越优先"的既有次序（精确 → 最长前缀 → 渠道级）。
package model

import (
	"fmt"
	"strings"
)

// 重试次数约束。
//
// 为什么需要上限：重试预算是"延迟换成功率"的交易——次数越多，故障时单个请求
// 占用的时间与上游配额越多。10 次是在"免费池需要多试几把"与"不要让用户等到超时"
// 之间取的折中值（上游拒绝通常很快返回，不会真的把 10 次都跑满）。
const (
	// DefaultRetryMaxAttempts 是渠道未显式配置时使用的渠道级重试次数（与迁移前的硬编码一致）。
	DefaultRetryMaxAttempts = 3
	// MaxRetryMaxAttempts 是允许配置的最大重试次数。
	MaxRetryMaxAttempts = 10
)

// RetryMode 是渠道的重试总开关（落库 channels.retry_enabled，取值 1/2）。
//
// 为什么用显式类型而不是 bool：bool 的零值是 false，而"零值渠道"在本仓库出现得
// 非常频繁（测试构造、局部拼装、后台部分字段更新）。若把 false 当作"关闭重试"，
// 任何忘记赋值的渠道都会静默失去重试能力——这类问题不报错，只在故障时表现为
// "错误率莫名升高"，极难定位。因此这里让零值 = 跟随默认（开启），与迁移前的
// 硬编码行为一致：旧数据与新构造出的渠道都不会因为漏赋值而改变行为。
type RetryMode int

const (
	// RetryModeUnset 表示未显式配置：按"开启"处理（既有行为）。
	RetryModeUnset RetryMode = 0
	// RetryModeOn 表示明确开启站内重试。
	RetryModeOn RetryMode = 1
	// RetryModeOff 表示明确关闭：本次请求对上游只尝试一次，不换密钥也不换渠道。
	RetryModeOff RetryMode = 2
)

// IsValid 判断取值是否可被外部写入（0/1/2 之外一律拒绝）。
func (m RetryMode) IsValid() bool {
	switch m {
	case RetryModeUnset, RetryModeOn, RetryModeOff:
		return true
	default:
		return false
	}
}

// Enabled 返回"是否允许重试"的最终结论（未配置视为允许）。
func (m RetryMode) Enabled() bool { return m != RetryModeOff }

// ModelRetryRule 是一条模型级重试覆盖规则。
//
// 语义：命中该规则的模型不沿用渠道级配置，而是用它自己的 Enabled / MaxAttempts。
// 之所以不提供"继承"取值：数组里没有该模型就等于继承，多一个状态只会让界面更难懂。
type ModelRetryRule struct {
	// Model 是对外模型名，支持尾部通配符 *（如 "gpt-4*"），与计价规则的约定一致。
	Model string `json:"model"`
	// Enabled 表示该模型是否允许站内重试。
	Enabled bool `json:"enabled"`
	// MaxAttempts 是该模型的渠道级重试次数；<=0 表示用默认值。
	MaxAttempts int `json:"max_attempts"`
}

// RetryPolicy 是某模型最终生效的重试策略（模型级覆盖已解析完毕）。
type RetryPolicy struct {
	// Enabled 为 false 时，本次请求对上游只尝试一次。
	Enabled bool
	// MaxAttempts 是渠道级重试次数上限（已归一到 1..MaxRetryMaxAttempts）。
	MaxAttempts int
}

// RetryPolicyFor 解析指定对外模型名最终生效的重试策略。
//
// 解析次序（越具体越优先）：
//  1. 模型级精确规则；
//  2. 模型级最长前缀规则（如 "gpt-4*"）；
//  3. 渠道级（RetryMode + RetryMaxAttempts）。
//
// 参数为渠道的对外模型名（用户请求里写的那个），不是上游模型名：
// 站长的配置视角是"我对外卖的这个模型"，与映射后的上游名无关。
func (c *Channel) RetryPolicyFor(modelName string) RetryPolicy {
	if c == nil {
		return RetryPolicy{Enabled: true, MaxAttempts: DefaultRetryMaxAttempts}
	}
	if rule := c.matchModelRetryRule(modelName); rule != nil {
		return RetryPolicy{
			Enabled:     rule.Enabled,
			MaxAttempts: NormalizeRetryMaxAttempts(rule.MaxAttempts),
		}
	}
	return RetryPolicy{
		Enabled:     c.RetryMode.Enabled(),
		MaxAttempts: NormalizeRetryMaxAttempts(c.RetryMaxAttempts),
	}
}

// matchModelRetryRule 在一组模型级规则里挑出最适用的那条，没有则返回 nil。
//
// 打分沿用计价规则的 PricePattern.Specificity（精确 > 长前缀 > 短前缀 > 全局），
// 复用同一套通配语义可以避免"价格按 gpt-4* 匹配、重试却按别的规则匹配"这类
// 令人困惑的不一致。
func (c *Channel) matchModelRetryRule(modelName string) *ModelRetryRule {
	var (
		best      *ModelRetryRule
		bestScore = -1
	)
	for i := range c.ModelRetryRules {
		rule := &c.ModelRetryRules[i]
		pattern := PricePattern(rule.Model)
		if !pattern.Matches(modelName) {
			continue
		}
		score := pattern.Specificity()
		if best == nil || score > bestScore {
			best = rule
			bestScore = score
		}
	}
	return best
}

// NormalizeRetryMaxAttempts 把重试次数归一为合法值。
//
// 规则：<=0 → DefaultRetryMaxAttempts；>MaxRetryMaxAttempts → 夹到上限。
// 返回默认值而不是报错的原因与"策略为空即默认"一致：读路径（含历史数据）必须
// 永远拿得到可用的次数，否则转发层就要到处判空。
func NormalizeRetryMaxAttempts(attempts int) int {
	if attempts <= 0 {
		return DefaultRetryMaxAttempts
	}
	if attempts > MaxRetryMaxAttempts {
		return MaxRetryMaxAttempts
	}
	return attempts
}

// NormalizeModelRetryRules 归一化模型级重试规则：去空白、丢弃空模型名、去重。
//
// 去重保留首次出现的规则（与 NormalizeGroupNames 的取舍一致：顺序即优先级信息，
// 不做排序）。规则数很少（通常个位数），线性去重足够。
func NormalizeModelRetryRules(rules []ModelRetryRule) []ModelRetryRule {
	if len(rules) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(rules))
	result := make([]ModelRetryRule, 0, len(rules))
	for _, rule := range rules {
		name := strings.TrimSpace(rule.Model)
		if name == "" {
			continue
		}
		if _, duplicated := seen[name]; duplicated {
			continue
		}
		seen[name] = struct{}{}
		rule.Model = name
		result = append(result, rule)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// validateRetryPolicy 校验重试相关字段，供 Channel.Validate 调用。
func (c *Channel) validateRetryPolicy() error {
	if !c.RetryMode.IsValid() {
		return fmt.Errorf("渠道重试开关非法: %d（可选：0 未配置 / 1 开启 / 2 关闭）", int(c.RetryMode))
	}
	if c.RetryMaxAttempts < 0 || c.RetryMaxAttempts > MaxRetryMaxAttempts {
		return fmt.Errorf("渠道重试次数必须在 0 ~ %d 之间（当前 %d；0 表示使用默认 %d 次）",
			MaxRetryMaxAttempts, c.RetryMaxAttempts, DefaultRetryMaxAttempts)
	}
	for _, rule := range c.ModelRetryRules {
		name := strings.TrimSpace(rule.Model)
		if name == "" {
			return fmt.Errorf("模型级重试规则的模型名不能为空")
		}
		if strings.ContainsAny(name, " \t\r\n") {
			return fmt.Errorf("模型级重试规则的模型名不能包含空白字符（当前为 %q）", name)
		}
		if rule.MaxAttempts < 0 || rule.MaxAttempts > MaxRetryMaxAttempts {
			return fmt.Errorf("模型 %q 的重试次数必须在 0 ~ %d 之间（当前 %d）",
				name, MaxRetryMaxAttempts, rule.MaxAttempts)
		}
	}
	return nil
}
