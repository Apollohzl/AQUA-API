-- 迁移 0037：渠道级 / 模型级「上游错误重试」策略
--
-- 意图（Why）：
--   在此之前，网关是否重试上游错误是【硬编码】的：
--     · 渠道级失败（连接失败、500/502/503/504/529）→ 最多换 3 个渠道；
--     · 密钥级失败（401/403/402/429）→ 同渠道内换密钥，最多 8 次尝试。
--   站长无法按渠道/模型调节这些行为，而不同上游的诉求恰恰相反：
--     · 免费额度池：希望"多试几把密钥"，把可恢复的限流/无权限在站内消化掉，
--       下游几乎看不到 4xx/5xx —— 这是"降低下游错误率"的主要手段；
--     · 按次计费或强幂等要求的上游：重复请求可能造成重复扣费或副作用，
--       希望【一次就够】，失败立刻（脱敏后）回给下游，由调用方决定是否重试。
--
-- 三列语义（第一列是总开关，另两列是它的参数）：
--   retry_enabled       —— 是否允许对本渠道的上游错误做站内重试（默认 1 = 允许）。
--                          置 0 时：本次请求对上游【只尝试一次】，既不换密钥
--                          也不换渠道，上游一报错立即脱敏回下游。
--   retry_max_attempts  —— 渠道级重试次数上限；0（默认）表示沿用内置默认（3 次）。
--                          只在 retry_enabled = 1 时有意义。
--   model_retry_rules   —— 模型级覆盖规则（JSON 数组），形如：
--                            [{"model":"gpt-4o","enabled":true,"max_attempts":5},
--                             {"model":"dall-e-*","enabled":false}]
--                          model 支持尾部通配符 *（与 model_prices / channel_model_costs
--                          的约定一致）；解析顺序为「精确匹配 → 最长通配前缀 → 渠道级」。
--                          数组里没有该模型 = 该模型沿用渠道级配置（无需写继承标记）。
--
-- 兼容性（重要）：
--   三个默认值（1 / 0 / '[]'）恰好等价于迁移前的硬编码行为：
--   允许重试、渠道预算取内置默认。因此升级后既有渠道行为完全不变，
--   需要改的站长在渠道编辑页里显式调整即可，无需数据回填。
--
-- 流转（Flow）：
--   channels.retry_* → store/channel_repo.go 读写 → model.Channel.RetryPolicyFor(模型名)
--     → relay.forwardWithFallback 决定"尝试几次、要不要换密钥/换渠道"
--
-- 扩展（Extend）：
--   若将来要支持"按分组"或"按令牌"的重试预算，在本目录追加 NNNN_*.sql，
--   并在 model/channel.go 的 RetryPolicyFor 里补充解析层级（注意保持"越具体越优先"）。

ALTER TABLE channels ADD COLUMN retry_enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE channels ADD COLUMN retry_max_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE channels ADD COLUMN model_retry_rules TEXT NOT NULL DEFAULT '[]';
