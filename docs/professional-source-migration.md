# Stablecoin Policy 专业数据源迁移

更新日期：2026-07-30

## 目标

新数据发现链路不再调用 Google News 或 Google `site:` 关键词代理。系统改为：

1. 从监管机构、央行和议会的一手 RSS/Atom 获取公告；
2. 从政府结构化 API 获取法案、规则、监管文档及评论期；
3. 用官方文号和来源版本做幂等去重；
4. 在新闻视图中保留可供后续 RAG 使用的来源元数据。

历史 Google News 记录暂时保留，避免破坏旧报告引用，但它们会被排除在新生成的日报和区域分析之外。

## 当前已接入

### 结构化 API

| Source ID | 来源 | 覆盖 | 密钥 | 持续监控信号 |
|---|---|---|---|---|
| `federal-register` | Federal Register API | 美国规则、拟议规则、通知 | 无 | 新文档、正式文号、官方 GovInfo PDF |
| `regulations-gov` | Regulations.gov API v4 | 美国 docket 和监管文档 | 任一 `api.data.gov` key | 文档更新、评论开放状态、评论截止日 |
| `us-congress` | GovInfo Search + Congress.gov API v3 | 美国联邦法案全文、正式文本版本与立法状态 | 优先分别使用 `GOVINFO_API_KEY` / `CONGRESS_API_KEY`，缺少时可复用任一 `api.data.gov` key | 全文命中、新文本版本、最新动作、状态更新 |
| `uk-legislation` | legislation.gov.uk 全文检索 feed + XML | 英国已颁布 Acts、statutory instruments 与修订后正文 | 无 | 正文命中、正式文号、版本日期、XML/PDF 内容哈希 |

Federal Register 与 Regulations.gov 出现相同 Federal Register 文号时会合并为一条候选：Federal Register 提供正式出版物与 GovInfo PDF，Regulations.gov 补充 docket 和评论期限。

Congress.gov 的法案列表接口没有关键词参数，因此不再盲扫“最近 N 条法案”。系统先使用 GovInfo 对 `BILLS` 官方全文做关键词发现，再读取 Congress.gov 的法案详情和摘要；每条候选保存 GovInfo package ID、官方 PDF、正文 SHA-256 与 Congress.gov 最新动作。

英国链路使用 legislation.gov.uk 自身的全文检索，不再把 UK Parliament Bills API 的 `SearchTerm` 当作正文检索。每个结果继续读取官方 XML，并把版本 URL、更新时间和正文 SHA-256 写入 `sourceVersion`；因此能发现标题不含 stablecoin、但法条或 explanatory material 命中的已颁布 legislation。该来源不等于 UK Parliament 在审 Bills 全生命周期监控；尚未成法的阶段变化、修正案和新版本仍属于下一覆盖层。

州级法案目前仍由 `scripts/sync/bills-states.ts` 通过 OpenStates 同步到立法数据集；它已经不依赖 Google，但尚未进入本次统一的新闻事件流。下一阶段会复用相同的 document ID、version 和 provenance 字段接入。

### 一手 feed

- 美国：Federal Reserve、SEC、OCC News、OCC Bulletins、CFTC Press、CFTC Enforcement、FDIC Press；
- 英国与欧盟：FCA、Bank of England、EBA、ESMA、ECB；
- 亚洲：HKMA Press / Guidelines / Circulars / Consultations、Japan FSA。

Feed 清单位于 `data/news/feeds.json`。只允许发布机构自身 feed，或发布机构官网明确链接并授权使用的 feed。

## 搜索词的角色

迁移后仍会使用少量高精度检索词，但只在来源自己的结构化数据库或官方全文内检索。当前美国来源先使用 `stablecoin` 控制噪音；英国除 `stablecoin` 外，同时查询法定术语 `digital settlement asset`，以覆盖标题不含 stablecoin 的核心法规。其他术语只有在验证对应官方来源的检索语义和误报率后才加入。它们用于缩小官方语料范围，不再依赖搜索引擎排序、媒体转载或 Google 跳转 URL。

查询词、回看窗口和单源上限位于 `data/news/professional-sources.json`，可以独立于代码调整。

## 来源与版本字段

每条新记录可包含：

| 字段 | 含义 |
|---|---|
| `sourceId` | 稳定的数据源标识 |
| `sourceType` | `official-api` 或 `official-feed` |
| `sourceAuthority` | 实际发布机构 |
| `officialDocumentId` | Federal Register 文号、docket ID、bill ID 等 |
| `sourceVersion` | 来源更新时间、正文版本及评论期状态组成的版本标记 |
| `documentType` | Rule、Notice、Bill、Act 等 |
| `officialPdfUrl` | 可用时指向正式 PDF |
| `commentCloseDate` | 评论截止日 |
| `openForComment` | 当前是否开放评论 |
| `retrievedAt` | 本次读取时间 |
| `relatedDocumentIds` | 跨系统对应文号 |

普通 feed 继续按 canonical URL 去重；结构化文档按 `sourceId + officialDocumentId + sourceVersion` 去重。评论截止日和当前开放/关闭状态参与版本计算，所以规则正文更新、截止日调整或评论期自然关闭都会产生一条新事件，而不会让 RAG 永久保留旧的 `openForComment`。

## 运行与降级

- 每日任务默认持续运行，不再在 60 天后静默停止；
- 仅在设置正整数 `NEWS_POLL_MAX_DAYS` 时启用评估期停止机制；
- 评估期到期时 poller 会让 workflow 失败，而不是沿用上一轮健康检查再发布一次日报；
- Federal Register 和 legislation.gov.uk 无密钥即可运行；
- 没有任何 `api.data.gov` key 时，`us-congress` 与 `regulations-gov` 会跳过，但不影响其他来源；GovInfo 和 Congress.gov 分别优先使用自己的 key，缺少时才复用其他已配置的 `api.data.gov` key；
- 单个来源超时或返回错误时软降级，日志会记录该来源状态；
- Feed 只有在 HTTP 成功且返回可识别的 RSS/Atom 文档时才计为健康；WAF/HTML 错误页不会制造成功状态；
- 每次非 dry-run 同步都会写入 `data/news/source-health.json`，包含 feed 成功/失败数、各 adapter 状态和候选计数；
- 如果所有官方来源都失败，同步任务会失败，阻止后续付费日报发布；
- 日报要求健康检查不超过 36 小时且至少一个官方来源成功；
- 新日报和区域摘要只接受带上述官方来源标记的新闻记录；历史 Google 与其他第三方记录仍留档，但不能作为新报告证据；
- 区域摘要只从最近 30 天的一手记录生成，日报只复用最近 36 小时生成且标记为 `official-only` 的摘要；安静区域不再用更老事件回填；
- 旧 `data/international` 背景和还没有统一 provenance 的 `data/legislation` 记录都不会送入付费日报；它们完成官方文号、来源类型和版本迁移后才能重新进入；
- 官方来源健康但最近 7 天没有可引用事件时，系统直接生成确定性的“无新增政策信号”日报，不调用模型拿旧材料填充。

## 下一批专业来源

按产品价值排序：

1. **OpenStates 州级增量接入**：把现有州法案同步纳入统一 provenance / 版本事件流，并扩大当前 10 州覆盖；LegiScan 等补充源在商业使用前确认额度与再分发条款；
2. **EUR-Lex / CELLAR**：MiCA、delegated acts、implementing acts 的版本化原文；
3. **UK Parliament Bills 本地全文索引 + FCA/HMT consultations**：Bills API 的 `SearchTerm` 不能视为正文搜索。应枚举当前会期 Bills，读取官方 Bill / Explanatory Notes publications，对 HTML/PDF/DOCX 规范化后本地匹配，并以正文、stage 和 amendment 的 canonical hash 产生版本事件；同时补齐财政部咨询；
4. **Japan e-Gov、Hong Kong e-Legislation / LegCo OData、Singapore Statutes Online**：补齐亚洲法律原文。

上述来源进入 RAG 前应先写入 canonical legal corpus，保存原始文件、`sha256`、抓取时间和法律版本。展示层的 LLM 摘要不能替代法律原文。

## 验收条件

- 活跃配置和代码不再请求 `news.google.com`；
- 每个结构化候选至少有官方 URL、来源 ID、文号和版本；
- 同一版本重复运行不产生重复记录，新版本可以产生更新；
- 无可选 API key 时每日任务仍成功；
- 新日报只引用一手来源；
- 所有官方来源失败或健康检查过期时禁止发布付费日报；
- 历史派生区域摘要没有 `sourcePolicy: official-only` 时不得被日报复用；
- smoke test 能分别显示每个 adapter 的成功、跳过或失败状态。
