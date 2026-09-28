// 本文件实现语料原文的内存缓冲（Recorder）与请求上下文挂载。
//
// 意图（Why）：
//
//	转发链路上"拿到完整返回正文"最省事的做法，是在既有的响应回写 tee 旁边
//	再挂一个 io.Writer。Recorder 就是这个 Writer：它只做一件事——
//	把经过的字节按上限存进内存，供请求结束后一次性落库。
//
//	为什么必须有上限：网关是长驻进程，一次异常请求（比如上游返回几百 MB）
//	就能把内存打爆。上限触发时**截断并如实标注**，而不是静默丢弃或让进程崩掉。
//
//	为什么放在 context 里而不是改函数签名：转发链路要经过
//	ServeChatCompletions → forwardWithFallback → forwardChat（可能多轮重试）
//	→ 适配器回写，逐层加参数会污染一串与本功能无关的签名；
//	挂 context 只需在入口处挂一次，出口处取一次。
//
// 并发约定：
//
//	Recorder 只在**处理该请求的那一个 goroutine**里被写入（回写 tee 与适配器
//	都是同步调用），因此内部不加锁；这不是巧合，而是刻意的——
//	加锁会让每个流式分片都付一次原子操作的钱。
//
// 流转（Flow）：
//
//	ServeChatCompletions：命中采集 → NewRecorder(请求原文) → WithRecorder(ctx)
//	flushCopy / writeAdapted：把 Recorder 作为 tee 的一部分写入（返回正文）
//	recordUsage：RecorderFrom(ctx) → 组装 CorpusSample → 落库
//
// 扩展（Extend）：
//
//	若要"分片落盘"（支持超过内存上限的超长会话）：把缓冲换成临时文件即可，
//	本文件对外暴露的方法签名不需要改动。
package corpus

import (
	"context"
)

// Recorder 缓冲一次请求的原文（请求体 + 上游返回正文）。
type Recorder struct {
	// maxBytes 是请求与返回**各自**的上限。
	maxBytes int

	requestBody      []byte
	requestBytes     int64
	requestTruncated bool

	response         []byte
	responseBytes    int64
	responseTruncate bool

	// aborted 表示客户端中途断开、只采到一部分（由回写路径标记）。
	aborted bool
}

// DefaultMaxBytes 是单次采集的默认上限（请求与返回各自）。
//
// 取 16 MiB：远高于任何正常对话（普通对话几十 KB，超长上下文也不过数百 KB），
// 因此**正常情况永不触发**；它的作用只是"极端请求别把内存吃爆"的最后一道闸。
const DefaultMaxBytes = 16 << 20

// NewRecorder 创建一个采集缓冲，并把请求原文放进去（超限则截断并标注）。
func NewRecorder(requestBody []byte, maxBytes int) *Recorder {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBytes
	}
	rec := &Recorder{maxBytes: maxBytes}
	rec.requestBytes = int64(len(requestBody))
	if len(requestBody) > maxBytes {
		rec.requestBody = append([]byte(nil), requestBody[:maxBytes]...)
		rec.requestTruncated = true
	} else {
		rec.requestBody = append([]byte(nil), requestBody...)
	}
	return rec
}

// Write 追加一段返回正文（实现 io.Writer）。
//
// 永远返回 (len(p), nil)：它挂在最终的写出链路上，
// 一旦返回错误就可能影响客户端响应——采集绝不允许影响业务。
func (r *Recorder) Write(p []byte) (int, error) {
	if r == nil {
		return len(p), nil
	}
	r.responseBytes += int64(len(p))
	if len(r.response) < r.maxBytes {
		remain := r.maxBytes - len(r.response)
		if remain >= len(p) {
			r.response = append(r.response, p...)
		} else {
			r.response = append(r.response, p[:remain]...)
			r.responseTruncate = true
		}
	} else {
		r.responseTruncate = true
	}
	return len(p), nil
}

// MarkAborted 标记"客户端中途断开，本次只采到一部分"。
func (r *Recorder) MarkAborted() {
	if r != nil {
		r.aborted = true
	}
}

// Request 返回请求原文、原始字节数与是否被截断。
func (r *Recorder) Request() (body string, size int64, truncated bool) {
	if r == nil {
		return "", 0, false
	}
	return string(r.requestBody), r.requestBytes, r.requestTruncated
}

// Response 返回返回正文原文、原始字节数与是否被截断。
func (r *Recorder) Response() (body string, size int64, truncated bool) {
	if r == nil {
		return "", 0, false
	}
	return string(r.response), r.responseBytes, r.responseTruncate
}

// Incomplete 表示本次采集只拿到了一部分（客户端断开）。
func (r *Recorder) Incomplete() bool {
	return r != nil && r.aborted
}

// Sizes 返回（请求字节数, 返回字节数），便于不取值时先看规模。
func (r *Recorder) Sizes() (int64, int64) {
	if r == nil {
		return 0, 0
	}
	return r.requestBytes, r.responseBytes
}

// ---------------------------------------------------------------------------
// 请求上下文挂载
// ---------------------------------------------------------------------------

// recorderKey 是本包专用的上下文键类型。
//
// 用私有空结构体而不是字符串：避免与其它包的同名键互相覆盖，
// 也不需要全局注册表。
type recorderKey struct{}

// WithRecorder 把采集缓冲挂到 context 上。
func WithRecorder(ctx context.Context, rec *Recorder) context.Context {
	if rec == nil {
		return ctx
	}
	return context.WithValue(ctx, recorderKey{}, rec)
}

// RecorderFrom 取出采集缓冲；没有则返回 nil（表示本次不采集）。
func RecorderFrom(ctx context.Context) *Recorder {
	if ctx == nil {
		return nil
	}
	rec, _ := ctx.Value(recorderKey{}).(*Recorder)
	return rec
}

// Sample 是落库所需的一次采集结果（与 storage 层解耦的中间结构）。
//
// 之所以不让 relay 直接组装 model.CorpusSample：本包只负责"采到什么"，
// "记到哪张表、带哪些业务字段"属于 relay 的职责，边界更清楚。
type Sample struct {
	RequestBody   string
	ResponseBody  string
	RequestBytes  int64
	ResponseBytes int64
	Truncated     bool
	Incomplete    bool
}

// Snapshot 把缓冲整理成落库用的结果。
func (r *Recorder) Snapshot() Sample {
	reqBody, reqSize, reqTruncated := r.Request()
	respBody, respSize, respTruncated := r.Response()
	return Sample{
		RequestBody:   reqBody,
		ResponseBody:  respBody,
		RequestBytes:  reqSize,
		ResponseBytes: respSize,
		Truncated:     reqTruncated || respTruncated,
		Incomplete:    r.Incomplete(),
	}
}

// 保证 Recorder 满足 io.Writer（编译期断言，避免签名被改坏）。
var _ interface {
	Write(p []byte) (int, error)
} = (*Recorder)(nil)
