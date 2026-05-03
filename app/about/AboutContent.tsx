"use client";

import Link from "next/link";
import { useLocale } from "@/contexts/LocaleContext";

const copy = {
  en: {
    back: "← Back",
    eyebrow: "About",
    title: "What this site tracks",
    paragraphs: [
      "Stablecoins are reshaping global payments, but governments are taking very different approaches. Some are building dedicated licensing regimes, some are adding strict guardrails, and others are restricting private stablecoins outright. This site exists to answer one direct question: what is each jurisdiction actually doing?",
      "Answering that usually means reading scattered parliamentary records, regulatory announcements, and industry briefings. I built this atlas to put those signals in one place.",
      "The map covers major jurisdictions worldwide, including US states, the EU, the UK, and key Asian markets. Click any country or region to see current legislation, regulators, policy figures, and recent news. Each jurisdiction is rated from supportive to restrictive based on its live legal and regulatory posture.",
      "Stablecoin regulation is moving quickly. MiCA is now active in the EU, the US has advanced federal payment stablecoin legislation, and Hong Kong, Singapore, and Japan have each built local frameworks. India, Russia, and others remain more cautious. The goal is to turn those fragmented updates into a map you can scan at a glance.",
      "This site does not advocate for a policy outcome. It tries to show what is on the table, where bills stand, and what their practical impact would be so readers can form their own view from real information.",
    ],
    contactLead: "Data is updated continuously. For corrections or additions, please",
    contact: "get in touch",
    sources: "Sources",
    forkLead: "This site is forked from",
    forkTail: "'s open source Track Policy project, refocused here on stablecoin policy.",
    legiscan: "Legislative data references official parliamentary sources, regulator announcements, and",
    mapLead: "Map inspiration comes from",
    iconsLead: "Icons are from",
    methodologyLead: "See the",
    methodology: "methodology",
    methodologyTail: "page for full data notes.",
  },
  zh: {
    back: "← 返回",
    eyebrow: "关于",
    title: "这个网站追踪什么",
    paragraphs: [
      "稳定币正在重塑全球支付体系，而各国政府对它的态度却大相径庭：有的建立专门许可制度，有的设置严格护栏，也有的直接限制私人稳定币。这个网站想回答一个直接的问题：每个司法管辖区到底在做什么？",
      "要回答这个问题，通常需要翻阅分散的议会记录、监管公告和行业简报。我做这张地图，是为了把这些信号放到同一个地方。",
      "地图覆盖全球主要司法管辖区，包括美国各州、欧盟、英国和亚洲重点市场。点击任意国家或地区，可以查看现行立法、监管机构、政策人物和近期新闻。每个地区的评级都基于其实际法律和监管状态。",
      "稳定币监管变化很快。欧盟 MiCA 已经生效，美国正在推进联邦支付稳定币立法，香港、新加坡、日本也建立了各自框架。印度、俄罗斯等地区则更谨慎。这张地图试图把碎片化更新变成一眼能扫清的图景。",
      "本站不为任何政策结果站台。它只是尽量呈现：哪些议案正在桌面上、进展到哪里、实际影响是什么，让读者基于真实信息形成自己的判断。",
    ],
    contactLead: "数据会持续更新。如有修正或补充，请",
    contact: "联系我",
    sources: "数据来源",
    forkLead: "本站 fork 自",
    forkTail: "的开源项目 Track Policy，并在此基础上聚焦稳定币政策。",
    legiscan: "立法数据参考各国议会官网、监管机构公告以及",
    mapLead: "地图灵感来源于",
    iconsLead: "图标来自",
    methodologyLead: "完整数据说明见",
    methodology: "方法论",
    methodologyTail: "页面。",
  },
};

export default function AboutContent() {
  const { locale } = useLocale();
  const c = copy[locale];

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-8 py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors mb-16"
        >
          {c.back}
        </Link>

        <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
          {c.eyebrow}
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          {c.title}
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          {c.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}

          <div className="pt-5 mt-5 border-t border-black/[.06]">
            <p className="text-muted">
              {c.contactLead}{" "}
              <Link
                href="/contact"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                {c.contact}
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="mt-16 pt-10 border-t border-black/[.06]">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-4">
            {c.sources}
          </div>
          <ul className="text-sm text-ink/80 leading-relaxed space-y-2">
            <li>
              {c.forkLead}{" "}
              <a
                href="https://github.com/isabellereks/track-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                Isabelle Reksopuro
              </a>
              {c.forkTail}
            </li>
            <li>
              {c.legiscan}{" "}
              <a
                href="https://legiscan.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                LegiScan
              </a>
              .
            </li>
            <li>
              {c.mapLead}{" "}
              <a
                href="https://datacenterbans.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                datacenterbans.com
              </a>
              .
            </li>
            <li>
              {c.iconsLead}{" "}
              <a
                href="https://streamlinehq.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                Streamline
              </a>
              .
            </li>
            <li className="pt-2 text-muted">
              {c.methodologyLead}{" "}
              <Link
                href="/methodology"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                {c.methodology}
              </Link>{" "}
              {c.methodologyTail}
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
