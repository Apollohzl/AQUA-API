-- 迁移 0030：敏感词表（请求内容合规过滤）
--
-- 意图（Why）：
--   网关对外提供生成能力，站长为服务提供者，需要对明显违规的输入做最低成本的
--   管控；同时部分上游会因内容违规直接封禁渠道，损失由站长承担。
--   一张可维护的关键词黑名单是"零额外成本、站长完全可控"的兜底手段。
--
-- 设计说明：
--   1) word 上加唯一索引：同名词条只能有一条。若允许重复，删掉一条后另一条
--      仍在生效，站长会以为"删了没用"；
--   2) 匹配不区分大小写（见 model.SensitiveWord.MatchKey），因此唯一性判断在
--      写入前按"小写 + 去首尾空白"归一化，避免 "BadWord" 与 "badword" 同时入库；
--   3) 只存"拦截"这一个语义：不做替换/仅记录。原因是一旦出现两种动作，
--      请求体的改写与日志的联动都会成倍复杂，而收益有限——站长真正需要的是
--      "这条黑名单到底生效了没有"，拦截语义最简单也最可验证；
--   4) category 与 remark 都允许为空：支持"先批量导入词、稍后再归类"的用法。
--
-- 流转（Flow）：
--   sensitive_words（本表） → model.SensitiveWordRepository.List(enabledOnly=true)
--     → 中间件编译为 Aho–Corasick 匹配器（进程内缓存，词表变更后自动重建）
--     → /v1 入口扫描请求正文 → 命中即拒绝，不转发上游、不计费
--
-- 扩展（Extend）：
--   新增词条属性时：在本目录追加 NNNN_*.sql，并同步 store/sensitive_word_repo.go
--   的列清单 / INSERT / UPDATE / scan 四处，以及 model/sensitive_word.go 的结构体。

CREATE TABLE IF NOT EXISTS sensitive_words (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    word       TEXT    NOT NULL,             -- 词条原文（唯一性按小写归一后判定）
    category   TEXT    NOT NULL DEFAULT '',  -- 分类，如「违法违规」，可为空
    enabled    INTEGER NOT NULL DEFAULT 1,   -- 1=启用 0=停用（停用不参与匹配）
    remark     TEXT    NOT NULL DEFAULT '',  -- 备注
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 唯一索引建在"归一化后的词"上：写库时统一写入小写去空白的结果，
-- 因此这里等于"同义词条只能有一条"。
CREATE UNIQUE INDEX IF NOT EXISTS idx_sensitive_words_word
    ON sensitive_words (word);

-- 匹配器构建路径：只取启用词条，整表加载（词条规模在数百条以内，一次全量最简单可靠）
CREATE INDEX IF NOT EXISTS idx_sensitive_words_enabled
    ON sensitive_words (enabled);
