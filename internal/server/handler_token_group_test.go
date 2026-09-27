// 令牌「所属分组」接口的单元测试。
//
// 意图（Why）：
//
//	给令牌加分组，是为了让"用哪把密钥就走哪个分组"成为可能。但这套能力一旦
//	校验不严就会埋下两类难查的故障：
//	  1) 令牌指向一个不存在的分组 → 调用时无渠道可用（全量 404），且从列表上看不出原因；
//	  2) 更新部分字段时把已配置的分组意外清空 → 令牌静默回退到默认分组，价格随之改变。
//	本组用例把创建/更新的分组语义与校验边界锁死。
//
// 流转（Flow）：
//
//	go test ./internal/server/ -run TokenGroup → httptest 直接调用 Handler（带管理员/用户会话）
//
// 扩展（Extend）：
//
//	新增令牌字段（如限速）时，参照本文件的 fixture 一并补齐断言。
package server

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"gitee.com/xiaosu4610/aqua-api/internal/config"
	"gitee.com/xiaosu4610/aqua-api/internal/crypto"
	"gitee.com/xiaosu4610/aqua-api/internal/model"
	"gitee.com/xiaosu4610/aqua-api/internal/store"
)

// tokenGroupFixture 汇总令牌分组测试所需的仓储、会话与归属用户。
type tokenGroupFixture struct {
	srv      *Server
	tokens   model.TokenRepository
	groups   model.ModelGroupRepository
	orders   model.PaymentOrderRepository
	channels model.ChannelRepository
	adminTok string
	userTok  string
	userID   uint64
}

// newTokenGroupFixture 构造含分组/令牌仓储、带管理员与普通用户会话的最小服务。
func newTokenGroupFixture(t *testing.T) *tokenGroupFixture {
	t.Helper()
	gin.DefaultWriter = io.Discard

	dsn := filepath.Join(t.TempDir(), "token_group_test.db")
	st, err := store.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("打开测试数据库失败: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("执行迁移失败: %v", err)
	}

	cipher, err := crypto.New(testEncryptionKey)
	if err != nil {
		t.Fatalf("构造加密器失败: %v", err)
	}

	cfg := config.Default()
	cfg.Server.Mode = "test"
	cfg.Server.Listen = "127.0.0.1:0"

	ctx := context.Background()
	users := store.NewUserRepository(st.DB())
	sessions := store.NewSessionRepository(st.DB())

	admin := &model.User{
		Username: "token-group-admin", PasswordHash: "test-hash",
		Role: model.UserRoleAdmin, Status: model.UserStatusEnabled, Quota: model.QuotaUnlimited,
	}
	if err := users.Create(ctx, admin); err != nil {
		t.Fatalf("创建管理员失败: %v", err)
	}
	owner := &model.User{
		Username: "token-group-user", PasswordHash: "test-hash",
		Role: model.UserRoleUser, Status: model.UserStatusEnabled, Quota: model.QuotaUnlimited,
	}
	if err := users.Create(ctx, owner); err != nil {
		t.Fatalf("创建普通用户失败: %v", err)
	}

	fx := &tokenGroupFixture{
		tokens:   store.NewTokenRepository(st.DB(), cipher),
		groups:   store.NewModelGroupRepository(st.DB()),
		orders:   store.NewPaymentOrderRepository(st.DB()),
		channels: store.NewChannelRepository(st.DB(), cipher),
		userID:   owner.ID,
		adminTok: createTokenGroupSession(t, sessions, admin.ID),
		userTok:  createTokenGroupSession(t, sessions, owner.ID),
	}
	fx.srv = New(Deps{
		Config:      cfg,
		Store:       st,
		Channels:    fx.channels,
		Groups:      fx.groups,
		Tokens:      fx.tokens,
		Orders:      fx.orders,
		Users:       users,
		Sessions:    sessions,
		Settings:    store.NewSettingRepository(st.DB(), st.Dialect()),
		ModelPrices: store.NewModelPriceRepository(st.DB()),
	})
	return fx
}

// createTokenGroupSession 为用户建立一条有效会话并返回明文令牌。
func createTokenGroupSession(t *testing.T, sessions model.SessionRepository, userID uint64) string {
	t.Helper()
	token := "session-" + strconv.FormatUint(userID, 10) + "-token-group-test"
	if err := sessions.Create(context.Background(), &model.Session{
		UserID:    userID,
		TokenHash: crypto.SHA256Hex(token),
		ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("创建测试会话失败: %v", err)
	}
	return token
}

// findTokenItemByID 在列表响应里按 ID 找到令牌卡片。
func findTokenItemByID(t *testing.T, body map[string]any, id uint64) map[string]any {
	t.Helper()
	raw, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("响应缺少 items 数组：%v", body)
	}
	for _, it := range raw {
		item, ok := it.(map[string]any)
		if !ok {
			continue
		}
		if got, _ := item["id"].(float64); uint64(got) == id {
			return item
		}
	}
	return nil
}

// TestAdminTokenGroup_创建带合法分组 覆盖"带合法分组创建 → 读回一致"。
func TestAdminTokenGroup_创建带合法分组(t *testing.T) {
	fx := newTokenGroupFixture(t)
	ctx := context.Background()

	if err := fx.groups.Create(ctx, &model.ModelGroup{
		Name: "vip", DisplayName: "VIP", Ratio: 150, Enabled: true,
	}); err != nil {
		t.Fatalf("创建分组失败: %v", err)
	}

	reqBody := `{"user_id":` + strconv.FormatUint(fx.userID, 10) +
		`,"name":"分组令牌","unlimited_quota":true,"group_name":"vip"}`
	rec, created := doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/tokens", fx.adminTok, reqBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("创建令牌失败：%d %s", rec.Code, rec.Body.String())
	}
	if group, _ := created["group_name"].(string); group != "vip" {
		t.Fatalf("创建响应 group_name = %q，期望 vip", group)
	}
	id := uint64(created["id"].(float64))
	if id == 0 {
		t.Fatal("创建响应缺少有效 id")
	}

	// 落库校验：读回一致
	stored, err := fx.tokens.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID 失败: %v", err)
	}
	if stored.GroupName != "vip" {
		t.Errorf("落库 GroupName = %q，期望 vip", stored.GroupName)
	}

	// 列表接口透出 group_name
	rec, list := doBearerJSON(t, fx.srv, http.MethodGet, "/api/admin/tokens", fx.adminTok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("查询令牌列表失败：%d %s", rec.Code, rec.Body.String())
	}
	item := findTokenItemByID(t, list, id)
	if item == nil {
		t.Fatal("列表未找到刚创建的令牌")
	}
	if group, _ := item["group_name"].(string); group != "vip" {
		t.Errorf("列表 group_name = %q，期望 vip", group)
	}
}

// TestAdminTokenGroup_创建指向不存在的分组被拒 覆盖"分组不存在 → 400 且信息可读"。
func TestAdminTokenGroup_创建指向不存在的分组被拒(t *testing.T) {
	fx := newTokenGroupFixture(t)

	reqBody := `{"user_id":` + strconv.FormatUint(fx.userID, 10) +
		`,"name":"坏令牌","unlimited_quota":true,"group_name":"not-exist"}`
	rec, body := doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/tokens", fx.adminTok, reqBody)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("不存在的分组应返回 400，实际 %d %s", rec.Code, rec.Body.String())
	}
	if msg := redeemErrorMessage(body); msg != "分组不存在" {
		t.Errorf("错误信息 = %q，期望 %q", msg, "分组不存在")
	}
}

// TestAdminTokenGroup_更新留空不修改分组 覆盖"更新时留空 / 字段缺失不改分组"。
//
// 这是最容易出事故的路径：前端只提交部分字段（如改名、启停）时，
// 若把未提交的分组当成空值写回，令牌会静默回退到默认分组，价格随之变化。
func TestAdminTokenGroup_更新留空不修改分组(t *testing.T) {
	fx := newTokenGroupFixture(t)
	ctx := context.Background()

	if err := fx.groups.Create(ctx, &model.ModelGroup{Name: "vip", Ratio: 150, Enabled: true}); err != nil {
		t.Fatalf("创建分组失败: %v", err)
	}

	// 1) 建一个 vip 分组的令牌
	createBody := `{"user_id":` + strconv.FormatUint(fx.userID, 10) +
		`,"name":"待更新令牌","unlimited_quota":true,"group_name":"vip"}`
	rec, created := doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/tokens", fx.adminTok, createBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("创建令牌失败：%d %s", rec.Code, rec.Body.String())
	}
	id := uint64(created["id"].(float64))
	path := "/api/admin/tokens/" + strconv.FormatUint(id, 10)

	// 2) 更新时【字段缺失】：只改名，不应动分组
	rec, _ = doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok, `{"name":"改名后的令牌"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("更新令牌失败：%d %s", rec.Code, rec.Body.String())
	}
	stored, err := fx.tokens.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID 失败: %v", err)
	}
	if stored.Name != "改名后的令牌" {
		t.Errorf("名称应已更新，实际 %q", stored.Name)
	}
	if stored.GroupName != "vip" {
		t.Fatalf("字段缺失时分组应保持不变，实际 %q", stored.GroupName)
	}

	// 3) 更新时【显式传空串】：按约定同样视为"不修改"
	rec, _ = doBearerJSON(t, fx.srv, http.MethodPut, path, fx.adminTok, `{"name":"再改一次","group_name":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("更新令牌失败：%d %s", rec.Code, rec.Body.String())
	}
	stored, err = fx.tokens.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID 失败: %v", err)
	}
	if stored.GroupName != "vip" {
		t.Fatalf("留空时分组应保持不变，实际 %q", stored.GroupName)
	}
}

// TestTokenGroup_非法分组名被拒 覆盖"大写 / 含空格"两类非法分组名。
func TestTokenGroup_非法分组名被拒(t *testing.T) {
	fx := newTokenGroupFixture(t)

	cases := []struct {
		name  string
		group string
	}{
		{name: "大写", group: "VIP"},
		{name: "含空格", group: "vip gold"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reqBody := `{"user_id":` + strconv.FormatUint(fx.userID, 10) +
				`,"name":"非法分组令牌","unlimited_quota":true,"group_name":"` + tc.group + `"}`
			rec, _ := doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/tokens", fx.adminTok, reqBody)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("非法分组名应返回 400，实际 %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 分组解锁门槛（累计充值解锁低价分组）
// ---------------------------------------------------------------------------

// withGatedGroup 建一个带充值门槛的分组，并挂一个启用渠道。
//
// 渠道不是可有可无的：门户分组下拉（/api/user/groups）只下发"有启用渠道在服务"
// 的分组（否则用户选进去必然 503），没有渠道的分组根本不会出现在下拉里。
func (fx *tokenGroupFixture) withGatedGroup(t *testing.T, name string, ratio, thresholdCents int64) {
	t.Helper()
	ctx := context.Background()

	if err := fx.groups.Create(ctx, &model.ModelGroup{
		Name: name, DisplayName: name, Ratio: ratio,
		UnlockMinRechargeCents: thresholdCents, Enabled: true,
	}); err != nil {
		t.Fatalf("创建分组 %s 失败: %v", name, err)
	}
	if err := fx.channels.Create(ctx, &model.Channel{
		Name: name + "-渠道", Type: 1, BaseURL: "https://" + name + ".example.com",
		APIKey: "sk-" + name, Models: []string{name + "-model"}, Group: name,
		Priority: 1, Weight: 1, Status: model.ChannelStatusEnabled,
	}); err != nil {
		t.Fatalf("创建渠道 %s 失败: %v", name, err)
	}
}

// payForUser 为用户造一笔【已支付】的充值订单，金额单位为分。
func payForUser(t *testing.T, repo model.PaymentOrderRepository, userID uint64, tradeNo string, cents int64) {
	t.Helper()
	ctx := context.Background()

	order := &model.PaymentOrder{
		TradeNo: tradeNo, UserID: userID, Amount: cents, Currency: "CNY",
		Quota: cents * 100, Method: model.PaymentMethodManual,
		Status: model.PaymentStatusPending, ExpiresAt: time.Now().Add(30 * time.Minute),
	}
	if err := repo.Create(ctx, order); err != nil {
		t.Fatalf("创建订单失败: %v", err)
	}
	if _, err := repo.MarkPaid(ctx, tradeNo, "", "", time.Now()); err != nil {
		t.Fatalf("标记支付失败: %v", err)
	}
}

// findGroupItem 在分组列表响应里按 name 找到分组卡片。
func findGroupItem(body map[string]any, name string) map[string]any {
	raw, ok := body["items"].([]any)
	if !ok {
		return nil
	}
	for _, it := range raw {
		item, ok := it.(map[string]any)
		if !ok {
			continue
		}
		if got, _ := item["name"].(string); got == name {
			return item
		}
	}
	return nil
}

// TestTokenGroup_充值门槛未达标被拒_达标后放行 覆盖分组解锁门槛的完整边界。
//
// 为什么这条最要紧：分组是【用户自选】的。若只在界面上把未解锁的分组置灰，
// 用户直接调接口就能把令牌挂到 5 折分组上——站长的定价策略被无声绕过，
// 账单上只看到毛利变薄，查不出原因。因此这里同时锁死门户与后台两条入口。
func TestTokenGroup_充值门槛未达标被拒_达标后放行(t *testing.T) {
	fx := newTokenGroupFixture(t)
	// 大客户分组：5 折，累计充值满 100 元（10000 分）解锁
	fx.withGatedGroup(t, "billing_vip", 50, 10000)

	const createBody = `{"name":"低价令牌","unlimited_quota":true,"group_name":"billing_vip"}`

	// 1) 门户侧：累计充值 0 → 403，且错误信息要能自我解释（含门槛金额）
	rec, body := doBearerJSON(t, fx.srv, http.MethodPost, "/api/user/tokens", fx.userTok, createBody)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("未达标应返回 403，实际 %d %s", rec.Code, rec.Body.String())
	}
	if msg := redeemErrorMessage(body); !strings.Contains(msg, "100.00") {
		t.Errorf("错误信息应说明门槛金额，实际 %q", msg)
	}

	// 2) 后台侧：代某用户建令牌同样受门槛约束（门槛看的是归属用户的资格，
	//    不是"谁在操作"），否则管理员通道就成了绕过闸门的后门。
	adminBody := `{"user_id":` + strconv.FormatUint(fx.userID, 10) +
		`,"name":"后台低价令牌","unlimited_quota":true,"group_name":"billing_vip"}`
	rec, _ = doBearerJSON(t, fx.srv, http.MethodPost, "/api/admin/tokens", fx.adminTok, adminBody)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("后台代建也应受门槛约束（403），实际 %d %s", rec.Code, rec.Body.String())
	}

	// 3) 差 1 分：充到 99.99 元仍不达标
	payForUser(t, fx.orders, fx.userID, "pay-threshold-9999", 9999)
	rec, _ = doBearerJSON(t, fx.srv, http.MethodPost, "/api/user/tokens", fx.userTok, createBody)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("99.99 元仍应被拒（403），实际 %d %s", rec.Code, rec.Body.String())
	}

	// 4) 补足到 100.00 元 → 放行
	payForUser(t, fx.orders, fx.userID, "pay-threshold-tail", 1)
	rec, created := doBearerJSON(t, fx.srv, http.MethodPost, "/api/user/tokens", fx.userTok, createBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("达标后应放行，实际 %d %s", rec.Code, rec.Body.String())
	}
	if got, _ := created["group_name"].(string); got != "billing_vip" {
		t.Fatalf("分组应为 billing_vip，实际 %q", got)
	}
}

// TestTokenGroup_更新令牌同样受门槛约束 覆盖"先建普通令牌、再改挂到门槛分组"。
//
// 只堵创建入口是不够的：用户可以先建一个默认分组的令牌，再 PATCH 改分组。
func TestTokenGroup_更新令牌同样受门槛约束(t *testing.T) {
	fx := newTokenGroupFixture(t)
	fx.withGatedGroup(t, "billing_vip", 50, 10000)

	rec, created := doBearerJSON(t, fx.srv, http.MethodPost, "/api/user/tokens", fx.userTok,
		`{"name":"普通令牌","unlimited_quota":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("创建普通令牌失败：%d %s", rec.Code, rec.Body.String())
	}
	id := uint64(created["id"].(float64))
	path := "/api/user/tokens/" + strconv.FormatUint(id, 10)

	rec, body := doBearerJSON(t, fx.srv, http.MethodPatch, path, fx.userTok, `{"group_name":"billing_vip"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("改挂门槛分组应被拒（403），实际 %d %s", rec.Code, rec.Body.String())
	}
	if msg := redeemErrorMessage(body); !strings.Contains(msg, "100.00") {
		t.Errorf("错误信息应说明门槛金额，实际 %q", msg)
	}

	// 落库确认：被拒的修改不能生效（否则前端报错但数据已变，属于最坏情况）
	stored, err := fx.tokens.GetByID(context.Background(), id)
	if err != nil {
		t.Fatalf("GetByID 失败: %v", err)
	}
	if stored.GroupName != "" {
		t.Fatalf("被拒后分组不应被写入，实际 %q", stored.GroupName)
	}
}

// TestMyGroups_下发解锁状态 覆盖门户分组下拉的"是否已解锁"标记。
func TestMyGroups_下发解锁状态(t *testing.T) {
	fx := newTokenGroupFixture(t)
	fx.withGatedGroup(t, "billing_vip", 50, 10000)

	rec, body := doBearerJSON(t, fx.srv, http.MethodGet, "/api/user/groups", fx.userTok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("查询可选分组失败：%d %s", rec.Code, rec.Body.String())
	}
	item := findGroupItem(body, "billing_vip")
	if item == nil {
		t.Fatal("可选分组里应包含 billing_vip（它有启用渠道）")
	}
	if unlocked, _ := item["unlocked"].(bool); unlocked {
		t.Error("未充值时应为未解锁")
	}
	if got, _ := item["unlock_min_recharge_cents"].(float64); int64(got) != 10000 {
		t.Errorf("应下发门槛 10000 分，实际 %v", item["unlock_min_recharge_cents"])
	}
	if got, _ := item["paid_amount_cents"].(float64); int64(got) != 0 {
		t.Errorf("累计充值应为 0，实际 %v", item["paid_amount_cents"])
	}

	payForUser(t, fx.orders, fx.userID, "pay-my-groups-10000", 10000)

	rec, body = doBearerJSON(t, fx.srv, http.MethodGet, "/api/user/groups", fx.userTok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("查询可选分组失败：%d %s", rec.Code, rec.Body.String())
	}
	item = findGroupItem(body, "billing_vip")
	if item == nil {
		t.Fatal("达标后分组仍应在列表里")
	}
	if unlocked, _ := item["unlocked"].(bool); !unlocked {
		t.Error("充值满 100 元后应变为已解锁")
	}
	if got, _ := item["paid_amount_cents"].(float64); int64(got) != 10000 {
		t.Errorf("累计充值应为 10000 分，实际 %v", item["paid_amount_cents"])
	}
}
