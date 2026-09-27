// 本文件定义「模型名通配模式」的公共实现，供下游售价与上游进价共用。
//
// 意图（Why）：
//
//	同一个模型名要同时匹配两类价格规则：**下游售价**（model_prices，按分组定价）
//	与**上游进价**（channel_model_costs，按渠道定价）。两者的匹配语义必须完全一致——
//	精确 > 最长前缀 > 全局通配——否则会出现"售价规则命中了 A、进价规则命中了 B"，
//	算出的毛利是两条不同规则的差，属于最难看懂的一类错账。
//
//	因此把"模式怎么判定、怎么匹配、谁更具体"抽成本文件的唯一定义，
//	两类规则都委托到它，从结构上杜绝漂移。
//
// 流转（Flow）：
//
//	后台维护价格 → model.ModelPrice / model.ChannelModelCost
//	  └─ 匹配：MatchModelPrice / MatchChannelModelCost → 内部用 PricePattern 打分
//	转发计费 → relay.Billing.priceFor → MatchModelPrice
//	成本核算 → server 按密钥聚合用量 → MatchChannelModelCost
//
// 扩展（Extend）：
//
//	新增通配语法（如正则、中间通配）时，只需改本文件的 Kind/Matches/specificity
//	三处；两套价格规则与全部调用方都会同步生效，无需逐个修改。
package model

import "strings"

// wildcardAll 是"匹配全部模型"的通配规则。
const wildcardAll = "*"

// PatternKind 描述规则模式的类型，用于匹配优先级判定。
type PatternKind int

const (
	// PatternExact 精确匹配（如 "gpt-4o"）
	PatternExact PatternKind = iota
	// PatternPrefix 前缀通配（如 "gpt-4*"）
	PatternPrefix
	// PatternAll 全局通配（"*"）
	PatternAll
)

// PricePattern 是一个"模型名通配模式"。
//
// 用自定义字符串类型而不是裸 string：让"这是模式而不是普通名字"在函数签名上可见，
// 避免被误当作模型名直接比较（那会漏掉通配语义）。
type PricePattern string

// Kind 返回该模式的类型。
func (p PricePattern) Kind() PatternKind {
	pattern := strings.TrimSpace(string(p))
	if pattern == wildcardAll {
		return PatternAll
	}
	if strings.HasSuffix(pattern, "*") {
		return PatternPrefix
	}
	return PatternExact
}

// Matches 判断该模式是否适用于给定模型名。
//
// 匹配规则：
//   - 精确：完全相等；
//   - 前缀通配："gpt-4*" 匹配 "gpt-4o"、"gpt-4-turbo"；
//   - 全局通配："*" 匹配一切。
//
// 匹配是大小写敏感的：模型名是上游定义的标识符，
// 大小写不同通常代表不同模型（如 "GPT-4" 与 "gpt-4" 在部分上游是两个条目）。
func (p PricePattern) Matches(modelName string) bool {
	pattern := strings.TrimSpace(string(p))
	switch p.Kind() {
	case PatternAll:
		return true
	case PatternPrefix:
		return strings.HasPrefix(modelName, strings.TrimSuffix(pattern, "*"))
	default:
		return pattern == modelName
	}
}

// Specificity 返回模式的具体程度（数值越大越优先）。
//
// 这样排序后即可实现"精确 > 长前缀 > 短前缀 > 全局"的优先级，
// 而不需要写一串嵌套判断。
func (p PricePattern) Specificity() int {
	switch p.Kind() {
	case PatternExact:
		return 10000 + len(p)
	case PatternPrefix:
		return 1000 + len(p)
	default:
		return 0
	}
}

// betterThan 判断本模式是否比 other 更该被选中。
//
// 规则：更具体者优先；同样具体时取 ID 更小的，保证同一份数据每次匹配结果一致
// （否则后台两次刷新可能看到不同的"生效规则"，无法核对）。
func betterThan(id, otherID uint64, specificity, otherSpecificity int) bool {
	if specificity != otherSpecificity {
		return specificity > otherSpecificity
	}
	return id < otherID
}
