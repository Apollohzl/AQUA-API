-- 迁移 0031：上游进价表（渠道 × 模型）
--
-- 意图（Why）：
--   在此之前只有"下游收多少"（model_prices），没有任何地方记录"上游收我们多少"。
--   缺了它，站长既算不出毛利，也无法把密钥余额变成"还能用多少"——
--   余额因此只能是人工录入的静态快照，用完与否全凭记忆。
--
-- 口径（关键，务必与 model_prices 保持一致）：
--   价格字段同样是「每 100 万 token 的站点额度单位」。
--   与售价同口径是刻意的：毛利 = 售价 − 进价，一次减法即可，
--   不需要引入汇率/币种换算（那是新的错误来源）。
--   若站长想以美元核算，把 1 个额度单位当作 1 美元来填即可，语义自洽。
--
-- 归属维度（与售价的区别）：
--   model_prices 按 group_name（分组）定价 —— 同一模型对免费组/付费组可不同价；
--   本表按 channel_id（渠道）定价 —— 同一模型在不同渠道的成本可能相差数倍
--   （官方直采 / 第三方代理 / 免费额度池）。
--   两者维度不同、各管一个方向，因此不合并到同一张表。
--
-- 设计说明：
--   1) 唯一索引 (channel_id, model)：同一渠道下同一模型名只能有一条成本规则，
--      避免"两条成本谁生效"的歧义；model 支持尾部通配（如 "qwen-*"）；
--   2) 成本全为 0 表示【上游免费】（例如免费额度池）——这是一个明确结论，
--      与"本渠道未录入该模型的成本"（查不到规则）必须区分开：
--      前者可以据此判定"不花钱"，后者是"未知"，拿它扣余额只会产生假数字；
--   3) 不参与任何自动扣费：本表只用于核算与展示（估算消耗、算毛利）。
--      网关无法得知上游真实扣费，自动写回余额会产生与上游对不上的数字
--      （与迁移 0022 的取舍一致）。
--   4) 不加外键：与 0011/0016 保持一致，避免历史脏数据导致启动失败；
--      渠道删除时由业务层调用 DeleteByChannel 清理。
--
-- 流转（Flow）：
--   channel_model_costs → 渠道页「上游计费」编辑 → ReplaceForChannel 整体保存
--     → 后台查询：按 (渠道, 密钥, 模型) 聚合用量 × 本表进价 = 已消耗
--     → 与 channel_keys.balance 相减 = 该密钥剩余（展示层计算，不回写库）
--
-- 扩展（Extend）：
--   新增成本维度时：在本目录追加 NNNN_*.sql，并同步 store/channel_model_cost_repo.go
--   的列清单 / INSERT / scan 与 model/channel_model_cost.go 的结构体。

CREATE TABLE IF NOT EXISTS channel_model_costs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id       INTEGER NOT NULL,               -- 所属渠道
    model            TEXT    NOT NULL,               -- 上游模型名，支持尾部通配 *
    prompt_price     INTEGER NOT NULL DEFAULT 0,     -- 每 1M 输入 token 的成本（额度单位）
    cache_price      INTEGER NOT NULL DEFAULT 0,     -- 每 1M 命中缓存输入的成本；0=按输入价
    completion_price INTEGER NOT NULL DEFAULT 0,     -- 每 1M 输出 token 的成本
    per_call_price   INTEGER NOT NULL DEFAULT 0,     -- 每调用一次的成本（按次计费的上游）
    remark           TEXT    NOT NULL DEFAULT '',    -- 备注（说明定价依据）
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

-- 同一渠道下同一上游模型名唯一：避免"两条成本谁生效"的歧义
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_model_costs_unique
    ON channel_model_costs (channel_id, model);

-- 后台按渠道整表读取（规则数很少，一次全量最简单可靠）
CREATE INDEX IF NOT EXISTS idx_channel_model_costs_channel
    ON channel_model_costs (channel_id);
