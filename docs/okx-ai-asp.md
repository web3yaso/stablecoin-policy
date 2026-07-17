# OKX.AI A2MCP ASP 上架说明

本项目只上架付费报告，不提供免费 ASP 服务，也不提供 A2A 定制服务。

## 服务信息

- 名称：Web3Law 稳定币政策付费报告
- 类型：A2MCP
- Endpoint：`https://stablecoin-policy.vercel.app/api/reports/latest`
- 方法：`GET`
- 返回格式：`text/markdown`
- 计费：x402 按次付费
- OpenAPI：`https://stablecoin-policy.vercel.app/openapi.json`
- Discovery：`https://stablecoin-policy.vercel.app/.well-known/x402`

`/api/reports/latest` 是稳定 URL。后台发布新日报后，调用方不需要更换 endpoint。未携带有效支付凭证时必须返回 HTTP 402；报告正文只在支付验证及结算成功后返回。

## 上线配置

生产环境至少需要配置：

```text
X402_PAY_TO=<生产收款地址>
X402_NETWORK=<生产网络 CAIP-2 标识>
OKX_API_KEY=<OKX 开发者 API Key>
OKX_SECRET_KEY=<OKX API Secret>
OKX_PASSPHRASE=<OKX API Passphrase>
REPORTS_ENCRYPTION_KEY=<32 字节报告解密密钥>
KV_REST_API_URL=<付款日志存储 URL>
KV_REST_API_TOKEN=<付款日志存储 Token>
```

当前代码默认使用 X Layer Testnet (`eip155:1952`)，仅用于测试，不能直接提交生产审核。上架时切换到 X Layer Mainnet (`eip155:196`)。报告价格、OpenAPI 声明、实际 402 challenge 必须保持一致。

## 自检

启动服务后运行：

```bash
npm run asp:check
```

脚本要求 endpoint 返回 HTTP 402，并验证 `PAYMENT-REQUIRED` 是可解码的 x402 v2 challenge。此检查需要有效 OKX facilitator 凭证；缺少凭证时 endpoint 会拒绝初始化，不能生成可支付的 challenge。

## 注册提示词

完成 Agentic Wallet 登录后，在新的 Agent 对话中发送：

```text
帮我使用 Onchain OS 的 OKX Agent Identity 在 OKX.AI 注册一个 A2MCP 类型的 ASP。
只注册付费报告服务，endpoint 是 https://stablecoin-policy.vercel.app/api/reports/latest，方法为 GET，使用 x402 按次收费，不注册免费服务或 A2A 服务。
```
