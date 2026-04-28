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

## 数据来源

立法数据来自各国议会官网、监管机构公告及 LegiScan。完整来源见站内方法论页面。
