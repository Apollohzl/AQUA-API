// 本文件验证 ClientIP 的"可信代理"判定。
//
// 意图（Why）：
//
//	限流与审计都按 ClientIP 记账，而 X-Real-IP / X-Forwarded-For 本质上是
//	请求头——任何人都能自带。若不判断"直连对端是不是我们的反向代理"，
//	攻击者每次换一个 X-Real-IP 就能让限流每次都落进新桶，登录爆破与验证码
//	轰炸的防护会直接失效。本文件的用例把这套判定钉死。
//
// 流转（Flow）：
//
//	构造带不同 RemoteAddr 与代理头的请求 → ClientIP → 断言取值
package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// clientIPFor 用给定对端地址与请求头调用 ClientIP。
func clientIPFor(t *testing.T, remoteAddr string, headers map[string]string) string {
	t.Helper()

	gin.SetMode(gin.TestMode)
	req := httptest.NewRequest("POST", "/api/auth/login", nil)
	req.RemoteAddr = remoteAddr
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	return ClientIP(c)
}

// TestClientIP_可信代理_采信代理头 覆盖生产形态：nginx 同机转发。
func TestClientIP_可信代理_采信代理头(t *testing.T) {
	cases := []struct {
		name       string
		remoteAddr string
		headers    map[string]string
		want       string
	}{
		{
			name:       "回环对端优先取 X-Real-IP",
			remoteAddr: "127.0.0.1:54321",
			headers:    map[string]string{"X-Real-IP": "203.0.113.7", "X-Forwarded-For": "198.51.100.9"},
			want:       "203.0.113.7",
		},
		{
			name:       "私网对端同样视为可信代理",
			remoteAddr: "10.1.2.3:40000",
			headers:    map[string]string{"X-Real-IP": "203.0.113.7"},
			want:       "203.0.113.7",
		},
		{
			name:       "无 X-Real-IP 时取 XFF 最左",
			remoteAddr: "127.0.0.1:54321",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.7, 127.0.0.1"},
			want:       "203.0.113.7",
		},
		{
			name:       "IPv4-mapped 写法归一为点分十进制",
			remoteAddr: "[::1]:54321",
			headers:    map[string]string{"X-Real-IP": "::ffff:203.0.113.7"},
			want:       "203.0.113.7",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := clientIPFor(t, tc.remoteAddr, tc.headers); got != tc.want {
				t.Errorf("ClientIP() = %q，期望 %q", got, tc.want)
			}
		})
	}
}

// TestClientIP_不可信对端_忽略伪造代理头 是本文件最重要的一条：
// 攻击者直连（或经第三方代理）时，请求头里的 IP 一律不可信。
func TestClientIP_不可信对端_忽略伪造代理头(t *testing.T) {
	cases := []struct {
		name       string
		remoteAddr string
		headers    map[string]string
		want       string
	}{
		{
			name:       "公网直连时忽略伪造的 X-Real-IP",
			remoteAddr: "198.51.100.23:33333",
			headers:    map[string]string{"X-Real-IP": "1.2.3.4"},
			want:       "198.51.100.23",
		},
		{
			name:       "公网直连时忽略伪造的 X-Forwarded-For",
			remoteAddr: "198.51.100.23:33333",
			headers:    map[string]string{"X-Forwarded-For": "1.2.3.4"},
			want:       "198.51.100.23",
		},
		{
			name:       "两个头一起伪造也不生效",
			remoteAddr: "198.51.100.23:33333",
			headers:    map[string]string{"X-Real-IP": "1.2.3.4", "X-Forwarded-For": "5.6.7.8"},
			want:       "198.51.100.23",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := clientIPFor(t, tc.remoteAddr, tc.headers); got != tc.want {
				t.Errorf("ClientIP() = %q，期望取对端地址 %q", got, tc.want)
			}
		})
	}
}

// TestClientIP_伪造头无法放大尝试次数 说明修复的实际价值：
// 同一攻击者换头重试时，限流桶必须保持不变。
func TestClientIP_伪造头无法放大尝试次数(t *testing.T) {
	first := clientIPFor(t, "198.51.100.23:33333", map[string]string{"X-Real-IP": "1.1.1.1"})
	second := clientIPFor(t, "198.51.100.23:44444", map[string]string{"X-Real-IP": "2.2.2.2"})
	if first != second {
		t.Fatalf("换伪造头后限流键发生变化：%q → %q（限流可被绕过）", first, second)
	}
}
