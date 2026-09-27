// 支付回调（/api/payments/{method}/notify）的 HTTP 层回归测试。
//
// 意图（Why）：
//
//	回调是全站唯一"无需鉴权却会产生资损副作用"的接口，它的两条性质必须被锁死：
//	  1) POST 表单形式的回调（支付宝异步通知、部分易支付实现）必须能被验签通过——
//	     历史上这里用 io.ReadAll 读完 body 后再调 c.Request.ParseForm()，
//	     而 body 已被读空，导致 PostForm 恒为空、验签因"缺少 sign"必然失败，
//	     线上表现为「用户付了钱、订单永远停在待支付」；
//	  2) 同一笔回调重复投递（支付平台会重试）只能入账一次。
//
// 流转（Flow）：
//
//	构造已签名表单 → POST /api/payments/epay/notify → 断言应答、订单状态与用户额度
//
// 扩展（Extend）：
//
//	新增通道时，按同样方式补一条"该通道的回调格式能被解析并验签"的用例；
//	表单/JSON/查询串三种回调形态至少各覆盖一条。
package server

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"gitee.com/xiaosu4610/aqua-api/internal/config"
	"gitee.com/xiaosu4610/aqua-api/internal/crypto"
	"gitee.com/xiaosu4610/aqua-api/internal/model"
	"gitee.com/xiaosu4610/aqua-api/internal/payment"
	"gitee.com/xiaosu4610/aqua-api/internal/relay"
	"gitee.com/xiaosu4610/aqua-api/internal/store"
)

// notifyTestEPayKey 是测试用易支付商户密钥（非真实密钥）。
const notifyTestEPayKey = "test-epay-key-0123456789"

// newNotifyTestServer 装配一个含支付注册表与订单仓储的测试服务。
func newNotifyTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	gin.DefaultWriter = io.Discard

	st, err := store.Open("sqlite", filepath.Join(t.TempDir(), "notify_test.db"))
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
	channels := store.NewChannelRepository(st.DB(), cipher)
	settings := store.NewSettingRepository(st.DB(), st.Dialect())

	cfg := config.Default()
	cfg.Server.Mode = "test"
	cfg.Server.Listen = "127.0.0.1:0"
	// 密钥只走环境变量注入的路径（与生产一致），这里用测试值代替
	cfg.Payment.EPayKey = notifyTestEPayKey

	srv := New(Deps{
		Config:    cfg,
		Store:     st,
		Channels:  channels,
		Tokens:    store.NewTokenRepository(st.DB(), cipher),
		Users:     store.NewUserRepository(st.DB()),
		Sessions:  store.NewSessionRepository(st.DB()),
		Settings:  settings,
		Orders:    store.NewPaymentOrderRepository(st.DB()),
		Referrals: store.NewReferralRepository(st.DB()),
		Relay:     relay.New(channels, relay.Options{}),
		Payment: payment.NewRegistry(payment.Options{
			Secrets: cfg.Payment,
			Settings: func(ctx context.Context) (model.PaymentSettings, error) {
				loaded, err := model.LoadSiteSettings(ctx, settings)
				if err != nil {
					return model.PaymentSettings{}, err
				}
				return loaded.Payment, nil
			},
		}),
	})
	return srv, st
}

// epayTestSign 复算易支付签名，用于在测试里构造"合法回调"。
//
// 与 internal/payment/epay.go 的 epaySign 保持一致：过滤空值与 sign/sign_type →
// 按参数名升序拼 "k=v&k=v" → 末尾拼商户密钥 → MD5 小写十六进制。
func epayTestSign(params map[string]string, key string) string {
	names := make([]string, 0, len(params))
	for name, value := range params {
		if name == "sign" || name == "sign_type" {
			continue
		}
		if strings.TrimSpace(value) == "" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)

	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, name+"="+params[name])
	}
	sum := md5.Sum([]byte(strings.Join(parts, "&") + key))
	return hex.EncodeToString(sum[:])
}

// TestPaymentNotify_表单回调_验签通过并幂等入账 覆盖"表单能解析 + 只入账一次"。
func TestPaymentNotify_表单回调_验签通过并幂等入账(t *testing.T) {
	srv, _ := newNotifyTestServer(t)
	ctx := context.Background()

	buyer := &model.User{
		Username:     "notify-buyer",
		PasswordHash: "test-hash",
		Email:        "buyer@example.com",
		Role:         model.UserRoleUser,
		Status:       model.UserStatusEnabled,
		Quota:        0,
	}
	if err := srv.deps.Users.Create(ctx, buyer); err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}

	const orderQuota = int64(10000)
	order := &model.PaymentOrder{
		TradeNo:  "pay20260101000001abcdef",
		UserID:   buyer.ID,
		Amount:   1000, // 10.00 元
		Currency: "CNY",
		Quota:    orderQuota,
		Method:   "epay",
		Status:   model.PaymentStatusPending,
	}
	if err := srv.deps.Orders.Create(ctx, order); err != nil {
		t.Fatalf("创建测试订单失败: %v", err)
	}

	params := map[string]string{
		"pid":          "1001",
		"type":         "alipay",
		"out_trade_no": order.TradeNo,
		"trade_no":     "T2026010100001",
		"name":         "充值",
		"money":        "10.00",
		"trade_status": "TRADE_SUCCESS",
	}
	params["sign"] = epayTestSign(params, notifyTestEPayKey)
	params["sign_type"] = "MD5"

	form := url.Values{}
	for name, value := range params {
		form.Set(name, value)
	}

	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/payments/epay/notify",
			strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		return rec
	}

	// 第一次回调：必须验签通过（若表单未被解析，这里会因缺少 sign 返回 400）
	rec := post()
	if rec.Code != http.StatusOK {
		t.Fatalf("表单回调状态码 = %d，期望 200（响应体: %s）", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "success" {
		t.Errorf("回调应答 = %q，期望 %q（易支付要求原样返回 success）", got, "success")
	}

	paid, err := srv.deps.Orders.GetByTradeNo(ctx, order.TradeNo)
	if err != nil {
		t.Fatalf("读取订单失败: %v", err)
	}
	if paid.Status != model.PaymentStatusPaid {
		t.Errorf("订单状态 = %v，期望已支付", paid.Status)
	}
	if !paid.IsCredited() {
		t.Error("订单未被标记入账")
	}

	afterFirst, err := srv.deps.Users.GetByID(ctx, buyer.ID)
	if err != nil {
		t.Fatalf("读取用户失败: %v", err)
	}
	if afterFirst.Quota != orderQuota {
		t.Fatalf("首次入账后额度 = %d，期望 %d", afterFirst.Quota, orderQuota)
	}

	// 第二次回调（支付平台重试）：必须幂等，额度不再增加
	if rec := post(); rec.Code != http.StatusOK {
		t.Fatalf("重复回调状态码 = %d，期望 200", rec.Code)
	}
	afterSecond, err := srv.deps.Users.GetByID(ctx, buyer.ID)
	if err != nil {
		t.Fatalf("读取用户失败: %v", err)
	}
	if afterSecond.Quota != orderQuota {
		t.Errorf("重复回调后额度 = %d，期望仍为 %d（重复入账）", afterSecond.Quota, orderQuota)
	}
}

// TestPaymentNotify_签名错误_拒绝且不入账 覆盖"验签失败即拒绝"。
//
// 用错误密钥签出的回调必须被拒，且不得改变订单状态与用户额度。
func TestPaymentNotify_签名错误_拒绝且不入账(t *testing.T) {
	srv, _ := newNotifyTestServer(t)
	ctx := context.Background()

	buyer := &model.User{
		Username:     "notify-buyer-2",
		PasswordHash: "test-hash",
		Email:        "buyer2@example.com",
		Role:         model.UserRoleUser,
		Status:       model.UserStatusEnabled,
		Quota:        0,
	}
	if err := srv.deps.Users.Create(ctx, buyer); err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}

	order := &model.PaymentOrder{
		TradeNo:  "pay20260101000002abcdef",
		UserID:   buyer.ID,
		Amount:   1000,
		Currency: "CNY",
		Quota:    10000,
		Method:   "epay",
		Status:   model.PaymentStatusPending,
	}
	if err := srv.deps.Orders.Create(ctx, order); err != nil {
		t.Fatalf("创建测试订单失败: %v", err)
	}

	params := map[string]string{
		"pid":          "1001",
		"out_trade_no": order.TradeNo,
		"money":        "10.00",
		"trade_status": "TRADE_SUCCESS",
	}
	// 刻意用错误密钥签名
	params["sign"] = epayTestSign(params, "wrong-key")

	form := url.Values{}
	for name, value := range params {
		form.Set(name, value)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/payments/epay/notify", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("错误签名状态码 = %d，期望 400", rec.Code)
	}

	stored, err := srv.deps.Orders.GetByTradeNo(ctx, order.TradeNo)
	if err != nil {
		t.Fatalf("读取订单失败: %v", err)
	}
	if stored.Status != model.PaymentStatusPending {
		t.Errorf("订单状态被错误签名改变为 %v", stored.Status)
	}
	after, err := srv.deps.Users.GetByID(ctx, buyer.ID)
	if err != nil {
		t.Fatalf("读取用户失败: %v", err)
	}
	if after.Quota != 0 {
		t.Errorf("错误签名回调后额度 = %d，期望 0", after.Quota)
	}
}
