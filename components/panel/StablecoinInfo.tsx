"use client";

import type {
  StablecoinMeta,
  LegalStatusEnum,
  RegimeStatusEnum,
  ClassificationEnum,
  PractitionerQA,
  PractitionerStatus,
} from "@/types";
import { useLocale } from "@/contexts/LocaleContext";
import { t } from "@/lib/i18n";

// ─── Color maps ───────────────────────────────────────────────────

const LEGAL_COLOR: Record<LegalStatusEnum, string> = {
  legal: "#34C759",
  legal_with_restrictions: "#FF9500",
  banned: "#FF3B30",
  partially_legal: "#FF9500",
  unclear: "#8E8E93",
};

const REGIME_COLOR: Record<RegimeStatusEnum, string> = {
  finalized: "#34C759",
  pending_start: "#FF9500",
  in_progress: "#FF9500",
  draft: "#8E8E93",
  none: "#8E8E93",
};

// ─── Sub-components ────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-black/[.06] pt-4">
      <div className="text-[10px] font-semibold text-muted tracking-widest uppercase mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

function ClarityDots({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-1 mt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className="w-4 h-4 rounded-[4px]"
          style={{ backgroundColor: i < value ? "#34C759" : "#E5E5EA" }}
        />
      ))}
      <span className="text-[11px] text-muted ml-1">
        {value}/5 · {label}
      </span>
    </div>
  );
}

function AllowedTypeRow({
  allowed,
  label,
  note,
}: {
  allowed: boolean | "partial";
  label: string;
  note?: string;
}) {
  if (allowed === true) {
    return (
      <div className="flex items-start gap-2 text-[13px]">
        <span className="text-[#34C759] font-bold mt-px">✓</span>
        <span className="text-ink">{label}</span>
      </div>
    );
  }
  if (allowed === "partial") {
    return (
      <div className="flex items-start gap-2 text-[13px]">
        <span className="text-[#FF9500] font-bold mt-px">~</span>
        <div>
          <span className="text-ink">{label}</span>
          {note && <div className="text-[11px] text-muted mt-0.5">{note}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <span className="text-[#FF3B30] font-bold mt-px">✗</span>
      <span className="text-muted line-through">{label}</span>
    </div>
  );
}

function QARow({
  fieldKey,
  qa,
  statusLabel,
}: {
  fieldKey: string;
  qa: PractitionerQA;
  statusLabel: string;
}) {
  const color =
    qa.status === "ok" ? "#34C759" : qa.status === "warn" ? "#FF9500" : "#FF3B30";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{fieldKey}</span>
        <span className="text-[11px] font-semibold flex-shrink-0" style={{ color }}>
          {statusLabel}
        </span>
      </div>
      <p className="text-[12px] text-ink leading-snug">{qa.text}</p>
      {qa.note && <p className="text-[11px] text-muted leading-snug">{qa.note}</p>}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────

export default function StablecoinInfo({ meta }: { meta: StablecoinMeta }) {
  const { locale } = useLocale();

  const legalColor = LEGAL_COLOR[meta.legalStatus] ?? "#8E8E93";
  const regimeColor = REGIME_COLOR[meta.regimeStatus] ?? "#8E8E93";

  const clarityLabel =
    meta.regulatoryClarity >= 4
      ? t(locale, "clarity.high")
      : meta.regulatoryClarity >= 3
        ? t(locale, "clarity.mid")
        : t(locale, "clarity.low");

  const qaFields = [
    ["qa.canIssue", meta.canIssue],
    ["qa.foreignStablecoin", meta.foreignStablecoin],
    ["qa.reserveRequirement", meta.reserveRequirement],
    ["qa.algorithmicStatus", meta.algorithmicStatus],
    ["qa.yieldToHolders", meta.yieldToHolders],
  ] as const;
  const hasQA = qaFields.some(([, v]) => v != null);

  return (
    <div className="flex flex-col gap-4">
      {/* Tags */}
      {meta.tags && meta.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 -mt-1">
          {meta.tags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] text-muted bg-black/[.04] border border-black/[.06] rounded-full px-2 py-0.5"
            >
              {t(locale, `tag.${tag}` as Parameters<typeof t>[1]) || tag}
            </span>
          ))}
        </div>
      )}

      {/* Legal status */}
      <Section title={t(locale, "section.legal_status")}>
        <div
          className="text-[22px] font-bold tracking-tight leading-none"
          style={{ color: legalColor }}
        >
          {t(locale, `legal.${meta.legalStatus}` as Parameters<typeof t>[1])}
        </div>
        {typeof meta.regulatoryClarity === "number" && (
          <div className="mt-2">
            <div className="text-[11px] text-muted mb-1">
              {t(locale, "clarity.label")}
            </div>
            <ClarityDots value={meta.regulatoryClarity} label={clarityLabel} />
          </div>
        )}
        {meta.classification && (
          <div className="mt-2.5">
            <span className="text-[11px] font-medium text-ink bg-black/[.04] border border-black/[.06] rounded-full px-2.5 py-1">
              {t(locale, `class.${meta.classification}` as Parameters<typeof t>[1])}
            </span>
          </div>
        )}
      </Section>

      {/* Allowed types */}
      <Section title={t(locale, "section.allowed_types")}>
        <div className="flex flex-col gap-2">
          <AllowedTypeRow allowed={meta.allowsFiatBacked} label={t(locale, "allowed.fiat")} />
          <AllowedTypeRow allowed={meta.allowsAlgorithmic} label={t(locale, "allowed.algorithmic")} />
          <AllowedTypeRow
            allowed={meta.allowsAssetBacked}
            label={t(locale, "allowed.asset")}
            note={meta.allowsAssetBackedNote}
          />
        </div>
      </Section>

      {/* Regime status */}
      <Section title={t(locale, "section.regime_status")}>
        <div
          className="text-[13px] font-semibold"
          style={{ color: regimeColor }}
        >
          {t(locale, `regime.${meta.regimeStatus}` as Parameters<typeof t>[1])}
        </div>
      </Section>

      {/* Practitioner Q&A */}
      {hasQA && (
        <Section title={t(locale, "section.practitioner_qa")}>
          <div className="flex flex-col gap-3">
            {qaFields.map(([key, qa]) =>
              qa ? (
                <QARow
                  key={key}
                  fieldKey={t(locale, key as Parameters<typeof t>[1])}
                  qa={qa}
                  statusLabel={t(locale, `status.${qa.status}` as Parameters<typeof t>[1])}
                />
              ) : null,
            )}
          </div>
        </Section>
      )}

      {/* Last updated */}
      {meta.lastUpdated && (
        <div className="text-[11px] text-muted border-t border-black/[.06] pt-3">
          {t(locale, "panel.last_updated")} {meta.lastUpdated}
        </div>
      )}
    </div>
  );
}
