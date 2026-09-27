-- 为「ChatGPT / Codex 订阅账号」补上账号级元数据（迁移 0028）。
--
-- 意图（Why）：
--   订阅账号（OAuth 凭据）与 API Key 有两处本质差异，必须落到数据上才能用起来：
--     1) 调用上游时**必须**带 chatgpt-account-id 头（缺了上游直接拒绝）；
--        这个值来自账号本身，不能靠渠道配置填；
--     2) 账号有套餐（plus / pro / team…）与额度窗口（5 小时 / 7 天用量百分比、
--        重置时间）。站长最关心"哪个账号快满了"，不落库就只能靠人工记。
--
--   为什么不新开一张"账号表"：OAuth 凭据已经作为 channel_keys 的一行存在
--   （见迁移 0007 的设计取舍），账号元数据与它是一对一的，拆表只会多一层 JOIN
--   与一次可能不一致的写入。加列是最小改动且天然保持"凭据与元数据同生共死"。
--
-- 流转（Flow）：
--   channel_keys 一行 → 渠道密钥池调度选中 → 出站头注入 chatgpt-account-id
--   ；额度探测任务写入 quota_* 三列 → 后台密钥池列表展示
--
-- 扩展（Extend）：
--   新增账号级指标（如周窗口用量）：在此加列 + 在 model.ChannelKey 加字段 +
--   在 channel_key_repo.go 的列清单/INSERT/UPDATE/scan 四处同步，缺一处即静默丢数据。

-- account_id 是上游账号标识（chatgpt_account_id），出站时写入 chatgpt-account-id 头。
-- 空串表示未采集：非订阅类凭据（api_key 型）永远为空，属正常。
ALTER TABLE channel_keys ADD COLUMN account_id TEXT NOT NULL DEFAULT '';

-- plan_type 是套餐标识（如 plus / pro / team / enterprise）。
-- 存字符串而不是枚举：上游随时可能新增套餐名，枚举会让新套餐被静默丢弃。
ALTER TABLE channel_keys ADD COLUMN plan_type TEXT NOT NULL DEFAULT '';

-- quota_used_percent 是主额度窗口的已用百分比（0~100）。
-- -1 专门表示"尚未探测"，与真实的 0%（完全没用）区分开——
-- 若用 0 表示未知，界面会把"没查过"显示成"额度充足"，反而误导站长。
ALTER TABLE channel_keys ADD COLUMN quota_used_percent INTEGER NOT NULL DEFAULT -1;

-- quota_reset_at 是额度窗口的重置时间（Unix 秒）；0 表示未知。
-- 用途：额度用满时不必永久摘除账号，而是等到该时刻自动重新参与调度。
ALTER TABLE channel_keys ADD COLUMN quota_reset_at INTEGER NOT NULL DEFAULT 0;

-- quota_checked_at 是上一次探测额度的时间（Unix 秒）；0 表示从未探测。
-- 用途：判断快照是否过时（界面上提示"数据来自 N 分钟前"），并给探测任务做节流。
ALTER TABLE channel_keys ADD COLUMN quota_checked_at INTEGER NOT NULL DEFAULT 0;
