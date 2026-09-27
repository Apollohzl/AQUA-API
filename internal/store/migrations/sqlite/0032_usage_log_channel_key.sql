-- 迁移 0032：调用日志记录"服务本次请求的密钥"
--
-- 意图（Why）：
--   渠道密钥池里可能有几十把密钥，各自余额不同（迁移 0022 支持人工录入余额）。
--   但此前日志只记到"渠道"这一层，因此：
--     1) 无法回答"这把密钥到底被用了多少"——余额只能是一个人工维护的静态快照，
--        站长永远看不到"还剩多少"；
--     2) 出问题时无法定位到具体凭据（例如某把密钥持续 401，只能靠猜）。
--
--   本列把"哪把密钥"这一事实固定下来，让"按密钥聚合用量"成为可能，
--   进而结合上游进价（迁移 0031）算出"已消耗 / 剩余"。
--
-- 取值语义（重要）：
--   0 表示【不适用或未采集】，出现在三种情况：
--     a) 渠道使用单密钥模式（历史数据 / 渠道自带密钥，没有池内记录）；
--     b) 请求在选定渠道之前就失败了（无可用渠道）；
--     c) 迁移之前写入的历史日志。
--   展示层必须把 0 当作"未采集"而不是"某个 ID 为 0 的密钥"。
--
-- 设计说明：
--   1) 只加列、不改既有列；默认 0 让全部历史数据的语义完全不变；
--   2) 不加外键：密钥被删除后历史日志仍需保留（删密钥不能连带丢账）；
--   3) 索引 (channel_id, channel_key_id)：后台的核算查询固定是"某渠道下各密钥的
--      用量汇总"，这个组合索引能让它只扫该渠道的相关行。
--
-- 流转（Flow）：
--   relay 选定凭据 → usageEntry.ChannelKeyID → usage_logs.channel_key_id
--     → 后台核算：GROUP BY channel_key_id, model 求 Σtokens
--     → × channel_model_costs 的进价 = 已消耗 → 与 channel_keys.balance 相减 = 剩余
--
-- 扩展（Extend）：
--   新增记账维度时：在本目录追加 NNNN_*.sql，并同步
--   internal/store/usage_log_repo.go 的 usageLogColumns / INSERT / scanUsageLog 三处。

ALTER TABLE usage_logs ADD COLUMN channel_key_id INTEGER NOT NULL DEFAULT 0;

-- 后台核算查询固定按 (渠道, 密钥) 组合过滤与分组
CREATE INDEX IF NOT EXISTS idx_usage_logs_channel_key
    ON usage_logs (channel_id, channel_key_id);
