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
OPENAI_API_KEY=     # 新闻聚合与法案分类
OPENAI_MODEL=gpt-5.6-terra       # 日报和高质量分析
OPENAI_FAST_MODEL=gpt-5.6-luna   # 高频新闻摘要
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

### 支付宝「AI 收」端点（人民币）

`GET /api/alipay/reports/latest` 用支付宝 AI 收（A2M）的 HTTP-402 方案返回每日最新可售报告，定价 `0.10 元/次`，与平台「服务注册」处的服务单价必须一致。需要以下服务端环境变量（同样只填在 `.env.local` 或 Vercel，不要提交）：

```
ALIPAY_APP_ID=           # 应用 APPID
ALIPAY_PRIVATE_KEY=      # 应用私钥（密钥工具导出的 base64 主体，单行）
ALIPAY_KEY_TYPE=PKCS1    # 私钥格式：PKCS1（默认）或 PKCS8，须与密钥工具一致
ALIPAY_PUBLIC_KEY=       # 支付宝公钥，用于 SDK 验签响应
ALIPAY_SELLER_ID=        # 商户 ID（2088 开头）
ALIPAY_SERVICE_ID=       # AI 收服务 ID（服务注册后获得）
ALIPAY_SELLER_NAME=      # 可选；展示用商户名
ALIPAY_GATEWAY=          # 可选；默认 https://openapi.alipay.com/gateway.do
ALIPAY_REPORT_PRICE_CNY=0.10  # 可选；必须等于服务注册处的服务单价
ALIPAY_CURRENCY=CNY      # 可选
```

AI 收**无沙箱**，完整链路需正式商户密钥。上线前用离线 dry-run 校验 402 构造与签名（不调支付宝）：

```bash
npx tsx scripts/smoke/alipay-402-dryrun.ts
```

## 付费报告内容存储

公开仓库不会提交报告全文明文。报告索引在 `data/reports/index.json`，全文只以 AES-256-GCM 密文 `data/reports/*.md.enc` 存储；本地明文 `.md` 文件会被 `.gitignore` 忽略。

添加报告前先生成 32 字节密钥并写入 `.env.local`：

```bash
openssl rand -base64 32
```

然后从 repo 外或 `data/reports/private/` 中的明文 markdown 生成密文报告：

```bash
npx tsx scripts/reports/add-report.ts \
  --file /path/to/report.md \
  --title "中文标题" \
  --summary "100-200字摘要" \
  --category policy \
  --jurisdiction US,EU \
  --price-usd 0.01 \
  --source-url "https://mp.weixin.qq.com/..."
```

`data/reports/private/` 和 `data/reports/*.md` 不应提交；可提交的只有 `index.json` 与 `*.md.enc`。

## x402 购买流程测试

测试脚本只允许在 Base Sepolia (`eip155:84532`) 运行。先准备一个 testnet 买家钱包，并从 Coinbase Faucet 或 Base Sepolia faucet 领取测试 ETH 和 USDC。不要使用 mainnet 私钥。

在 `.env.local` 中配置：

```
TEST_BUYER_PRIVATE_KEY= # TESTNET ONLY
REPORTS_API_BASE_URL=http://localhost:3000
BASE_SEPOLIA_RPC_URL=   # 可选；自定义 Base Sepolia RPC
```

本地先启动服务：

```bash
npm run dev
```

然后另开终端运行：

```bash
npx tsx scripts/reports/verify-x402.ts
```

部署后测试生产环境：

```bash
REPORTS_API_BASE_URL=https://stablecoin-policy.vercel.app npx tsx scripts/reports/verify-x402.ts
```

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
