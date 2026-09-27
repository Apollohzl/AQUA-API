-- 修复"首包延迟 / 输出速率"两列的历史错值（一次性数据订正）。
--
-- 背景（为什么需要订正而不是只改代码）：
--   首版采集实现把"抓取到的首个响应分片"一律当作首 token 延迟（TTFB），
--   而非流式响应是一次性返回的——它的"首个分片"其实就是完整响应体。
--   结果是：
--     1) 非流式记录的首包 ≈ 总耗时（线上实测平均首包 11.4s / 平均总耗时 32.9s）；
--     2) 速率算法用"总耗时 − 首包"作分母，该差值趋近于 0，
--        算出的速率高达 99130 t/s（物理上不可能）。
--   代码已改为"只对流式采集 TTFB"并给速率加了 50ms 可信区间下限，
--   但已经落库的当日数据仍是错的，必须在此订正，否则仪表盘会继续展示荒谬数字。
--
-- 执行顺序（重要）：必须先清速率、再清首包。
--   速率那一句要用 "latency_ms - first_token_ms" 判断，一旦先把 first_token_ms 归零，
--   这个条件就永远成立/永远不成立，再也分不出哪些是错值。
--
-- 语义订正后的口径（与代码一致）：
--   非流式请求不采集首包 → first_token_ms 必须为 0；
--   速率仅在生成区间 ≥ 50ms 时才有意义 → 否则置 0（展示层显示「—」）。

-- 1) 清掉由"首包≈总耗时"算出的荒谬速率
UPDATE usage_logs
   SET tokens_per_second = 0
 WHERE tokens_per_second > 0
   AND latency_ms > 0
   AND (first_token_ms >= latency_ms OR latency_ms - first_token_ms < 50);

-- 2) 非流式请求不存在首包延迟，一律归零（与新的采集口径对齐）
UPDATE usage_logs
   SET first_token_ms = 0
 WHERE is_stream = 0
   AND first_token_ms > 0;
