// 本文件验证出站地址护栏的判定边界。
//
// 意图（Why）：
//
//	护栏的"放行边界"和"拦截边界"同样重要：拦多了会把自建上游（局域网
//	Ollama、本机反向代理）一起拦掉，直接打断业务；拦少了则等于没做。
//	因此这里两个方向都要有用例钉住。
//
// 流转（Flow）：
//
//	IsBlocked(ip) → 断言；DialControl 的拒绝路径单独验证
package netguard

import (
	"net"
	"testing"
)

// TestIsBlocked_拦截链路本地与元数据 覆盖必须拦掉的目标。
func TestIsBlocked_拦截链路本地与元数据(t *testing.T) {
	cases := []struct {
		name string
		ip   string
	}{
		{name: "AWS/GCP/Azure 元数据（IPv4 链路本地）", ip: "169.254.169.254"},
		{name: "腾讯云元数据", ip: "169.254.0.23"},
		{name: "链路本地网段起点", ip: "169.254.0.1"},
		{name: "阿里云元数据（CGNAT 网段，需单独列出）", ip: "100.100.100.200"},
		{name: "IPv6 链路本地", ip: "fe80::1"},
		{name: "IPv4-mapped 写法不得绕过", ip: "::ffff:169.254.169.254"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ip := net.ParseIP(tc.ip)
			if ip == nil {
				t.Fatalf("用例 IP 解析失败: %s", tc.ip)
			}
			if !IsBlocked(ip) {
				t.Errorf("IsBlocked(%s) = false，期望 true", tc.ip)
			}
		})
	}
}

// TestIsBlocked_放行正常上游 覆盖绝不能误伤的目标。
//
// 尤其是环回与私网：把局域网/本机的自建上游配成渠道是常见用法。
func TestIsBlocked_放行正常上游(t *testing.T) {
	cases := []struct {
		name string
		ip   string
	}{
		{name: "环回（本机上游）", ip: "127.0.0.1"},
		{name: "IPv6 环回", ip: "::1"},
		{name: "RFC1918 私网 A 段（局域网自建上游）", ip: "10.0.0.5"},
		{name: "RFC1918 私网 B 段", ip: "172.16.3.4"},
		{name: "RFC1918 私网 C 段", ip: "192.168.1.10"},
		{name: "公网地址", ip: "8.8.8.8"},
		{name: "IPv6 公网地址", ip: "2001:4860:4860::8888"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ip := net.ParseIP(tc.ip)
			if ip == nil {
				t.Fatalf("用例 IP 解析失败: %s", tc.ip)
			}
			if IsBlocked(ip) {
				t.Errorf("IsBlocked(%s) = true，期望 false（会误伤正常上游）", tc.ip)
			}
		})
	}
}

// TestDialControl_拒绝元数据地址 验证护栏真正挂在拨号层上。
func TestDialControl_拒绝元数据地址(t *testing.T) {
	if err := DialControl("tcp", "169.254.169.254:80", nil); err == nil {
		t.Error("DialControl 未拦截元数据地址")
	}
	if err := DialControl("tcp", "[fe80::1]:80", nil); err == nil {
		t.Error("DialControl 未拦截 IPv6 链路本地地址")
	}
}

// TestDialControl_放行本机与畸形地址 说明护栏不做"编造错误"这件事。
//
// 解析不出 IP 时应放行，让 Go 的网络栈给出真正的"地址非法"错误。
func TestDialControl_放行本机与畸形地址(t *testing.T) {
	cases := []string{
		"127.0.0.1:11434",
		"10.0.0.5:8000",
		"not-a-real-address", // 无端口，SplitHostPort 失败
	}
	for _, address := range cases {
		if err := DialControl("tcp", address, nil); err != nil {
			t.Errorf("DialControl(%q) = %v，期望放行", address, err)
		}
	}
}
