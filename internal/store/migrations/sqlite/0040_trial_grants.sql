-- 迁移 0040：限时试用额度（发放台账）
--
-- 意图（Why）：
--   运营要发「限时试用额」——给全站用户加一笔额度，24 小时内有效、过期自动清除。
--   但 users.quota 是**一个永久池**（额度进去就永不失效），现有体系里没有任何
--   "这笔额度会过期"的表达能力。若直接把试用额加进 quota，到期后无从区分
--   "哪一部分是该回收的"，只能连用户自己充值买来的额度一起扣掉。
--
--   因此新增一张**发放台账**：每发一笔就记一行，到期回收时按行计算"该收回多少"。
--   额度本身仍然进 users.quota（好处：不动鉴权/预扣/结算这条热路径，
--   并发与幂等语义完全沿用既有实现），台账只负责回答"这笔钱到期该退多少"。
--
-- 回收额是怎么算出来的（这是本表存在的全部意义，改动前务必先看懂）：
--   约定「试用额先花、自己的余额后花」（对用户有利，也便于记账）。于是：
--     S（发放后花掉的量） = max(0, 用户当前 used_quota − used_baseline)
--     应回收             = max(0, amount − S)      -- 没花掉的部分
--     再按用户当前剩余额度封顶，避免把人扣成负数
--   其中 used_baseline 是**发放瞬间**该用户 used_quota 的快照——没有它就无法区分
--   "花掉的是试用额"还是"花掉的是自己充的钱"，会误扣用户的自有余额。
--
-- 字段语义：
--   user_id        收件用户
--   batch          批次标识（同一次发放共用一个值；唯一性由发放逻辑校验，用于防重复发放）
--   amount         本次发放的额度（内部单位）
--   used_baseline  发放瞬间 users.used_quota 的快照（回收计算的基准，见上）
--   status         pending=在效期内 / reclaimed=已到期并回收完毕
--   expires_at     到期时间（unix 秒）；到点后由后台回收协程清除未用完的部分
--   reclaimed_amount 实际回收走的额度（0 表示"用户已全部用完"，属正常结果）
--   created_at / reclaimed_at 发放与回收时间（unix 秒；reclaimed_at=0 表示尚未回收）
--
-- 为什么用 status 而不是靠 expires_at 判断"是否已回收"：
--   回收是一个有副作用的过程（要改 users.quota），必须有个明确的终态把
--   "还没轮到"与"已经处理完"分开，否则回收协程会反复处理同一行、重复扣款。
--
-- 流转（Flow）：
--   store.trialGrantRepository.GrantAll
--     → 写台账（快照 used_quota）+ users.quota += amount
--   → cmd/ltzy 的定时协程 runTrialGrantReclaimer
--     → store.trialGrantRepository.ReclaimExpired
--       → 台账置 reclaimed + users.quota -= 应回收
--   → 门户 GET /api/user/trial（ActiveFor）读出"还剩多少、几时过期"给前端展示
--
-- 扩展（Extend）：
--   若将来要支持"只发给某类用户"（如仅新注册用户），在发放 SQL 的 WHERE 上加条件即可，
--   台账结构与回收逻辑无需改动；若要支持"多次叠加发放"，现有按行回收的写法天然支持。

CREATE TABLE IF NOT EXISTS trial_grants (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    batch            TEXT    NOT NULL DEFAULT '',
    amount           INTEGER NOT NULL,
    used_baseline    INTEGER NOT NULL DEFAULT 0,
    status           TEXT    NOT NULL DEFAULT 'pending',
    expires_at       INTEGER NOT NULL DEFAULT 0,
    reclaimed_amount INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL DEFAULT 0,
    reclaimed_at     INTEGER NOT NULL DEFAULT 0
);

-- 回收协程的扫描路径：取"在效期内且已到期"的行。
CREATE INDEX IF NOT EXISTS idx_trial_grants_status_expires
    ON trial_grants (status, expires_at);

-- 门户展示路径：按用户取其在效期内的发放记录。
CREATE INDEX IF NOT EXISTS idx_trial_grants_user_status
    ON trial_grants (user_id, status);

-- 防重复发放的**最终护栏**：同一批次对同一用户只允许一行。
--
-- 为什么不能只靠发放逻辑里的"先查批次是否存在"：那是"先读后写"，并发下两次
-- 相同批次的请求会同时通过检查，等于给全站发双份。把这个唯一性交给数据库，
-- 重复插入会直接报唯一冲突，发放事务整体回滚，一分钱都不会多出去。
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_grants_batch_user
    ON trial_grants (batch, user_id);
