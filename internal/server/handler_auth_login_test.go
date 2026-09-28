// 登录接口的回归测试。
//
// 意图（Why）：
//
//	这里锁死一次**线上事故**：/api/auth/login 前面挂了"账号维度限流"中间件，
//	它的 keyFunc 需要读请求体里的 username。gin 的 ShouldBindJSON 读完
//	c.Request.Body 即空、且不会自动复原 —— keyFunc 一旦吃掉 body，
//	处理器就再也绑不到参数，**所有账号都登录失败**并返回 invalid_json。
//
//	因此本用例的断言刻意落在"响应码不是 400"上：
//	口令错就该是 401，格式错才是 400。只要这两者被混淆，就说明又有
//	中间件在处理器之前消费了请求体。
//
// 流转（Flow）：
//
//	go test ./internal/server/ -run Login
//
// 扩展（Extend）：
//
//	新增"登录前会读 body 的中间件"（风控、审计等）时，务必在此补一条断言。
package server

import (
	"context"
	"net/http"
	"testing"

	"gitee.com/xiaosu4610/aqua-api/internal/crypto"
	"gitee.com/xiaosu4610/aqua-api/internal/model"
	"gitee.com/xiaosu4610/aqua-api/internal/store"
)

// TestLogin_请求体不被前置中间件吃掉 覆盖"登录前有人读了 body 却没放回"。
func TestLogin_请求体不被前置中间件吃掉(t *testing.T) {
	srv, st := newTestServer(t)
	users := store.NewUserRepository(st.DB())

	hash, err := crypto.HashPassword("correct-password-123")
	if err != nil {
		t.Fatalf("生成口令哈希失败: %v", err)
	}
	u := &model.User{
		Username: "login-regression", PasswordHash: hash,
		Role: model.UserRoleUser, Status: model.UserStatusEnabled, Quota: 0,
	}
	if err := users.Create(context.Background(), u); err != nil {
		t.Fatalf("创建用户失败: %v", err)
	}

	// 口令错误：必须是 401（认证失败），绝不能是 400（请求体格式错误）。
	rec, body := doBearerJSON(t, srv, http.MethodPost, "/api/auth/login", "",
		`{"username":"login-regression","password":"definitely-wrong"}`)
	if rec.Code == http.StatusBadRequest {
		t.Fatalf("口令错误被当成请求体格式错误（请求体被前置中间件吃掉了）：%v", body)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("口令错误应返回 401，实际 %d，body = %v", rec.Code, body)
	}

	// 口令正确：必须能正常登录并下发会话。
	rec, body = doBearerJSON(t, srv, http.MethodPost, "/api/auth/login", "",
		`{"username":"login-regression","password":"correct-password-123"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("正确口令应登录成功，实际 %d，body = %v", rec.Code, body)
	}
	if token, _ := body["session_token"].(string); token == "" {
		t.Fatalf("登录成功但未下发会话令牌：%v", body)
	}
}
