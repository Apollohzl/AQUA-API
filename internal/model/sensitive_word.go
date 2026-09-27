// 本文件定义「敏感词过滤」领域模型：词条模型、仓储接口与多模式匹配器。
//
// 意图（Why）：
//
//	对外开放的网关会被用于生成任意内容，站长需要在【请求进入上游之前】拦下
//	明确违规的输入（违法违规、涉政涉黄、以及站点自定的黑名单词），否则：
//	  1) 上游可能因内容违规直接封禁渠道，损失的是站长的账号与成本；
//	  2) 一旦被用于传播违规内容，站长作为服务提供者要承担合规责任。
//
//	这件事必须做在网关侧而不是靠上游：上游内容审核接口是额外成本，
//	且不是所有渠道都提供；而关键词黑名单是站长自己能掌控的最低成本手段。
//
//	为什么把匹配器放在 model 层：它是纯算法（无 I/O、无 SQL），
//	与 MatchModelPrice 一样属于"领域规则"，放在这里可被中间件、后台预览、
//	测试三处复用，且不引入新的包依赖。
//
// 匹配算法（Aho–Corasick）：
//
//	需求是"一个请求体里同时找出若干个词"，且请求体可能很大（几千字）。
//	朴素做法是"对每个词做一次 Contains"，词条上百时等于把正文扫上百遍。
//	Aho–Corasick 把全部词条编译成一棵带失败指针的字典树，正文只需扫【一遍】，
//	复杂度 O(正文长度 + 命中数)，与词条数量无关——这在上百条黑名单时差别明显。
//
// 流转（Flow）：
//
//	后台维护：SensitiveWordsView → SensitiveWordRepository.Create/CreateMany/Delete
//	请求过滤：middleware.SensitiveFilter 定期把词条编译为 SensitiveMatcher
//	          → /v1 入口中间件 Match(请求文本) → 命中即 403/400 拦截
//
// 扩展（Extend）：
//
//	新增词条属性（如"仅记录不拦截"）：在 SensitiveWord 加字段 + 建迁移加列 +
//	  同步 store 的列清单/INSERT/UPDATE/scan 四处；匹配器返回整个词条，
//	  因此新增属性无需改动匹配算法本身。
package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrSensitiveWordNotFound 表示词条不存在。
var ErrSensitiveWordNotFound = errors.New("model: 敏感词不存在")

// ErrSensitiveWordDuplicated 表示同名词条已存在。
var ErrSensitiveWordDuplicated = errors.New("model: 该敏感词已存在")

// 词条长度约束（按 rune 计）。
//
// 下限 1：空词会让匹配器每次都命中，等于拦截全部请求——必须拦住这种"自杀式配置"。
// 上限 64：过长的"词"通常是误粘贴了整段文本，既无意义也会拖慢可读性；
// 真正的长句黑名单应拆成关键片段。
const (
	MinSensitiveWordRunes = 1
	MaxSensitiveWordRunes = 64
)

// SensitiveWord 表示一条敏感词。
type SensitiveWord struct {
	ID uint64 // 主键
	// Word 是词条。落库时统一存为「去首尾空白 + 小写」的形式（见 MatchKey），
	// 与唯一索引配合即可保证同义词条只存在一条；匹配本身也不区分大小写。
	Word      string
	Category  string    // 分类（如"违法违规"），仅用于给使用者提示，可为空
	Enabled   bool      // 是否启用（停用即不参与匹配）
	Remark    string    // 备注（便于说明为什么加这个词）
	CreatedAt time.Time // 创建时间
	UpdatedAt time.Time // 更新时间
}

// Validate 校验词条。
func (w *SensitiveWord) Validate() error {
	word := strings.TrimSpace(w.Word)
	if word == "" {
		return errors.New("敏感词不能为空")
	}
	length := len([]rune(word))
	if length < MinSensitiveWordRunes || length > MaxSensitiveWordRunes {
		return fmt.Errorf("敏感词长度必须在 %d ~ %d 个字符之间，当前 %d",
			MinSensitiveWordRunes, MaxSensitiveWordRunes, length)
	}
	// Category 与 Remark 允许为空：便于站长先批量导入、稍后再补说明。
	return nil
}

// MatchKey 返回用于匹配的规整键：去首尾空白并统一小写。
//
// 为什么要小写：英文脏词经常以全大写/首字母大写出现（如 "BadWord"），
// 若区分大小写，站长得为每种写法各加一条，实际必然漏配。
func (w *SensitiveWord) MatchKey() string {
	if w == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(w.Word))
}

// SensitiveWordRepository 定义敏感词的持久化操作。
type SensitiveWordRepository interface {
	// List 查询词条；enabledOnly 为 true 时只返回启用的词条。
	//
	// 返回顺序按创建时间升序，保证同一次后台浏览的顺序稳定。
	List(ctx context.Context, enabledOnly bool) ([]*SensitiveWord, error)

	// Create 新增词条，同名词条已存在时返回 ErrSensitiveWordDuplicated。
	Create(ctx context.Context, word *SensitiveWord) error

	// CreateMany 批量新增，自动跳过已存在的词条，返回实际新增的数量。
	//
	// 为什么要"跳过"而不是"整体失败"：批量导入是站长贴一大段文本的场景，
	// 其中常常混有已加过的词；若整体回滚，站长只能一个个删掉重来，体验极差。
	CreateMany(ctx context.Context, words []*SensitiveWord) (int, error)

	// GetByID 按主键查询，不存在时返回 ErrSensitiveWordNotFound。
	GetByID(ctx context.Context, id uint64) (*SensitiveWord, error)

	// Update 按 ID 更新，不存在时返回 ErrSensitiveWordNotFound。
	Update(ctx context.Context, word *SensitiveWord) error

	// Delete 按 ID 删除，不存在时返回 ErrSensitiveWordNotFound。
	Delete(ctx context.Context, id uint64) error
}

// acNode 是 Aho–Corasick 字典树的一个节点。
type acNode struct {
	// next 是"该字符 → 子节点下标"的转移表。
	// 用 map 而非定长数组：词条是任意 Unicode 文本，字符集不可预知。
	next map[rune]int
	// fail 是失败指针：当前路径失配时跳转到的节点下标。
	fail int
	// out 是"以本节点结尾的词条"；nil 表示无词条在此结尾。
	//
	// 只保留一条：同一条路径的终点只可能有一个词条（重复词条在入库时被唯一索引拦住）。
	out *SensitiveWord
}

// SensitiveMatcher 是编译好的敏感词匹配器，**并发只读安全**。
//
// 生命周期约定：词条变化时不要就地修改，而是重新 New 一个再整体替换
// （见 middleware.SensitiveFilter）。这样匹配路径完全无锁。
type SensitiveMatcher struct {
	nodes []*acNode
	count int
}

// NewSensitiveMatcher 把词条编译为匹配器。
//
// 只编译 enabled 的词条；空词条（规整后为空）会被跳过，
// 避免"一个空词条让全部请求都被拦截"。
func NewSensitiveMatcher(words []*SensitiveWord) *SensitiveMatcher {
	root := &acNode{next: make(map[rune]int)}
	nodes := []*acNode{root}
	count := 0

	for _, word := range words {
		if word == nil || !word.Enabled {
			continue
		}
		key := word.MatchKey()
		if key == "" {
			continue
		}

		cursor := 0
		for _, r := range key {
			next, ok := nodes[cursor].next[r]
			if !ok {
				nodes = append(nodes, &acNode{next: make(map[rune]int)})
				next = len(nodes) - 1
				nodes[cursor].next[r] = next
			}
			cursor = next
		}
		if nodes[cursor].out == nil {
			nodes[cursor].out = word
			count++
		}
	}

	// 广度优先构建失败指针（必须按层序，父节点的 fail 必须先算出来）。
	queue := make([]int, 0, len(nodes))
	for _, child := range nodes[0].next {
		nodes[child].fail = 0
		queue = append(queue, child)
	}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		for r, child := range nodes[current].next {
			// fail(child) = 从 fail(current) 出发沿字符 r 能走到的最近节点，
			// 一路回退到根为止；根上仍无该字符则指向根。
			fallback := nodes[current].fail
			for {
				if next, ok := nodes[fallback].next[r]; ok {
					nodes[child].fail = next
					break
				}
				if fallback == 0 {
					nodes[child].fail = 0
					break
				}
				fallback = nodes[fallback].fail
			}
			// 输出合并：把失败指针处的词条继承过来，
			// 这样匹配时只需看当前节点，不必沿 fail 链回溯找词条。
			if nodes[child].out == nil {
				nodes[child].out = nodes[nodes[child].fail].out
			}
			queue = append(queue, child)
		}
	}

	return &SensitiveMatcher{nodes: nodes, count: count}
}

// Count 返回已编译的词条数量。
func (m *SensitiveMatcher) Count() int {
	if m == nil {
		return 0
	}
	return m.count
}

// Empty 返回匹配器是否不含任何词条（此时 Match 恒为未命中）。
func (m *SensitiveMatcher) Empty() bool {
	return m.Count() == 0
}

// Match 在文本中查找第一条命中的词条。
//
// 匹配不区分大小写：文本与词条都先统一小写再比较。
// 只返回"是否命中 + 命中哪条"，不返回位置——调用方需要的是"拦不拦"，
// 而把命中位置回传给使用者反而会暴露词表内容（见命中文案的注释）。
func (m *SensitiveMatcher) Match(text string) (*SensitiveWord, bool) {
	if m == nil || len(m.nodes) == 0 || text == "" {
		return nil, false
	}

	lowered := strings.ToLower(text)
	cursor := 0

	for _, r := range lowered {
		for {
			if next, ok := m.nodes[cursor].next[r]; ok {
				cursor = next
				break
			}
			if cursor == 0 {
				// 根节点也没有该字符的转移：原地不动，继续下一个字符。
				break
			}
			cursor = m.nodes[cursor].fail
		}
		if out := m.nodes[cursor].out; out != nil {
			return out, true
		}
	}
	return nil, false
}
