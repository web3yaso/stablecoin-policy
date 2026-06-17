# 支付宝「AI 收」(A2M) 支付接入：开发步骤与经验

> 状态：已上线，并于 **2026-06-16** 用一笔真实 **0.10 元** 付款完成端到端验证。
> 端点：`GET /api/alipay/reports/[slug]`（生产：`https://stablecoin-policy.vercel.app/api/alipay/reports/global-stablecoin-policy-report`）

把每日稳定币政策报告作为付费 API，通过支付宝「AI 收」(A2M / agent-to-agent) 的 **HTTP 402** 方案售卖，定价 0.10 元，按 Agent 消费习惯返回 JSON。本文记录从零接入的步骤、关键实现、以及踩过的坑。

---

## 1. 它是什么：和 x402 同构的 402 协议

支付宝「AI 收」与 Coinbase 的 x402 是**同一种协议形态**，差异只在结算层：

| | 协议形态 | 结算 |
|---|---|---|
| x402 | HTTP 402 + `Payment-Needed` | USDC 链上 |
| 支付宝 AI 收 | HTTP 402 + `Payment-Needed` | 人民币（支付宝） |

两段式流程：

1. Agent 无凭证请求 → 服务端返回 `402` + `Payment-Needed` 头（Base64URL 编码、含 RSA2 商家签名）。
2. Agent 完成支付 → 带 `Payment-Proof` 头重试 → 服务端验签、交付资源、回执履约。

---

## 2. 接入步骤总览

### 2.1 商户入驻 + 服务上架（支付宝侧）
- 在**商户一站式入驻平台** <https://b.alipay.com/page/home/open-ai-pay> 上架「AI 收」产品。
- ⚠️ **AI 收无沙箱**，必须用入驻后的**正式商户配置**。
- 注册服务时填：服务类型(API)、服务名称、**服务地址**、**服务单价**、服务描述、请求示例。
  - 服务地址 = 你的付费端点 URL；服务单价必须与端点 402 返回的金额**完全一致**，否则用户无法支付。

### 2.2 拿到配置并对应到环境变量
入驻 + 上架后支付宝下发的字段与本项目环境变量的对应：

| 支付宝字段 | 环境变量 | 备注 |
|---|---|---|
| 应用 ID (app-id) | `ALIPAY_APP_ID` | 例 `2021006160678876` |
| **商户 ID (seller-id)** | `ALIPAY_SELLER_ID` | `2088` 开头，是商户**账户 PID**，在商家平台账户信息里找，**不在服务注册页** |
| 商户服务 ID (service-id) | `ALIPAY_SERVICE_ID` | 例 `API_16861681096E47C8`，注册服务后获得 |
| 支付宝公钥 | `ALIPAY_PUBLIC_KEY` | 用于 SDK 验签支付宝响应 |
| 应用私钥（自行用密钥工具生成） | `ALIPAY_PRIVATE_KEY` | **PKCS#1**，base64 单行 |
| 商户名称 | `ALIPAY_SELLER_NAME` | 可选 |
| — | `ALIPAY_KEY_TYPE` | `PKCS1`（Node.js）；见坑 #2 |
| — | `ALIPAY_REPORT_PRICE_CNY` | `0.10`，必须等于服务单价 |
| — | `ALIPAY_GATEWAY` | 默认 `https://openapi.alipay.com/gateway.do` |

> 🔑 **seller-id ≠ service-id**：前者是"钱收给谁"（商户账户，一个商户号下可挂多个服务），后者是"哪个服务/定价"。注册页通常只给 service-id / app-id / 支付宝公钥，**商户 ID 要去商家平台账户信息里找 2088 开头的 PID**。

### 2.3 代码实现
- `lib/alipay-server.ts`：配置/SDK 初始化、`ISO8601+时区`、Base64URL、RSA2 `seller_signature`、`Payment-Needed`/`Payment-Validation` 构造、`Payment-Proof` 解析、KV 防重放。字段对照官方 Node.js 示例逐一实现。
- `app/api/alipay/reports/[slug]/route.ts`：动态路由，接受 `latest` 和 `global-stablecoin-policy-report` 两个别名（都返回最新可售报告），`resource_id` 由实际请求路径推导。
- `lib/reports.ts`：`LATEST_REPORT_SLUG` 别名 → `global-stablecoin-policy-report`。
- 复用 Vercel KV 做履约幂等（按 `trade_no` 防重放）。
- 依赖：`alipay-sdk`。

### 2.4 部署
- 把所有 `ALIPAY_*` 变量配到 **Vercel 环境变量**（见坑 #3），重新部署。

### 2.5 测试
- **离线** dry-run（无沙箱替代方案，见第 4 节）。
- **端到端**：以买家身份授权钱包 + 付 0.10 元（见第 5 节）。

---

## 3. 协议实现要点

`Payment-Needed`（402 响应头，Base64URL 编码的 JSON）：

```jsonc
{
  "protocol": {
    "out_trade_no": "...", "amount": "0.10", "currency": "CNY",
    "resource_id": "/api/alipay/reports/global-stablecoin-policy-report",
    "pay_before": "2026-06-17T03:34:40+00:00",   // ISO 8601 带时区
    "seller_signature": "<RSA2>",                 // 对下列字段字典序 k=v& 拼接后签名
    "seller_sign_type": "RSA2",
    "seller_unique_id": "2088..."                 // = seller_id
  },
  "method": {
    "seller_name": "...", "seller_id": "2088...", "seller_app_id": "2021...",
    "goods_name": "...", "seller_unique_id_key": "seller_id",
    "service_id": "API_..."
  }
}
```

- **seller_signature**：对 `amount,currency,goods_name,out_trade_no,pay_before,resource_id,seller_id,service_id` 按 key 字典序拼成 `k1=v1&k2=v2...`，空值丢弃，RSA2(SHA256) 签名，base64。
- **验签交付**：解析 `Payment-Proof` → `alipay.aipay.agent.payment.verify`（查 `code===10000 && active===true`）→ 资源防串（`resource_id` 必须等于本次路径）→ 幂等防重放 → 取报告 → `alipay.aipay.agent.fulfillment.confirm` → 返回报告 JSON + `Payment-Validation` 头。
- **固定默认值**（不可改）：`sign-type=RSA2`、`charset=UTF-8`、`format=json`、`currency=CNY`。

---

## 4. 测试策略：无沙箱怎么办

AI 收**没有沙箱**，`verify`/`fulfillment.confirm` 只能靠生产环境真实付款触发。为在上线前最大限度排雷，做了两个**离线** smoke：

- `scripts/smoke/alipay-402-dryrun.ts`：用一对**临时密钥**验证 402 构造、签名可验签、Base64URL 往返、proof 解析。
- `scripts/smoke/alipay-config-check.ts`：用 **`.env.local` 里的真实配置**，从私钥**派生公钥**并自验 `seller_signature`（等同支付宝服务端做的验签）——一把抓出 `ALIPAY_KEY_TYPE` 填错 / 私钥格式错。只打印非敏感标识，**不输出任何密钥**。

> 经验：把验收门槛挂在这两个 dry-run 上，而不是某次真实支付宝调用（那需要正式商户密钥且不可重复）。

---

## 5. 买家侧测试（端到端）

买家用环境内的支付宝官方技能完成：`alipay-payment-skill`（402 支付）+ `alipay-authenticate-wallet`（钱包授权）。

1. 命中 402 → 进入 `alipay-payment-skill`。
2. `check-wallet`：若返回 `code=200, message="已申请开通，等待授权"` 即**未授权** → 切到 `alipay-authenticate-wallet`。
3. `apply-wallet` 出二维码/链接 → 在支付宝里授权（或 `bind-wallet -c <授权码>`）。
4. 授权后回到支付流程付 0.10 元 → 端点验签、交付报告、回执履约。

> 卖家是**被动方**：没有"卖家主动测试"动作，卖家正确性只能由一笔真实买家付款触发验证。

---

## 6. 踩坑与经验（核心）

1. **AI 收无沙箱** —— `verify`/`fulfillment.confirm` 上线前无法真跑。用离线 smoke 把能验的都验了，剩下的留给一笔真实付款。
2. **私钥格式：Node.js 用 PKCS#1**（非 Java 一律 PKCS#1；Java 才 PKCS#8）。`ALIPAY_KEY_TYPE` 填错 = 验签必失败，且报错隐晦。`alipay-config-check.ts` 专门抓这个。
3. **Vercel 环境变量与 `.env.local` 是两套**：本地配了不等于线上有。线上缺 `ALIPAY_*` → 端点返回 `503 alipay-not-configured`。改完环境变量**必须重新部署**才生效。
4. **注册的服务地址路径必须和部署的路由一致**：我们在支付宝注册的是 `.../global-stablecoin-policy-report`，但代码最初只有 `/latest`，会 404。改成动态 `[slug]` 路由同时支持两者后解决。`resource_id` 由实际请求路径推导，保证与支付宝回传的一致。
5. **seller-id 与 service-id 别混**：服务注册页通常不给商户 ID，要去商家平台账户信息找 2088 开头的 PID。
6. **定价一致性**：402 header 里的 `amount` 必须严格等于服务注册处的服务单价（我们用 `0.10`），否则用户无法支付。
7. **GitHub squash 合并可能丢提交**：若某次 `git push` 未在合并前到达 PR head，squash 只会合到旧的 head。表现为"重命名/修复没进 main"。**合并后务必核实 main 的实际文件树**（`git ls-tree -r --name-only origin/main | grep ...`）。我们因此补了一次 PR 才把动态路由真正合进去。
8. **幂等/防重放**：用 Vercel KV 按 `trade_no` 兜底，保证一笔交易只履约一次。
9. **安全**：私钥只进 `.env.local` / Vercel，绝不提交、不进日志、不粘贴到对话；公钥不敏感。

---

## 7. 相关文件

| 文件 | 作用 |
|---|---|
| `app/api/alipay/reports/[slug]/route.ts` | 端点（402 两段式流程、CORS、防串/防重放、503 兜底） |
| `lib/alipay-server.ts` | 配置/SDK、签名、Payment-Needed/Validation、proof 解析、KV 幂等 |
| `lib/reports.ts` | `LATEST_REPORT_SLUG` 别名 |
| `scripts/smoke/alipay-402-dryrun.ts` | 离线 402/签名 dry-run（临时密钥） |
| `scripts/smoke/alipay-config-check.ts` | 真实配置离线自检（不输出密钥） |
| `README.md` → 「支付宝『AI 收』端点」 | 环境变量清单 + dry-run 用法 |
