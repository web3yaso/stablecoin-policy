"use client";

import { useLocale } from "@/contexts/LocaleContext";
import { t } from "@/lib/i18n";

interface ContextBlurbProps {
  text: string;
}

export default function ContextBlurb({ text }: ContextBlurbProps) {
  const { locale } = useLocale();
  return (
    <div>
      {locale === "zh" && (
        <span className="inline-block text-[10px] text-muted border border-black/[.08] rounded px-1.5 py-0.5 mb-2">
          {t(locale, "panel.summary_lang_note")}
        </span>
      )}
      <p className="text-sm text-ink/80 leading-relaxed">{text}</p>
    </div>
  );
}
