// Package netguard 为网关的出站请求提供目标地址安全护栏。
//
// 意图（Why）：
//
//	网关会向"使用者配置的地址"发起请求：渠道 base_url、OAuth 令牌端点、
//	Vertex 的 token_uri、拉取上游模型清单时的地址。这类地址属于半可信输入，
//	一旦被指向云厂商的元数据端点（169.254.169.254、100.100.100.200 …），
//	就等于把云主机的临时凭据递出去——这是云上部署最常见的失守方式。
//
//	刻意【不】封禁环回与私网地址：把自建上游（局域网里的 Ollama / vLLM、
//	本机反向代理）配成渠道是这类网关的常见用法，封了会直接打断业务。
//	所以护栏只拦"任何正当上游都不可能用到"的目标：链路本地地址与云元数据地址。
//
// 流转（Flow）：
//
//	http.Transport.DialContext → net.Dialer{Control: DialControl}
//	  → TCP 建连前拿到【已解析】的 IP → 命中黑名单则拒绝连接
//
//	放在 Dial 这一层而不是只校验 URL 字符串，是因为域名可以在"校验通过"
//	之后才解析到内网地址（DNS rebinding）；这里的 address 是解析结果，绕不过去。
//
// 扩展（Extend）：
//
//	要新增封锁网段：在 blockedCIDRs 追加；要新增单点地址：在 blockedIPs 追加。
//	若将来需要"只允许特定网段"的严格模式，把此处改为白名单并在配置里暴露 CIDR 列表。
package netguard

import (
	"fmt"
	"net"
	"syscall"
)

// blockedCIDRs 是禁止拨号的网段。
//
// 169.254.0.0/16 与 fe80::/10 是链路本地地址：只在单个网段内有效，
// 任何"对外提供服务的上游"都不可能部署在这里；而 AWS / GCP / Azure /
// 腾讯云的实例元数据服务恰好都在 169.254.169.254（链路本地）。
var blockedCIDRs = func() []*net.IPNet {
	raw := []string{
		"169.254.0.0/16", // IPv4 链路本地（含各云厂商 169.254.169.254 元数据）
		"fe80::/10",      // IPv6 链路本地
	}
	nets := make([]*net.IPNet, 0, len(raw))
	for _, item := range raw {
		if _, block, err := net.ParseCIDR(item); err == nil {
			nets = append(nets, block)
		}
	}
	return nets
}()

// blockedIPs 是禁止拨号的单个地址。
//
// 100.100.100.200 是阿里云 ECS 的内网元数据服务地址：它在 CGNAT 网段
// （100.64.0.0/10）里而不是链路本地，因此必须单独列出。
var blockedIPs = []net.IP{
	net.ParseIP("100.100.100.200"),
}

// DialControl 可直接赋给 net.Dialer.Control。
//
// 参数 address 是【已经完成 DNS 解析】的 "host:port"，这正是我们要检查的目标：
// 域名解析结果在这里暴露，因此 DNS rebinding 之类的绕过手法在这里失效。
//
// 解析不出 IP 时放行：让 Go 的网络栈自己去报"地址非法"，而不是在这里
// 编造一个误导性的"地址被封锁"错误。
func DialControl(network, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return nil
	}
	if IsBlocked(ip) {
		return fmt.Errorf("netguard: 目标地址 %s 属于禁止访问的网段（链路本地/云元数据）", ip)
	}
	return nil
}

// IsBlocked 判断某个 IP 是否属于禁止访问的目标。
//
// 单独导出是为了让调用方能在"发起请求之前"做一次快速判断（例如给出更友好的错误），
// 而不必等到拨号失败。
func IsBlocked(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, blocked := range blockedIPs {
		if blocked != nil && blocked.Equal(ip) {
			return true
		}
	}
	// 统一按 IPv4/IPv6 规范形式判断，避免 ::ffff:169.254.169.254 这类
	// IPv4-mapped 写法绕过网段匹配。
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	for _, block := range blockedCIDRs {
		if block.Contains(ip) {
			return true
		}
	}
	return false
}
