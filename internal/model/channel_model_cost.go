// 本文件定义「上游进价」领域模型：某个渠道下某个模型在上游侧的成本。
//
// 意图（Why）：
//
//	在此之前，系统只记录"下游收多少钱"（model_prices），没有任何地方记录
//	"上游收我们多少钱"。后果有三个，且都很实际：
//	  1) 站长无法核算毛利——不知道每个模型是赚还是亏；
//	  2) 密钥余额无法反映消耗（迁移 0022 只能人工录入一个静态快照）。
//	     有了进价即可按真实用量估算"这把密钥已经花掉多少"，从而算出剩余；
//	  3) 无法区分"上游免费"与"忘了配成本"，做活动/选渠道时缺少依据。
//
//	因此进价必须与售价**同口径**（都是「每 100 万 token 的额度单位」），
//	这样毛利就是一次减法，不需要任何汇率换算（引入汇率只会引入新的错误来源）。
//
// 归属维度（关键设计取舍）：
//
//	售价按【分组】定价（同一模型对免费组与付费组可以不同价），
//	进价按【渠道】定价（同一模型在不同渠道上的成本完全不同：官方直采、代理、
//	免费额度池可能是三倍差价）。因此本表用 (channel_id, model) 作为唯一键，
//	与 model_prices 的 (group_name, model) 并列，各管一个方向。
//
// 流转（Flow）：
//
//	后台维护：渠道页「上游计费」区 → ReplaceForChannel 整体保存
//	成本核算：后台查询 → 按 (渠道, 密钥, 模型) 聚合用量 → MatchChannelModelCost
//	          → ComputeTokenCost → 得出"已消耗"，与密钥余额相减得"剩余"
//
// 扩展（Extend）：
//
//	新增计费维度（如按音频分钟）时：在本文件加字段与换算分支 + 建迁移加列 +
//	同步 store 的列清单/INSERT/scan 四处 + 同步价格页与渠道页表单。
package model

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ErrChannelModelCostNotFound 表示成本规则不存在。
var ErrChannelModelCostNotFound = errors.New("model: 上游成本规则不存在")

// ErrChannelModelCostDuplicated 表示同一渠道下同一模型名有重复规则。
var ErrChannelModelCostDuplicated = errors.New("model: 该渠道下同一模型只能有一条成本规则")

// ChannelModelCost 表示一条「上游进价」规则。
type ChannelModelCost struct {
	ID        uint64 // 主键
	ChannelID uint64 // 所属渠道
	// Model 是上游模型名（渠道声明/映射后的名字），支持尾部通配（"gpt-4*"）。
	//
	// 为什么按上游名而不是对外名：钱是上游收的。同一对外名可能因映射指向
	// 不同的上游模型，成本自然不同。
	Model           string
	PromptPrice     int64     // 每 1M 输入 token 的成本（额度单位，与售价同口径）
	CachePrice      int64     // 每 1M 命中缓存输入 token 的成本；0 表示按 PromptPrice 计
	CompletionPrice int64     // 每 1M 输出 token 的成本
	PerCallPrice    int64     // 每调用一次的成本（图像/视频等按次计费的上游）
	Remark          string    // 备注（说明依据，如"官方价 $3/1M × 汇率 7.2"）
	CreatedAt       time.Time // 创建时间
	UpdatedAt       time.Time // 更新时间
}

// Validate 校验成本规则。
func (c *ChannelModelCost) Validate() error {
	if c.ChannelID == 0 {
		return errors.New("成本规则必须归属某个渠道")
	}
	if strings.TrimSpace(c.Model) == "" {
		return errors.New("上游模型名不能为空（可用 * 表示该渠道全部模型）")
	}
	// 成本为负会变成"消耗反而增加余额"，必须拦住
	if c.PromptPrice < 0 || c.CachePrice < 0 || c.CompletionPrice < 0 || c.PerCallPrice < 0 {
		return fmt.Errorf("成本不能为负数（输入 %d / 缓存 %d / 输出 %d / 每次 %d）",
			c.PromptPrice, c.CachePrice, c.CompletionPrice, c.PerCallPrice)
	}
	return nil
}

// Matches 判断该规则是否适用于给定上游模型名（语义与售价规则完全一致）。
func (c *ChannelModelCost) Matches(modelName string) bool {
	if c == nil {
		return false
	}
	return PricePattern(c.Model).Matches(modelName)
}

// IsFree 判断该规则是否表示"上游免费"（四个价格全为 0）。
//
// 用途：后台把"上游免费"与"尚未录入成本"区分显示——
// 前者是明确结论（例如免费额度池），后者是待办事项，两者混在一起会误导运营判断。
func (c *ChannelModelCost) IsFree() bool {
	if c == nil {
		return false
	}
	return c.PromptPrice == 0 && c.CachePrice == 0 && c.CompletionPrice == 0 && c.PerCallPrice == 0
}

// ComputeTokenCost 按用量估算本次的上游成本（与售价同一公式，见 price_formula.go）。
func (c *ChannelModelCost) ComputeTokenCost(promptTokens, completionTokens, cachedTokens int64) int64 {
	if c == nil {
		return 0
	}
	return ComputeTokenQuota(c.PromptPrice, c.CachePrice, c.CompletionPrice,
		promptTokens, completionTokens, cachedTokens)
}

// ComputeCallCost 按次数估算上游成本（图像/视频等按次计费的上游）。
func (c *ChannelModelCost) ComputeCallCost(calls int64) int64 {
	if c == nil {
		return 0
	}
	return ComputePerCallAmount(c.PerCallPrice, calls)
}

// IsPerCall 判断这条进价规则是否按次计费。
//
// 判定口径与售价侧 ModelPrice.EffectiveBillingMode 的自动判定**完全一致**：
// 只有按次价、三个 token 价全为 0 → 按次。
// 必须同口径的原因：售价按次而进价按量（或反过来）会让"毛利"变成两个不同口径
// 相减，这种误差不会报错，只会长期悄悄偏离。
func (c *ChannelModelCost) IsPerCall() bool {
	return c != nil && c.PerCallPrice > 0 &&
		c.PromptPrice == 0 && c.CachePrice == 0 && c.CompletionPrice == 0
}

// ComputeCost 按本条规则的口径计算成本：按次规则用"次数 × 每次单价"，其余用 token 公式。
//
// 为什么需要这个统一入口（2026-09-28 补的一处缺口）：
//
//	核算路径此前只调用 ComputeTokenCost。对"只填了 PerCallPrice"的进价规则，
//	token 公式的结果恒为 0 —— 不报错，但会同时造成三件坏事：
//	  1) 后台「密钥消耗 / 剩余」永远不减少，站长看不出预付费密钥还能用多久；
//	  2) 毛利报表把该渠道成本算成 0，面板上"全是利润"，与真实账目背离；
//	  3) 没有它就算不出"每个计费请求实际打了多少次上游"（即重试率 r），
//	     而按次线路的定价正是围着 r 设计的。
//
// requests <= 0 时由 ComputePerCallAmount 按 1 次处理（缺省即"一次调用"）。
func (c *ChannelModelCost) ComputeCost(promptTokens, completionTokens, cachedTokens, requests int64) int64 {
	if c == nil {
		return 0
	}
	if c.IsPerCall() {
		return c.ComputeCallCost(requests)
	}
	return c.ComputeTokenCost(promptTokens, completionTokens, cachedTokens)
}

// MatchChannelModelCost 从一组成本规则中挑出最适用的那一条。
//
// 优先级与售价完全一致：精确匹配 → 前缀最长 → 全局通配；
// 同类内取 ID 最小的，保证同一份数据每次匹配结果稳定可复现。
//
// 返回 nil 表示该渠道没有为这个模型录入成本：
// 调用方必须把这种情况与"成本为 0（上游免费）"区分开——
// 前者是"未知"（不要拿它去扣余额），后者才是"确认不花钱"。
func MatchChannelModelCost(costs []*ChannelModelCost, modelName string) *ChannelModelCost {
	var best *ChannelModelCost
	bestScore := -1

	for _, cost := range costs {
		if cost == nil || !cost.Matches(modelName) {
			continue
		}
		score := PricePattern(cost.Model).Specificity()
		if best == nil || betterThan(cost.ID, best.ID, score, bestScore) {
			best = cost
			bestScore = score
		}
	}
	return best
}

// SortChannelModelCosts 按"具体到笼统"排序，便于后台展示与人工核对。
func SortChannelModelCosts(costs []*ChannelModelCost) {
	sort.SliceStable(costs, func(i, j int) bool {
		left, right := PricePattern(costs[i].Model).Specificity(), PricePattern(costs[j].Model).Specificity()
		if left != right {
			return left > right
		}
		return costs[i].ID < costs[j].ID
	})
}

// ChannelModelCostRepository 定义上游进价的持久化操作。
//
// 刻意只提供"按渠道整体读写"两个方法，而不是单条 CRUD：
// 成本规则的编辑方式就是"在渠道页把这一批模型的价格一次改完"，
// 逐条增删改既没有对应的界面动作，也会让"同一渠道的成本"有机会处于中间状态。
type ChannelModelCostRepository interface {
	// ListByChannel 返回某渠道的全部成本规则（按"具体→笼统"排序）。
	//
	// channelID 为 0 时返回空列表（而不是全表）：避免调用方漏传参数时
	// 意外拿到全部渠道的成本，那会把 A 渠道的成本算到 B 渠道头上。
	ListByChannel(ctx context.Context, channelID uint64) ([]*ChannelModelCost, error)

	// ReplaceForChannel 用给定集合整体替换某渠道的成本规则（新增/更新/删除一次完成）。
	//
	// 语义：调用后该渠道的成本规则【恰好】是传入的这一批。
	// 传空切片表示"清空该渠道的成本配置"（用于放弃核算，而不是表示免费——
	// 表示免费应当传一条四个价格全为 0 的规则）。
	//
	// 为什么用"整体替换"而不是 diff：成本规则数量少（通常几条到几十条），
	// 整体替换实现简单且不会出现"删了一半失败"的中间状态（全程在事务内）。
	// 代价是并发编辑会互相覆盖，但这是后台低频操作，与密钥池的取舍一致。
	ReplaceForChannel(ctx context.Context, channelID uint64, costs []*ChannelModelCost) (created, updated int, err error)

	// DeleteByChannel 删除某渠道的全部成本规则（删除渠道时调用，避免留下孤儿数据）。
	DeleteByChannel(ctx context.Context, channelID uint64) error
}
