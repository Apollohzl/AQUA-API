// 本文件是支付通道注册表：描述"支持哪些支付通道、每个通道要填哪些字段、
// 哪些字段属于密钥（只能走环境变量）、回调地址长什么样"。
//
// 意图（Why）：
//
//	支付通道会不断增加（易支付、Stripe、支付宝、微信、PayPal…），每个通道的
//	参数又各不相同。若把这些字段硬编码到设置模型或前端表单里，每加一个通道
//	都要同时改后端模型、存取映射、校验、后台页面四处，极易漏改。
//	因此把"通道与字段"做成数据（本注册表），后台界面据此**触发式渲染**：
//	站长勾选启用哪个通道，才展开该通道需要填的字段，没勾选的一律不出现 ——
//	避免把十几个通道、几十个字段平铺给使用者（小白站长根本不知道该填哪个）。
//
//	同一个注册表还承担两件事：
//	  1) 声明每个字段的**存储位置**：非密钥存设置表（Params），密钥只走环境变量；
//	  2) 声明适配器是否**已实现**（Available），未实现的通道在后台显示为
//	     "即将支持"，不允许勾选 —— 绝不让使用者开启一个注定失败的通道。
//
// 流转（Flow）：
//
//	后台：GET /api/admin/payment/channels → Channels() + 已填值 + 密钥就绪状态
//	      → 前端渲染通道清单（勾选）与各通道字段（勾选后才展开）
//	下单：server → Registry.Get(通道名) → Provider.Create
//	回调：server → Registry.Get(通道名) → Provider.ParseNotify（验签 + 金额比对）
//
// 扩展（Extend）：
//
//	新增一个支付通道，按三步：
//	  1) 在 Channels() 里登记一条（字段、密钥环境变量名、回调路径、Available）；
//	  2) 实现 Provider（Name / Create / ParseNotify），在 NewRegistry 注册；
//	  3) 该通道的密钥字段一律用 SourceSecret，并在部署文档里写清怎么申请。
//	注意：新增通道**不需要**改设置模型、设置表结构或后台表单代码。
package payment

import (
	"fmt"
	"sort"
	"strings"
)

// FieldSource 说明一个字段的值从哪里来。
type FieldSource string

const (
	// SourceSetting 字段值存在设置表（可在后台修改）。
	SourceSetting FieldSource = "setting"
	// SourceSecret 字段值是密钥，只从环境变量读取；
	// 后台只展示"是否已就绪"，永不回显内容，也不写入数据库。
	SourceSecret FieldSource = "secret"
)

// FieldKind 决定后台渲染成什么控件。
type FieldKind string

const (
	KindText   FieldKind = "text"
	KindNumber FieldKind = "number"
	KindList   FieldKind = "list" // 逗号分隔的多值
	KindSelect FieldKind = "select"
	KindSwitch FieldKind = "switch"
)

// FieldOption 是下拉选项。
type FieldOption struct {
	Value string
	Label string
}

// Field 描述支付通道的一个配置字段。
//
// 为什么由后端描述字段：字段名、是否必填、默认值、密钥来自哪个环境变量，
// 这些都是"该支付通道需要什么"的知识，只有后端知道。放前端会出现
// "后端加了字段、前端忘了加输入框"的静默漏配。
type Field struct {
	// Key 字段标识，存储键为 "<通道>.<Key>"（SourceSetting 时）。
	Key string
	// Label 中文标签。
	Label string
	// Kind 控件类型。
	Kind FieldKind
	// Source 取值来源。
	Source FieldSource
	// EnvVar 当 Source=SourceSecret 时，对应的环境变量名（如 AQUA_EPAY_KEY）。
	EnvVar string
	// Placeholder 输入框占位示例。
	Placeholder string
	// Help 一行说明：这个值去哪儿拿、留空会怎样。
	Help string
	// Default 默认值（为空表示没有默认值）。
	Default string
	// Required 是否必填（SourceSecret 时表示"没有它通道不可用"）。
	Required bool
	// Options 当 Kind=KindSelect 时的候选。
	Options []FieldOption
}

// Channel 描述一个支付通道。
type Channel struct {
	// Key 通道标识（与 model.PaymentMethod* 对应），同时用于存储键前缀与回调路径。
	Key string
	// Label 展示名（如「易支付」）。
	Label string
	// Description 一句话说明适用场景，帮助站长选对通道。
	Description string
	// Available 为 false 表示适配器尚未实现：后台显示"即将支持"，不允许勾选。
	Available bool
	// NotifyPath 是回调地址的路径部分，后台会拼上站点地址展示给站长，
	// 便于他直接复制到支付平台的后台（这一步配错是最常见的"付了钱不到账"原因）。
	NotifyPath string
	// Fields 该通道需要配置的字段（勾选启用后才在界面上展开）。
	Fields []Field
}

// SettingKey 返回字段在设置表 Params 里的键（"<通道>.<字段>"）。
func (c Channel) SettingKey(fieldKey string) string {
	return c.Key + "." + fieldKey
}

// SecretFields 返回该通道的密钥字段（只走环境变量）。
func (c Channel) SecretFields() []Field {
	return c.filterFields(SourceSecret)
}

// SettingFields 返回该通道存设置表的字段。
func (c Channel) SettingFields() []Field {
	return c.filterFields(SourceSetting)
}

func (c Channel) filterFields(source FieldSource) []Field {
	result := make([]Field, 0, len(c.Fields))
	for _, field := range c.Fields {
		if field.Source == source {
			result = append(result, field)
		}
	}
	return result
}

// MissingSecrets 返回该通道缺失的密钥环境变量名（全部就绪时返回空切片）。
//
// lookup 由调用方注入（生产用 os.LookupEnv，测试用假实现），
// 这样本包不必直接依赖进程环境，便于单测"缺密钥时通道不可用"。
func (c Channel) MissingSecrets(lookup func(string) (string, bool)) []string {
	missing := make([]string, 0, len(c.Fields))
	for _, field := range c.SecretFields() {
		if field.EnvVar == "" {
			continue
		}
		if value, ok := lookup(field.EnvVar); !ok || strings.TrimSpace(value) == "" {
			missing = append(missing, field.EnvVar)
		}
	}
	return missing
}

// Channels 返回全部已登记的支付通道（顺序固定，便于界面稳定展示）。
//
// 顺序约定：把"最省事"的放前面（人工确认 → 国内聚合支付 → 海外），
// 让站长从上往下读就能做决定。
func Channels() []Channel {
	return []Channel{
		{
			Key:   "manual",
			Label: "人工确认",
			Description: "不需要任何在线支付通道：用户下单后线下转账，你在后台点「确认入账」。" +
				"自用或小规模运营用这个最省事。",
			Available:  true,
			NotifyPath: "",
			Fields:     nil,
		},
		{
			Key:   "epay",
			Label: "易支付（国内聚合）",
			Description: "一套协议同时支持支付宝与微信扫码，接入成本最低，适合面向国内用户。" +
				"可在下方选择开通哪些支付方式。",
			Available:  true,
			NotifyPath: "/api/payments/epay/notify",
			Fields: []Field{
				{
					Key: "gateway", Label: "网关地址", Kind: KindText, Source: SourceSetting,
					Placeholder: "https://pay.example.com",
					Help:        "易支付平台的站点地址，不要带结尾斜杠。",
					Required:    true,
				},
				{
					Key: "pid", Label: "商户号（PID）", Kind: KindText, Source: SourceSetting,
					Placeholder: "1001",
					Help:        "易支付平台「商户资料」里的商户 ID。",
					Required:    true,
				},
				{
					Key: "types", Label: "开通的支付方式", Kind: KindList, Source: SourceSetting,
					Placeholder: "alipay,wxpay",
					Help: "勾选你在易支付平台实际开通的方式（可多选）。" +
						"这里勾了什么，用户充值时就只能看到什么；填错会导致用户看不到对应入口。",
					Required: true,
					// Options 让后台渲染成"带中文名的可勾选项"，
					// 而不是让站长手打 alipay/wxpay —— 手打最容易拼错，
					// 而拼错的后果是"用户看不到微信入口"这种不报错的静默故障。
					Options: subMethodOptions("epay"),
				},
				{
					Key: "key", Label: "商户密钥", Kind: KindText, Source: SourceSecret,
					EnvVar:   "AQUA_EPAY_KEY",
					Help:     "易支付平台「商户资料」里的商户密钥。属于密钥，只能通过环境变量注入，后台只显示是否就绪。",
					Required: true,
				},
			},
		},
		{
			Key:         "stripe",
			Label:       "Stripe（海外）",
			Description: "面向海外用户的信用卡支付。需要 Stripe 账号与两个密钥。",
			Available:   true,
			NotifyPath:  "/api/payments/stripe/notify",
			Fields: []Field{
				{
					Key: "secret_key", Label: "Secret Key", Kind: KindText, Source: SourceSecret,
					EnvVar:   "AQUA_STRIPE_SECRET_KEY",
					Help:     "Stripe 后台 Developers → API keys 里的 Secret key（sk_live_ 或 sk_test_）。",
					Required: true,
				},
				{
					Key: "webhook_secret", Label: "Webhook 签名密钥", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_STRIPE_WEBHOOK_SECRET",
					Help: "Stripe 后台 Webhooks 端点里的 Signing secret（whsec_ 开头）。" +
						"没有它就无法校验回调真伪，因此属于必填。",
					Required: true,
				},
				{
					Key: "note", Label: "结账页商品名", Kind: KindText, Source: SourceSetting,
					Placeholder: "账户充值",
					Help:        "用户在 Stripe 收银台看到的商品名称。",
					Default:     "账户充值",
				},
			},
		},
		{
			Key:         "alipay",
			Label:       "支付宝（官方）",
			Description: "支付宝开放平台的当面付/电脑网站支付。资金直接进自己的支付宝商户，费率与到账更可控。",
			Available:   true,
			NotifyPath:  "/api/payments/alipay/notify",
			Fields: []Field{
				{Key: "app_id", Label: "App ID", Kind: KindText, Source: SourceSetting, Required: true,
					Help: "支付宝开放平台应用详情页的 APPID。"},
				{Key: "gateway", Label: "网关地址", Kind: KindText, Source: SourceSetting,
					Default: "https://openapi.alipay.com/gateway.do",
					Help:    "默认即为支付宝生产网关；沙箱环境才需要改。"},
				{Key: "private_key", Label: "应用私钥", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_ALIPAY_PRIVATE_KEY", Required: true,
					Help: "自己生成的应用私钥（PEM）。只走环境变量。"},
				{Key: "public_key", Label: "支付宝公钥", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_ALIPAY_PUBLIC_KEY", Required: true,
					Help: "用于校验回调签名。只走环境变量。"},
			},
		},
		{
			Key:         "wechatpay",
			Label:       "微信支付（官方）",
			Description: "微信支付商户平台的 APIv3。需要商户号、证书序列号与 APIv3 密钥。",
			Available:   true,
			NotifyPath:  "/api/payments/wechatpay/notify",
			Fields: []Field{
				{Key: "mch_id", Label: "商户号", Kind: KindText, Source: SourceSetting, Required: true},
				{Key: "app_id", Label: "关联 AppID", Kind: KindText, Source: SourceSetting, Required: true,
					Help: "与商户号绑定的公众号或小程序 AppID。"},
				{Key: "serial_no", Label: "证书序列号", Kind: KindText, Source: SourceSetting, Required: true,
					Help: "商户 API 证书的序列号。"},
				{Key: "api_v3_key", Label: "APIv3 密钥", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_WECHATPAY_APIV3_KEY", Required: true,
					Help: "用于解密回调报文。只走环境变量。"},
				{Key: "private_key", Label: "商户私钥", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_WECHATPAY_PRIVATE_KEY", Required: true,
					Help: "请求签名用的商户私钥（PEM）。只走环境变量。"},
			},
		},
		{
			Key:         "paypal",
			Label:       "PayPal",
			Description: "海外常用的另一种收款方式，适合没有 Stripe 账户的场景。",
			Available:   false,
			NotifyPath:  "/api/payments/paypal/notify",
			Fields: []Field{
				{Key: "client_id", Label: "Client ID", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_PAYPAL_CLIENT_ID", Required: true},
				{Key: "client_secret", Label: "Client Secret", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_PAYPAL_CLIENT_SECRET", Required: true},
			},
		},
		{
			Key:         "creem",
			Label:       "Creem",
			Description: "面向 SaaS/订阅场景的海外收款平台。",
			Available:   false,
			NotifyPath:  "/api/payments/creem/notify",
			Fields: []Field{
				{Key: "api_key", Label: "API Key", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_CREEM_API_KEY", Required: true},
				{Key: "webhook_secret", Label: "Webhook 密钥", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_CREEM_WEBHOOK_SECRET", Required: true},
			},
		},
		{
			Key:         "airwallex",
			Label:       "Airwallex",
			Description: "跨境收单，支持多币种。",
			Available:   false,
			NotifyPath:  "/api/payments/airwallex/notify",
			Fields: []Field{
				{Key: "client_id", Label: "Client ID", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_AIRWALLEX_CLIENT_ID", Required: true},
				{Key: "api_key", Label: "API Key", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_AIRWALLEX_API_KEY", Required: true},
				{Key: "webhook_secret", Label: "Webhook 密钥", Kind: KindText, Source: SourceSecret,
					EnvVar: "AQUA_AIRWALLEX_WEBHOOK_SECRET", Required: true},
			},
		},
	}
}

// FindChannel 按通道标识查找。
func FindChannel(key string) (Channel, bool) {
	key = strings.TrimSpace(key)
	for _, channel := range Channels() {
		if channel.Key == key {
			return channel, true
		}
	}
	return Channel{}, false
}

// AvailableChannels 只返回适配器已实现、可以勾选启用的通道。
func AvailableChannels() []Channel {
	result := make([]Channel, 0, len(Channels()))
	for _, channel := range Channels() {
		if channel.Available {
			result = append(result, channel)
		}
	}
	return result
}

// ChannelKeys 返回全部已登记通道的标识（用于错误信息与校验）。
func ChannelKeys() []string {
	all := Channels()
	keys := make([]string, 0, len(all))
	for _, channel := range all {
		keys = append(keys, channel.Key)
	}
	sort.Strings(keys)
	return keys
}

// ChannelLabel 返回通道展示名；未知通道回退为标识本身。
func ChannelLabel(key string) string {
	if channel, ok := FindChannel(key); ok {
		return channel.Label
	}
	return key
}

// SubMethod 描述一个通道下的"子支付方式"。
//
// 为什么需要它：易支付这类聚合通道只有一个 Provider（一个下单入口，
// 参数是 type=alipay/wxpay），但用户在收银台上真正要选的是"支付宝还是微信"。
// 只把通道名发给前端，用户就只看得到一个「在线支付」，无法表达自己的选择，
// 订单记录里也只剩一个看不出所以然的子方式代码。
// 因此把"通道 → 子方式目录"登记在这里，与通道自身的知识放在一起维护。
type SubMethod struct {
	// Name 是下单时传给支付平台的 type 值（如 alipay）。
	Name string
	// Label 是面向用户展示的中文名（如「支付宝」）。
	Label string
}

// subMethodOptions 把子方式目录转成字段选项（供后台渲染成可勾选项）。
func subMethodOptions(channelKey string) []FieldOption {
	subs := ChannelSubMethods(channelKey)
	if len(subs) == 0 {
		return nil
	}
	options := make([]FieldOption, 0, len(subs))
	for _, item := range subs {
		options = append(options, FieldOption{Value: item.Name, Label: item.Label})
	}
	return options
}

// ChannelSubMethods 返回某通道登记的子支付方式目录。
//
// 返回 nil 表示该通道没有"子方式"概念（如 Stripe、人工确认）——
// 前端据此决定渲染单行还是多行选项。
func ChannelSubMethods(channelKey string) []SubMethod {
	switch strings.TrimSpace(channelKey) {
	case "epay":
		// 常用值取自公开的易支付接口约定；未列出的自定义值仍可用
		// （见 EnabledSubMethods：目录外的值照样下发，只是没有中文名）。
		return []SubMethod{
			{Name: "alipay", Label: "支付宝"},
			{Name: "wxpay", Label: "微信支付"},
			{Name: "qqpay", Label: "QQ 钱包"},
			{Name: "jdpay", Label: "京东支付"},
			{Name: "bank", Label: "网银支付"},
		}
	}
	return nil
}

// SubMethodLabel 返回子方式的展示名；未登记时回退为名字本身。
//
// 回退而不是报错的原因：站长完全可以填平台支持但目录里没有的 type，
// 此时展示原始代码也好过展示空白。
func SubMethodLabel(channelKey, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	for _, item := range ChannelSubMethods(channelKey) {
		if item.Name == name {
			return item.Label
		}
	}
	return name
}

// EnabledSubMethods 按"站长已开通的类型"过滤目录，并保持目录顺序。
//
// enabled 一般来自设置表的 "<通道>.types"。语义要点：
//   - 通道没有子方式概念（目录为 nil，如 Stripe/人工确认）→ 返回 nil：
//     即使设置里误留了值也不展开，免得前端把 Stripe 渲染成好几个入口；
//   - 目录内且已开通的，用中文名下发（用户看到「支付宝」而不是 «alipay»）；
//   - 目录外的自定义值也照样下发，标签回退为原始值（不因目录不全而丢功能）；
//   - enabled 为空时返回 nil：视为"该通道没有子方式"，与目录为 nil 同样处理。
func EnabledSubMethods(channelKey string, enabled []string) []SubMethod {
	catalog := ChannelSubMethods(channelKey)
	if len(catalog) == 0 || len(enabled) == 0 {
		return nil
	}
	wanted := make(map[string]bool, len(enabled))
	for _, item := range enabled {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			wanted[trimmed] = true
		}
	}
	if len(wanted) == 0 {
		return nil
	}

	result := make([]SubMethod, 0, len(wanted))
	for _, item := range catalog {
		if wanted[item.Name] {
			result = append(result, item)
			delete(wanted, item.Name)
		}
	}
	// 目录外的值：保持站长填写的顺序，标签回退为原始代码
	for _, item := range enabled {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" || !wanted[trimmed] {
			continue
		}
		result = append(result, SubMethod{Name: trimmed, Label: trimmed})
		delete(wanted, trimmed)
	}
	return result
}

// HasSubMethod 判断某个子方式是否在候选集合里（下单校验用）。
func HasSubMethod(options []SubMethod, name string) bool {
	name = strings.TrimSpace(name)
	for _, item := range options {
		if item.Name == name {
			return true
		}
	}
	return false
}

// ValidateChannelEnabled 校验"启用这个通道"是否成立。
//
// 这是防止"开了但用不了"的关键闸门：未实现的通道不允许启用，
// 密钥未注入的通道也不允许启用 —— 否则用户会看到支付入口，
// 点下去却下单失败，属于最糟糕的体验。
func ValidateChannelEnabled(channel Channel, lookup func(string) (string, bool)) error {
	if !channel.Available {
		return fmt.Errorf("%w：%s 的接入尚未完成", ErrProviderDisabled, channel.Label)
	}
	if missing := channel.MissingSecrets(lookup); len(missing) > 0 {
		return fmt.Errorf("%w：%s 还缺少密钥环境变量 %s",
			ErrNotConfigured, channel.Label, strings.Join(missing, "、"))
	}
	return nil
}
