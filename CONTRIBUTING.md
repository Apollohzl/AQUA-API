# 贡献指南

感谢你愿意为 LTZY-API 贡献代码。请先阅读 [README.md](README.md) 了解项目定位，
再按本指南参与。

## 一、协作模式（Fork + Pull Request）

本仓库采用 **fork 分支协作制**，两条约定构成全部规则：

1. **`main` 分支受保护**：只有维护者可以直接推送。任何人（包括贡献者）
   都不能直接向 `main` 提交，这保证主分支始终可编译、可回滚。
2. **贡献在 fork 里进行**：你在自己的仓库副本里可以开任意数量的分支
   （`feature/xxx`、`fix/xxx`，命名不限），自由开发自己的版本；
   想把改动合入主仓库时，通过 Pull Request 提交，经审查后合并。

```
你的 fork                       主仓库（受保护）
  main ──┬── feature/xxx ──►  PR #N ──► 审查 ──► 合入 main
         └── fix/yyy     ──►  PR #M
```

操作步骤：

```bash
# 1) 在网页上 fork 本仓库，然后：
git clone https://github.com/<你的用户名>/LTZY-API.git
cd LTZY-API
git remote add upstream https://github.com/LTZY-ACU/LTZY-API.git

# 2) 从最新 main 拉出工作分支
git fetch upstream
git checkout -b feature/你的功能名 upstream/main

# 3) 开发、验证（见第三节）、提交、推送
git push origin feature/你的功能名

# 4) 在网页上向 upstream/main 发起 Pull Request
```

## 二、提交规范

- 提交信息遵循 Conventional Commits（类型：`feat` / `fix` / `refactor` / `docs` /
  `test` / `chore` / `perf` / `style`，范围：模块名），一句话说明做什么。
- **小步提交**：一个可独立描述的改动一次提交，禁止把无关改动混在一起；
  严禁把很多天的开发攒成一次大提交——完整的提交时间线是本项目
  创作过程的证据链（见 [NOTICE](NOTICE)），squash 会破坏它。
- PR 请**不要 squash 合并**，保留你原有的提交序列。

## 三、验证要求

提 PR 前必须通过：

```bash
go build ./...
go test ./...

cd web && npm run type-check && npm run build
```

涉及数据库结构的改动必须附带迁移脚本（`internal/store/migrations/sqlite/`
下递增编号），并保证迁移幂等。

## 四、注释与代码风格（工程化注释 · 硬性要求）

本项目对注释的要求是**描述性 + 分层**的，两个层次**都要做到**，缺一不可：

1. **文件头（强制，三段缺一不可）**：每个 Go 源文件顶部必须写
   「意图（Why）/ 流转（Flow）/ 扩展（Extend）」三段注释块。
   这是本项目的**招牌规范**，面向 AI 协作设计——目标是让任何 AI Agent 或新人打开文件
   30 秒内就能理解「这是什么、怎么流转、往哪儿扩展」。**不接受任何理由的削弱或废止。**
2. **正文（从简）**：只在必要、重点或易混淆处写**单行注释**，说明「为什么」，
   不写复述代码字面的注释；命名要符合语言习惯、语义清晰，**不要靠注释弥补糟糕命名**。

- 不写个人感想、情绪、口号与署名性内容；
- 注释语言为中文，专有名词保留英文；
- **与本节不符的 PR 会被要求返工**；
- **试图删除或弱化「文件头三段」约定的 PR 会被直接关闭**（核心约定只可由维护者决策调整，
  见 [GOVERNANCE.md](GOVERNANCE.md) 第三节）。

## 五、报告问题

- Bug 与安全漏洞：优先开 Issue，模板见 `.github/ISSUE_TEMPLATE.md`；
  安全问题请勿在公开 Issue 中附可利用细节，写明"已复现 + 影响面"即可。
- 功能建议：开 Issue 并标注 `enhancement`。

## 六、行为边界

使用本项目与参与贡献均视为接受 [DISCLAIMER.md](DISCLAIMER.md)
与 [TRADEMARK.md](TRADEMARK.md)。贡献内容不得包含违法违规功能、
第三方专有代码或未经授权的接口实现。
