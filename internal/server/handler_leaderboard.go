// 本文件实现「用量排行榜」接口：付费榜 / 免费榜。
//
// 意图（Why）：
//
//	门户概览页的图表下方需要一张"谁在用、用了多少"的榜单，
//	让站长与用户一眼看出活跃度分布。拆成付费 / 免费两个榜单：
//	  - 付费用户（有已支付订单）与免费用户的使用强度差异巨大，
//	    混排会让免费榜永远被付费用户占据，失去"免费活跃度"的观察价值；
//	  - 两个榜单共用同一套分数口径，便于横向对比。
//
// 流转（Flow）：
//
//	GET /api/leaderboard?days=30
//	  └─ requireCurrentUser（登录可见；管理员可带 ?all=1 看完整榜）
//	       └─ UsageLogs.Leaderboard(窗口) → 分榜 → 归一化打分 → 排序 → Top N
//
// 扩展（Extend）：
//
//	新增榜单维度（如按分组）时：在 store 的 Leaderboard 聚合里加过滤条件，
//	并在此按维度拆榜即可——分数口径不需要动。
package server

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/xiaosu4610/aqua-api/internal/model"
)

// leaderboardDefaultDays 是排行榜默认统计窗口（近 30 天）。
const leaderboardDefaultDays = 30

// leaderboardMaxDays 是排行榜允许的最大统计窗口（近 365 天）。
const leaderboardMaxDays = 365

// leaderboardTopN 是每个榜单默认返回的名次上限（展示 Top 20）。
const leaderboardTopN = 20

// leaderboardEntryDTO 是排行榜中一行的对外表示。
type leaderboardEntryDTO struct {
	Rank        int     `json:"rank"`
	UserID      uint64  `json:"user_id"`
	Username    string  `json:"username"`
	Requests    int64   `json:"requests"`
	Tokens      int64   `json:"tokens"`
	Score       float64 `json:"score"`
	AvgLatencyMS float64 `json:"avg_latency_ms"`
	// PeakConcurrency 是窗口内峰值并发请求数（估算口径见 model.LeaderboardEntry）。
	PeakConcurrency int64 `json:"peak_concurrency"`
	// IsMe 标记这一行是否属于当前登录用户（前端据此高亮并标注"我"）。
	IsMe bool `json:"is_me"`
}

// leaderboardSectionDTO 是一个榜单（付费榜 / 免费榜）的整体响应。
type leaderboardSectionDTO struct {
	Items []leaderboardEntryDTO `json:"items"`
	// MyRank 是当前登录用户在该榜中的名次；未上榜时为 0。
	// 单独返回而不是依赖 items 里的 IsMe：用户可能不在前 N 名内，
	// 但榜单页仍要能显示"我排第几"。
	MyRank int `json:"my_rank"`
}

// handleLeaderboard 返回用量排行榜（付费榜 + 免费榜）。
//
// 参数：
//   - days：统计窗口天数（默认 30，上限 365）
//   - all：仅管理员可用；传 1 时返回完整榜单（不限前 N 名）
//
// 归一化说明（与 model.LeaderboardEntry.LeaderboardScore 一致）：
// 每个榜单内部独立取"最大请求数 / 最大 token 数"做分母，
// 分数 = 0.5 × 请求归一 + 0.5 × token 归一，取值 [0, 1]。
func (s *Server) handleLeaderboard(c *gin.Context) {
	user, ok := s.requireCurrentUser(c)
	if !ok {
		return
	}

	ctx := c.Request.Context()

	days := leaderboardDefaultDays
	if raw := c.Query("days"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= leaderboardMaxDays {
			days = parsed
		}
	}
	until := time.Now()
	since := until.AddDate(0, 0, -days)

	entries, err := s.deps.UsageLogs.Leaderboard(ctx, model.UsageLogQuery{
		Since: &since,
		Until: &until,
	})
	if err != nil {
		s.respondInternalError(c, "统计用量排行榜失败")
		return
	}

	// 管理员可查看完整榜单；普通用户只看前 N 名。
	topN := leaderboardTopN
	if user.IsAdmin() && c.Query("all") == "1" {
		topN = 0 // 0 表示不截断
	}

	paid := make([]model.LeaderboardEntry, 0)
	free := make([]model.LeaderboardEntry, 0)
	for _, entry := range entries {
		if entry.Paid {
			paid = append(paid, entry)
		} else {
			free = append(free, entry)
		}
	}

	paidDTO := s.buildLeaderboardSection(paid, user.ID, topN)
	freeDTO := s.buildLeaderboardSection(free, user.ID, topN)

	c.JSON(http.StatusOK, gin.H{
		"range_days": days,
		"paid":       paidDTO,
		"free":       freeDTO,
		"updated_at": until.Unix(),
	})
}

// buildLeaderboardSection 对一组成绩排序、打分、截断并计算当前用户名次。
func (s *Server) buildLeaderboardSection(entries []model.LeaderboardEntry, myUserID uint64, topN int) leaderboardSectionDTO {
	section := leaderboardSectionDTO{
		Items: make([]leaderboardEntryDTO, 0),
	}

	if len(entries) == 0 {
		return section
	}

	// 榜内归一化分母：各自取最大请求数 / 最大 token 数。
	maxRequests := int64(0)
	maxTokens := int64(0)
	for _, entry := range entries {
		if entry.Requests > maxRequests {
			maxRequests = entry.Requests
		}
		if entry.Tokens > maxTokens {
			maxTokens = entry.Tokens
		}
	}

	// 排序：分数降序；分数相同时请求数多者在前；再相同按用户名（稳定、可预期）。
	sort.SliceStable(entries, func(i, j int) bool {
		si := entries[i].LeaderboardScore(maxRequests, maxTokens)
		sj := entries[j].LeaderboardScore(maxRequests, maxTokens)
		if si != sj {
			return si > sj
		}
		if entries[i].Requests != entries[j].Requests {
			return entries[i].Requests > entries[j].Requests
		}
		return entries[i].Username < entries[j].Username
	})

	// 当前用户的名次（即使被截断也要能返回）。
	myRank := 0
	for index, entry := range entries {
		if entry.UserID == myUserID {
			myRank = index + 1
			break
		}
	}
	section.MyRank = myRank

	// 截断后构建 DTO。
	limit := len(entries)
	if topN > 0 && limit > topN {
		limit = topN
	}
	section.Items = make([]leaderboardEntryDTO, 0, limit)
	for index := 0; index < limit; index++ {
		entry := entries[index]
		section.Items = append(section.Items, leaderboardEntryDTO{
			Rank:            index + 1,
			UserID:          entry.UserID,
			Username:        entry.Username,
			Requests:        entry.Requests,
			Tokens:          entry.Tokens,
			Score:           entry.LeaderboardScore(maxRequests, maxTokens),
			AvgLatencyMS:    entry.AvgLatencyMS,
			PeakConcurrency: entry.PeakConcurrency,
			IsMe:            entry.UserID == myUserID,
		})
	}

	return section
}
