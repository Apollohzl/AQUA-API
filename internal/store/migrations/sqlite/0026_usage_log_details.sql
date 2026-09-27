-- 迁移 0026：调用日志补齐「用量细节」维度
--
-- 背景（为什么现有的 prompt/completion/total 不够用）：
--   1) 缓存命中：OpenAI 兼容上游会在 usage.prompt_tokens_details.cached_tokens 里
--      回报"输入中有多少 token 命中了上游缓存"。这部分通常按更低价计费，
--      不记下来就无法核对账单、也无法评估"提示词前缀复用"的优化效果。
--   2) 推理 token：推理类模型（o 系列、GLM/DeepSeek 的 reasoning）会给出
--      completion_tokens_details.reasoning_tokens。它计入输出但用户看不到，
--      出账时容易引起争议（"我就看到两行字，怎么扣这么多"），必须单独可查。
--   3) 首 token 延迟（TTFB）：流式体验的关键指标。总耗时 30 秒可能只是回答长，
--      首 token 3 秒和 20 秒对使用者的感受完全不同；不区分就无从优化。
--   4) 输出速率（tokens/s）：把 completion_tokens 除以"首 token 之后的时长"
--      才是真实生成速度；用总耗时算会在长回答上严重低估。
--      new-api 等同类站点普遍把它作为"模型快不快"的核心展示指标。
--
-- 设计说明：
--   - 全部列都给默认值 0，既有数据语义不变（0 = 未采集到，展示为「—」）；
--   - tokens_per_second 用 REAL：它是比率，四舍五入成整数会丢掉
--     "8.5 与 9.4 都显示成 9"这类有意义的差异；
--   - first_token_ms 对非流式请求没有意义（响应一次性返回），此时写 0，
--     展示层据此显示「—」而不是伪造一个"首 token 延迟"。
--
-- 兼容性：只加列、不改既有列与索引；日志写入路径与读取路径同步扩展。

ALTER TABLE usage_logs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE usage_logs ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE usage_logs ADD COLUMN first_token_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE usage_logs ADD COLUMN tokens_per_second REAL NOT NULL DEFAULT 0;
