"use client";

import Link from "next/link";
import { useLocale } from "@/contexts/LocaleContext";

const copy = {
  en: {
    back: "← Back",
    eyebrow: "Contact",
    title: "Send a correction or tip",
    paragraphs: [
      "If a stablecoin bill is missing, a regulator entry is stale, or a jurisdiction's status looks wrong, please send the source and a short note. Corrections are the fastest way to make the map more useful.",
      "Tips are especially helpful for new licensing regimes, enforcement actions, consultation papers, implementation dates, and country-level rules that are easy to miss in English-language coverage.",
    ],
    sections: [
      {
        label: "What to include",
        body: "Jurisdiction, source link, date, and the specific claim that should change.",
      },
      {
        label: "Response scope",
        body: "This is an independent policy tracker, not legal advice or a compliance help desk.",
      },
      {
        label: "Contact",
        body: "admin@web3law.tech",
      },
    ],
  },
  zh: {
    back: "← 返回",
    eyebrow: "联系",
    title: "提交修正或线索",
    paragraphs: [
      "如果有稳定币法案遗漏、监管机构信息过期，或某个司法管辖区的状态判断不准确，请附上来源和简短说明。修正反馈能最快提升这张地图的准确性。",
      "尤其欢迎关于新许可制度、执法行动、咨询文件、实施日期，以及英文报道中容易遗漏的国家级规则线索。",
    ],
    sections: [
      {
        label: "建议包含",
        body: "司法管辖区、来源链接、日期，以及需要修改的具体判断。",
      },
      {
        label: "说明",
        body: "这是独立政策追踪项目，不提供法律意见或合规咨询。",
      },
      {
        label: "联系方式",
        body: "admin@web3law.tech",
      },
    ],
  },
};

export default function ContactContent() {
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
        </div>

        <div className="mt-12 pt-10 border-t border-black/[.06] space-y-5">
          {c.sections.map((section) => (
            <div key={section.label}>
              <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
                {section.label}
              </div>
              {section.body.includes("@") ? (
                <a
                  href={`mailto:${section.body}`}
                  className="text-base text-ink underline underline-offset-2 hover:text-muted transition-colors"
                >
                  {section.body}
                </a>
              ) : (
                <p className="text-base text-ink/80 leading-relaxed">
                  {section.body}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
