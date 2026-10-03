# AGENTS.md —— AI Agent 与协作者代码导读

> 本文件面向 **AI 编程助手** 与 **人类开发者**，目的是让你在最短时间内理解本项目
> 的结构、约定与扩展方式。**修改代码前请先读完本文件。**

---

## 零、不可协商的三条铁律（先读这一节）

> 本节是全项目**最高优先级**的约定。任何协作者、任何 PR、任何 AI Agent 都**不得**以
> 「简化」「统一风格」「减少注释」「减少噪音」等理由**削弱或废止**本节内容。
> 需要调整时必须先开 Issue 由维护者决策（见 [GOVERNANCE.md](GOVERNANCE.md) 第三节）。

1. **文件头三段注释**：每个 Go 源文件顶部必须写「意图（Why）/ 流转（Flow）/ 扩展（Extend）」
   三段注释块，**一段都不能少**（详见第三节）。这是本项目的**招牌规范，不是可选风格**。
2. **小步提交**：一个可独立描述的小步骤完成即提交；提交前必须 `go build ./...` 通过，
   逻辑改动必须 `go test ./...` 通过（详见第四节、第八节）。
3. **不提交敏感信息**：`.private/`、密钥、证书、`.db`、真实生产配置一律不得入库（详见第四节）。

> 换句话再说一遍，方便记住：
> **① 文件头三段注释必须写；② 小步提交必须做；③ 敏感信息必须不提交。**
> 这三条没有例外、没有「这次先算了」。

---

## 一、项目一句话

LTZY-API 是自托管的 LLM API 网关：统一上游（API Key / 订阅账号 / 自托管模型）与下游协议，
负责路由、计费与运营。

## 一之二、仓库布局（重要）

**本仓库的根目录就是「代码目录」本身，仓库内只有代码。**

```
D:\LTZY-API\                （工作区，不是仓库）
├── 代码\                   ← Git 仓库根，此处全部内容会推送到开源仓库
│   ├── cmd\  internal\ web\  项目源码
│   ├── go.mod  LICENSE ...   项目元文件
│   └── .git\                 仓库本体
├── .private\               隐私资料（证书/密钥/凭据）—— 仓库之外，永不入库
├── docs\                   工程文档 —— 仓库之外，永不入库
├── opensource\             参考项目克隆 —— 仓库之外，永不入库
└── .trae\                  AI 本地记忆 —— 仓库之外，永不入库
```

设计意图：把隐私与参考资料放在**仓库之外**，从物理上杜绝误提交，
而不是仅依赖 `.gitignore` 规则（`.gitignore` 仅作防御性冗余保留）。

提交约定：每次提交后由 `.git/hooks/post-commit` 自动推送到远程仓库（GitHub）。

## 二、代码地图（按数据流向）

```
请求进入
  │
  ├─ cmd/ltzy/main.go            程序入口：加载配置 → 初始化依赖 → 启动服务 + 后台任务
  │
  ├─ internal/config/            配置加载（默认值 → 文件 → 环境变量）
  │
  ├─ internal/server/            HTTP 层
  │     ├── server.go             引擎与中间件装配
  │     ├── router.go             路由注册（公开 / 用户 / 管理三组）
  │     ├── middleware/           鉴权 / 限流 / 分组 RPM / 敏感词 / 审计 / CIDR / 语言
  │     ├── handler_*.go          各业务处理器
  │     └── health.go             健康检查（含迁移版本）
  │
  ├─ internal/relay/             核心域：协议适配、选路与计费
  │     ├── relay.go              转发编排（选渠道 → 转换 → 调用 → 回写）
  │     ├── key_select.go         凭据调度（策略 / 冷却 / 粘性 / 失败处置）
  │     ├── credential_cooldown.go 渠道×模型级冷却表
  │     ├── failure_classify.go   失败分类（429/5xx/401/内容审核/空 200）
  │     ├── billing.go            计费、预算闸门、重试率统计、渠道专用价取价
  │     ├── usage.go              用量结算与调用日志落库（含定价版本快照）
  │     ├── openai.go / anthropic.go / gemini.go   下游协议实现
  │     ├── upstream_*.go         上游适配器（openai/anthropic/gemini/codex）
  │     └── model_map.go / oauth.go / probe.go     模型映射 / OAuth 刷新 / 连通性测活
  │
  ├─ internal/model/             领域模型 + 仓储接口（不含 SQL）
  │     ├── channel.go / channel_key.go  渠道与凭据
  │     ├── group.go             分组（倍率 / 门槛 / RPM / 仅后台分发）
  │     ├── model_price.go       价格规则（模型 × 分组 × 渠道）
  │     ├── token.go             令牌（额度 / 分组 / 周期预算）
  │     ├── usage_log.go         调用日志（含 price_version 快照）
  │     └── ...                  用户 / 支付 / 任务 / 兑换码 / 公告 / 审计 等
  │
  └─ internal/store/             持久化实现
        ├── store.go             连接管理 + 迁移执行
        ├── migrations/sqlite/   版本化迁移脚本（NNNN_*.sql，只增不改）
        └── *_repo.go            各仓储的 SQL 实现
```

## 三、注释约定（必须遵守 · 非可选）

> **一句话记牢：文件头三段注释是强制的，正文行内注释要克制。** 二者不冲突 ——
> 强制的是「文件头讲清 Why / Flow / Extend」，克制的是「正文里别复述代码字面」。
> 请勿把「正文从简」误解成「文件头也不用写」。

**每个 Go 源文件头部必须有如下注释块**，三段缺一不可：

```go
// Package xxx 一句话说明本包职责。
//
// 意图（Why）：
//   为什么需要这个包、解决什么问题。
//
// 流转（Flow）：
//   调用方 → 本包 → 下游，写清数据与依赖的走向。
//
// 扩展（Extend）：
//   新增功能时应该改哪些文件、注意哪些联动点。
package xxx
```

其他要求：
- 导出符号（类型/函数/常量）必须有注释，首行以符号名开头。
- 关键或非直觉逻辑写「为什么」，不要复述代码字面意思。
- **正文注释从简**：能在文件头讲清的，不要在每个函数里重复；禁止为显而易见代码逐行加注。
- **命名遵循语言习惯**（Go 用驼峰、语义清晰、不随意缩写）；命名本身说明用途，
  **不要靠注释弥补糟糕命名**。
- `TODO(模块): 说明 —— 原因/计划` 为统一格式。
- 注释语言：中文，专有名词保留英文。

**正例**

```go
// Package billing 负责按调用量结算额度。
//
// 意图（Why）：
//   金额一律用整数「额度」记账，避免浮点误差累积。
//
// 流转（Flow）：
//   relay 转发成功 → billing 结算 → store 落库
//
// 扩展（Extend）：
//   新增计费维度：改 model 取价 + 本包计算 + store 落库，三处同步。
package billing

// reserve 预扣额度。为什么先预扣：请求失败可退还，避免并发超额消费。
func (s *Service) reserve(reqID string) error { ... }
```

**反例（会被要求返工）**

```go
// 这是一个计费包。（一句话带过，缺 Why / Flow / Extend —— 不合格）
package billing

// 遍历 channels（复述代码字面，属噪音）
for _, ch := range channels {
	x := ch.ID // 取 ID（逐行加注，属噪音）
}
```

> 再强调（第三次）：**文件头三段缺一不可；正文注释保持克制。**
> 这条是核心约定，不要再用「统一风格」「减少噪音」之类的理由去削它 —— 削它等于改项目定位。

## 四、强制工程纪律

1. **小步提交**：每个可独立描述的小步骤完成后**立即** `git commit`。
   - 提交前必须 `go build ./...` 通过；逻辑变更必须 `go test ./...` 通过。
   - 一次提交只做一件事；禁止 `git add -A`（避免误入敏感文件）。
   - 提交信息格式：`<类型>(<范围>): <说明>`，如 `feat(config): 新增配置加载与校验`。
2. **禁止提交敏感信息**：`.private/`、密钥、证书、`.db`、真实生产配置。
3. **原创性红线**：**阅读、研究、学习**任何公开项目（含参考实现）是被鼓励的 ——
   理解其功能清单、信息架构与算法思想都属正当；被禁止的只是**逐字复制粘贴**
   （代码、注释、常量表、命名骨架、品牌标识）。
   判据很简单：**能否脱离参考项目，独立解释这套实现的设计取舍**。
   参考项目位于仓库之外的工作区 `D:\LTZY-API\opensource\`。
4. **依赖约束**：本机 **无 gcc、CGO 不可用**，只能引入纯 Go 依赖
   （SQLite 使用 `modernc.org/sqlite`，不要用 `mattn/go-sqlite3`）。

## 四之二、标准流程（每次改动都照此走）

> 再强调一次：本项目的纪律是「**小步提交、步步可运行**」，而**不是**「开发完一次性提交」。
> 每完成一个可独立描述的小步骤，就**立即**提交一次。

```
1) 改代码
2) 自检：go build ./...  →  go test ./...（逻辑改动必跑）  →  go vet ./...（建议）
3) 查看将提交什么：git status --short  +  git diff
4) 精确暂存：git add <具体文件>（禁止 git add -A / git add .）
5) 提交：git commit -m "<类型>(<范围>): <说明>"（一次提交只做一件事）
6) 复核：git status --short
7) 前端改动另跑：cd web && npm run type-check && npm run build
8) 涉及数据库结构：新开递增编号迁移脚本，并跑 go test ./internal/store/...
```

**协作流程（外部贡献者）**：Fork → 建分支 → 开发并验证 → 提 PR → 维护者评审 → 合并
（**不 squash**，保留提交序列）。完整规则见 [CONTRIBUTING.md](CONTRIBUTING.md) 与
[GOVERNANCE.md](GOVERNANCE.md)。

**核心约定的变更**：注释规范、目录分层、分支策略、发行方式等核心约定**只可由维护者决策**，
**不接受外部 PR 单方面废止或削弱**（见 GOVERNANCE.md 第三节）。

## 五、分层与依赖约束

```
cmd  →  config / server / store / model / relay
server → relay / model
relay  → model（仓储接口）
store  → model（实现其接口）
```

- `internal/` 各包之间**禁止循环依赖**。
- `model` 层不感知 HTTP；`server` 层不直接写 SQL。
- 新增仓储：在 `model` 定义接口 → 在 `store` 实现 → 在 `main.go` 注入。

## 六、数据库迁移（重要）

- 迁移脚本在 `internal/store/migrations/sqlite/`，**按递增编号**命名（`0047_xxx.sql`）。
- **只增不改**：已发布的迁移脚本一经提交就不再修改；新增列一律新开一个脚本，
  默认值要保证存量数据升级后行为**逐字不变**。
- 每个脚本头部写清背景、设计说明与兼容性考虑（参考既有脚本的注释风格）。
- `store` 的测试会断言迁移版本连续，新增脚本后请跑 `go test ./internal/store/...`。

## 七、扩展指南

| 想做什么 | 改哪里 |
|---|---|
| 新增配置项 | `internal/config/config.go`：结构体字段 + 默认值 + 环境变量映射 + 校验（四处同步） |
| 新增数据表 / 列 | `migrations/sqlite/` 新开 `NNNN_*.sql` + 在 `model/` 定义实体 + 在 `store/*_repo.go` 同步列清单与扫描逻辑 |
| 新增 HTTP 接口 | `internal/server/router.go` 注册 + 处理器实现（注意归属公开 / 用户 / 管理三组） |
| 新增上游渠道类型 | `internal/channeltype/catalog.go` 登记元数据（默认地址 / 鉴权 / 额外必填 / 能力位），并确认落在 `catalog_test.go` 的已实现白名单内 |
| 新增协议适配器 | `internal/relay/` 下新增适配器，并在上游分派处注册 |
| 新增调度策略 | 在 `model` 加常量并同步 `IsValid/Normalize`，在 `relay/key_select.go` 增加分支，补单测 |
| 新增计费维度 | `model/model_price.go` + `relay/billing.go` 取价 + `store/model_price_repo.go` 读写，三处同步 |
| 新增分组属性 | `model/group.go` + `store/group_repo.go` + 迁移脚本 + 相关 DTO（`server/handler_group.go`） |

## 八、验证方式

```bash
go build ./...     # 必须通过
go test ./...      # 必须通过
go vet ./...       # 建议
gofmt -l .         # 应无输出（表示已格式化）

cd web && npm run type-check && npm run build   # 前端改动必须通过
```

## 九、常见误区

- ❌ 直接 `git add .` —— 会带入忽略规则之外的临时文件。
- ❌ 在 `server` 层写 SQL —— 破坏分层，应走 `model` 接口。
- ❌ 用 `mattn/go-sqlite3` —— 需要 CGO，本机编译失败。
- ❌ 修改已发布的迁移脚本 —— 应新开一个编号脚本。
- ❌ 逐字照抄 `opensource/` 里的实现 —— 违反原创性红线（法律风险）。
- ❌ 把金额写成浮点 —— 全项目金额一律整数「额度」单位，展示层才换算成人民币。
- ❌ 删除或削弱「文件头三段注释」—— 这是**核心约定**，不接受以任何理由
  （含「统一风格」「减少噪音」「减少多行注释」）废止；曾有人据此提 PR，被直接关闭。
- ❌ 把「正文注释从简」理解成「文件头也不用写」—— 两者是**两回事**，文件头永远强制。
- ❌ 把多天的开发攒成一次大提交 —— 必须**小步提交**，完整提交序列是项目的证据链（见 [NOTICE](NOTICE)）。

## 十、几个容易看漏的机制

- **额度单位**：内部一律整数「额度」记账；`quota_per_yuan`（1 元 = N 额度）由站点设置下发，
  前端据此换算展示。不要在前端硬编码比例。
- **定价优先级**：渠道专用价 → 分组默认价（见 `model.MatchModelPriceForChannel`）。
- **结算三段式**：预扣（`quota_reservations`，request_id 唯一索引）→ 结算 → 退还；
  幂等由该唯一索引保证，改计费逻辑时务必保持。
- **失败分类**：`relay/failure_classify.go` 是重试分流的唯一入口，新增失败类型只改这里。
- **分组 RPM**：`server/middleware/group_rate_limit.go`，`rpm_limit=0` 时零成本放行。
- **渠道健康**：`server/channel_health.go` 定时巡检 + 按成功率自动停用（阈值来自环境变量）。
