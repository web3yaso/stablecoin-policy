# 全球稳定币政策追踪

> **⚠️ 开发中** — 数据持续更新，功能尚未完善。

这是 [Isabelle Reksopuro](https://github.com/isabellereks/track-policy) 开源项目 [Track Policy](https://github.com/isabellereks/track-policy) 的 fork，在其基础上将追踪方向专注于**全球稳定币监管政策**。

原项目覆盖 AI 与数据中心政策，本 fork 重新定向为追踪各国稳定币立法动态，覆盖北美（美国联邦 + 各州）、欧洲（EU MiCA 框架 + 成员国）、亚太及其他主要司法管辖区。

## 功能

- 交互式世界地图，按地区浏览各国稳定币监管立场
- 每个司法管辖区的立法列表、监管机构、关键人物及最新资讯
- 多维度着色（发行规则、储备要求、消费者保护等）
- 支持中英文切换

## 技术栈

- **Next.js 16** + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **react-simple-maps** + **d3-geo** + **topojson-client**
- 新闻数据通过 **Anthropic API** 聚合

## 本地运行

```bash
npm install
npm run dev
```

## 数据同步脚本

在 `.env.local` 中配置以下环境变量：

```
CONGRESS_API_KEY=   # Congress.gov，免费注册 https://api.congress.gov/sign-up/
STATE_API_KEY=      # OpenStates API，免费注册 https://openstates.org/accounts/profile/
ANTHROPIC_API_KEY=  # 新闻聚合与法案分类
```

## 环境变量

除上面的数据同步变量外，x402 报告 API 需要以下服务端环境变量。请只在 `.env.local` 或 Vercel 环境变量中填写真实值；不要提交任何密钥。

```
CDP_API_KEY_ID=          # Coinbase CDP API Key ID，用于 x402 facilitator
CDP_API_KEY_SECRET=      # Coinbase CDP API Key Secret
X402_PAY_TO=             # Base Sepolia 收款地址
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=    # 可选；留空使用 Coinbase 官方 facilitator
REPORTS_ENCRYPTION_KEY=  # 报告全文 AES-256-GCM 解密密钥
KV_REST_API_URL=         # Vercel KV REST URL，用于付款日志
KV_REST_API_TOKEN=       # Vercel KV REST token
TEST_BUYER_PRIVATE_KEY=  # 仅用于 Base Sepolia 测试脚本；绝不要填 mainnet 私钥
```

`X402_FACILITATOR_URL` 仅用于测试或应急覆盖。生产环境应使用官方 facilitator，避免把付款验证交给未审计的第三方服务。

报告 API 的 MVP 定价为每篇 `$0.01 USDC`，仅用于 Base Sepolia testnet validation；生产定价待后续版本决定。

| 脚本 | 说明 |
|------|------|
| `npx tsx scripts/smoke/congress-ping.ts` | 测试 Congress.gov 连通性 |
| `npx tsx scripts/sync/bills-federal.ts` | 同步美国联邦稳定币法案（Congress.gov） |
| `npx tsx scripts/sync/bills-states.ts` | 同步美国各州稳定币法案（OpenStates，NY/CA/TX等） |
| `npx tsx scripts/sync/votes-congress.ts` | 同步联邦法案投票记录 |
| `npx tsx scripts/sync/news-rss.ts` | 拉取最新新闻 |
| `npx tsx scripts/sync/international.ts` | 更新国际数据 |

## 数据来源

美国联邦立法数据来自 [Congress.gov API](https://api.congress.gov/)；州级数据来自 [OpenStates API](https://openstates.org/)；国际数据来自各国议会官网及监管机构公告。完整来源见站内方法论页面。
