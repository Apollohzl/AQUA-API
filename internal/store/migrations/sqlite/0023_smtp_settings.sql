-- 迁移 0023：出站邮件（SMTP）配置落库
--
-- 背景（为什么当初"只走环境变量"、现在又要落库）：
--   原设计把 SMTP 账号与口令全部放在环境变量里，理由是"设置表会随备份流出，
--   密钥入库等于把口令散播到备份链条上"。这个取舍对"多租户 SaaS"成立，
--   但对本站的实际形态不成立：这是【单站长自部署】的软件，
--   每个站长的发信账号、发信域名、服务商（阿里云邮件推送 / 腾讯云 / SendGrid / 自建 Postfix）
--   都不一样，要求他们登录服务器改 /etc/aqua/aqua.env 再重启，门槛过高且极易配错。
--   站长在后台填 SMTP 是行业通行做法，因此本迁移把它变成可配置项。
--
-- 风险控制（三条，缺一不可）：
--   1) 口令【加密落库】：password_cipher 存的是用 AQUA_APP_KEY 派生的 AES-GCM 密文
--      （见 internal/crypto）。备份流出数据库时，没有 APP_KEY 依然解不开口令。
--      这与渠道密钥、支付密钥的处理方式完全一致，不是"明文入库"。
--   2) 接口【绝不回传口令】：后台接口只返回 password_set（是否已配置），
--      永不返回明文或密文；前端只能"重填"不能"查看"。
--   3) 环境变量作为【兜底与预设】：未在后台启用本条配置时，系统使用环境变量
--      （AQUA_SMTP_HOST/PORT/USERNAME/FROM/FROM_NAME/PASSWORD）。
--      这样既保留了"用密钥管理系统统一注入"的部署方式，也让首次部署有合理默认值。
--      【优先级规则】后台 enabled=1 时以后台为准，否则以环境变量为准——
--      原因是站长在后台点"启用并保存"就是一个明确意图，若被环境变量静默覆盖，
--      会出现"我明明配好了却不生效"这类最难排查的问题。
--
-- 表设计：单行表（id 恒为 1）。
--   为什么用单行表而不是 KV 设置表：SMTP 是一个"结构化的一整组参数"
--   （host/port/username/from/from_name/password），逐项拆成设置键会让
--   "保存一次配置"变成 6 次键值写入，且类型校验（端口是整数）无处安放。
--   单行表让"配置是否存在"与"最后一次更新时间"都一目了然。
--   用 CHECK (id = 1) 从数据层杜绝出现第二行（多行会让"用哪一行"变得不确定）。

CREATE TABLE IF NOT EXISTS smtp_settings (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    host            TEXT    NOT NULL DEFAULT '',   -- SMTP 服务器，如 smtpdm.aliyun.com
    port            INTEGER NOT NULL DEFAULT 465,  -- 465=SSL 直连（推荐）；587=STARTTLS；25 多数云厂商封禁
    username        TEXT    NOT NULL DEFAULT '',   -- 登录账号（阿里云邮件推送为发信地址本身）
    from_addr       TEXT    NOT NULL DEFAULT '',   -- 发件地址，必须与账号同域且已在服务商处验证
    from_name       TEXT    NOT NULL DEFAULT '',   -- 收件人看到的发件人显示名
    password_cipher TEXT    NOT NULL DEFAULT '',   -- 登录口令的 AES-GCM 密文（空串=未配置）
    enabled         INTEGER NOT NULL DEFAULT 0,    -- 是否启用：0=不启用（回退环境变量），1=启用本配置
    updated_at      INTEGER NOT NULL DEFAULT 0     -- 最后更新时间（Unix 秒）
);
