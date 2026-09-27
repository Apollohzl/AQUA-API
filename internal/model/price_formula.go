// 本文件是「按 token 用量换算金额」的唯一公式实现。
//
// 意图（Why）：
//
//	同一个换算口径要同时服务于两个方向：
//	  - 下游售价（model.ModelPrice）：向用户收多少；
//	  - 上游进价（model.ChannelModelCost）：上游收站长多少。
//	这两个数字会被放在一起做减法得出毛利，因此**必须逐字同口径**：
//	任何一处取整方式、缓存回退规则稍有不同，毛利就会长期带一个系统性偏差，
//	而这种偏差既不会报错也很难被发现。
//
//	所以公式只写一次，两类价格结构都委托到这里。
//
// 公式：
//
//	金额 = ((prompt − cached) × promptPrice
//	        + cached × cachePrice
//	        + completion × completionPrice) / 1_000_000
//
//	价格字段表示「每 100 万 token 的额度单位」；cachePrice <= 0 时回退 promptPrice。
//
// 流转（Flow）：
//
//	ModelPrice.ComputeQuotaWithCache ─┐
//	                                  ├─→ ComputeTokenQuota（本文件）
//	ChannelModelCost.ComputeTokenCost ┘
//
// 扩展（Extend）：
//
//	新增计价维度（如按图片张数、按音频分钟）时：在此加独立的换算函数，
//	不要改动本函数——它是两套价格共同依赖的基线口径。
package model

// quotaScale 是价格口径的换算基数：价格字段为"每 100 万 token"。
//
// 单独定义成常量而不是在公式里写 1_000_000，是为了让"口径"这件事在代码里
// 有一个可被检索的名字——将来若改成"每千 token"，只需改这一处并同步注释。
const quotaScale int64 = 1_000_000

// ComputeTokenQuota 按 token 用量与单价换算金额（额度单位），向下取整。
//
// 参数语义：
//   - promptTokens 是输入总量，cachedTokens 是其中命中上游缓存的部分
//     （cached 会被夹到 [0, promptTokens]，防止上游超标上报导致"输入算两次"）；
//   - cachePrice <= 0 表示未配置缓存价，此时命中部分按 promptPrice 计，
//     与引入缓存计价之前的账目完全一致；
//   - 负数一律按 0 处理（上游偶发上报负值时不至于变成"反向加钱"）。
//
// 溢出安全：token 数与单价的乘积上限约 10^15，远小于 int64 上限（9.2×10^18）。
func ComputeTokenQuota(promptPrice, cachePrice, completionPrice,
	promptTokens, completionTokens, cachedTokens int64) int64 {
	if promptTokens < 0 {
		promptTokens = 0
	}
	if completionTokens < 0 {
		completionTokens = 0
	}
	if cachedTokens < 0 {
		cachedTokens = 0
	}
	if cachedTokens > promptTokens {
		cachedTokens = promptTokens
	}
	if cachePrice <= 0 {
		cachePrice = promptPrice
	}

	uncached := promptTokens - cachedTokens
	return (uncached*promptPrice + cachedTokens*cachePrice + completionTokens*completionPrice) / quotaScale
}

// ComputePerCallAmount 按"次数"换算金额，用于按次计费的能力（图像 / 视频 / 异步任务）。
//
// count <= 0 时按 1 次处理：缺省即"一次调用"；若按 0 次计算会变成免费，
// 属于让站长白白亏钱的默认值。
func ComputePerCallAmount(perCallPrice, count int64) int64 {
	if count <= 0 {
		count = 1
	}
	if perCallPrice <= 0 {
		return 0
	}
	return perCallPrice * count
}
