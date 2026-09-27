-- 迁移 0035：全站通知邮件的群发批次与收件人明细
--
-- 意图（Why）：
--   此前项目只有"单封、面向一个收件人"的发信能力（注册验证码、SMTP 测试），
--   要通知全站用户就只能靠人工或脚本循环，会带来两个很难收拾的问题：
--     1) 中断即重来：进程重启/部署后，已发过的人会被再发一次 —— 重复投递是
--        投诉与垃圾邮件评分上升的第一来源，且用户看到两封一模一样的通知
--        会直接怀疑站点不稳；
--     2) 发完查不到账：谁在什么时候、给多少人发了什么主题、失败了多少，
--        没有任何落库记录，出问题无法复盘。
--
--   因此把"一次群发"变成两张表：批次（进度与状态）+ 收件人（逐人明细）。
--   明细逐人落库是"可断点续发"与"绝不重复发"的唯一依据 ——
--   发信前先看这一行是否已 sent，而不是靠内存里的进度变量（内存一重启就没了）。
--
-- 字段语义：
--   email_broadcasts.status        批次状态：pending 待发 / running 发送中 /
--                                  done 已完成 / canceled 已停止
--   email_broadcasts.subject/body_html
--                                  创建那一刻的【快照】。为什么快照而不是发送时
--                                  再渲染：管理员预览到的内容必须与实际发出去的
--                                  逐字一致；若模板中途被改，预览与实发就会不一致。
--   email_broadcasts.total/sent/failed
--                                  进度计数，仅用于展示；每次推进都由
--                                  RefreshProgress 从收件人表重算，避免计数漂移。
--   email_broadcast_recipients.status
--                                  逐人状态：pending 待发 / sent 已发 / failed 失败。
--                                  fail 也落库（含原因），否则"某某没收到"无法回答。
--
-- 兼容性：
--   只新增两张表，不改任何既有表；升级后既有功能行为完全不变。
--
-- 流转（Flow）：
--   后台创建批次 → 写入快照 + 逐人写入收件人（跳过空邮箱、按邮箱去重）
--     → 后台发送器按 id 升序取 status='pending' 的人，逐封发送并改状态
--     → 每次推进后 RefreshProgress 重算计数；全部处理完置 done
--   进程重启 → 查 status in (pending, running) 的批次 → 继续未发的人
--
-- 扩展（Extend）：
--   新增通知模板：在 internal/mailer/template.go 的目录里加一条（模板键 + 渲染函数），
--   本表结构无需改动（template 列只作分类与审计用）。
--   若要支持"按分组/充值筛选人群"，在创建批次时改收件人筛选条件即可，
--   表结构已经能承载任意人群。

CREATE TABLE IF NOT EXISTS email_broadcasts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    template    TEXT    NOT NULL DEFAULT '',   -- 模板键（分类与审计用，不影响发送内容）
    subject     TEXT    NOT NULL DEFAULT '',   -- 邮件主题（创建时的快照）
    body_html   TEXT    NOT NULL DEFAULT '',   -- 邮件正文（创建时的快照，避免预览与实发不一致）
    status      TEXT    NOT NULL DEFAULT 'pending',
    total       INTEGER NOT NULL DEFAULT 0,    -- 收件人总数
    sent        INTEGER NOT NULL DEFAULT 0,    -- 成功数
    failed      INTEGER NOT NULL DEFAULT 0,    -- 失败数
    created_by  INTEGER NOT NULL DEFAULT 0,    -- 发起的管理员用户 id
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    started_at  INTEGER NOT NULL DEFAULT 0,    -- 0 = 尚未开始
    finished_at INTEGER NOT NULL DEFAULT 0     -- 0 = 尚未结束（含被停止）
);

-- 收件人明细：一对多，逐人一行。
CREATE TABLE IF NOT EXISTS email_broadcast_recipients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    email        TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    error        TEXT    NOT NULL DEFAULT '',  -- 失败原因（成功时为空）
    sent_at      INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
);

-- 同一批次里一个用户只能有一行：这是"重复触发不会重复发"的第一道保证
-- （第二道是发送前逐行检查状态）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_broadcast_recipients_user
    ON email_broadcast_recipients (broadcast_id, user_id);

-- 取待发名单的索引：发送器每次按 (broadcast_id, status, id) 取最前面的 N 条，
-- 没有这个索引时每次都要扫全表并排序。
CREATE INDEX IF NOT EXISTS idx_email_broadcast_recipients_pending
    ON email_broadcast_recipients (broadcast_id, status, id);
