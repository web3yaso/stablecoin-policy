"use client";

import { useMemo, useState } from "react";
import FadeInOnView from "@/components/ui/FadeInOnView";

type Scope = "all" | "americas" | "europe" | "asia";

type StablecoinFigure = {
  id: string;
  name: string;
  role: string;
  scope: Exclude<Scope, "all">;
  summary: string;
  keyPoints?: string[];
};

const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: "all", label: "All" },
  { key: "americas", label: "Americas" },
  { key: "europe", label: "Europe" },
  { key: "asia", label: "Asia-Pacific" },
];

const PREVIEW_FIGURES: StablecoinFigure[] = [
  {
    id: "us-hagerty",
    name: "Bill Hagerty",
    role: "Senator · GENIUS Act sponsor · Senate Banking Committee",
    scope: "americas",
    summary:
      "One of the clearest congressional champions of a federal payment-stablecoin framework, with a focus on reserve standards, issuer licensing and U.S. dollar competitiveness.",
    keyPoints: [
      "Lead sponsor associated with the GENIUS Act push in the Senate.",
      "Frames stablecoins as payments infrastructure and a dollar-policy issue.",
    ],
  },
  {
    id: "us-lummis",
    name: "Cynthia Lummis",
    role: "Senator · Senate Banking Committee · digital-asset lead",
    scope: "americas",
    summary:
      "A high-signal Senate voice on crypto and stablecoins, consistently pushing for clearer federal rules and a market structure that distinguishes compliant dollar-backed tokens from riskier designs.",
    keyPoints: [
      "Promotes federal clarity over fragmented state-by-state treatment.",
      "Often links stablecoin rules to broader digital-asset legislation.",
    ],
  },
  {
    id: "us-gillibrand",
    name: "Kirsten Gillibrand",
    role: "Senator · bipartisan stablecoin framework co-author",
    scope: "americas",
    summary:
      "Gillibrand has been central to the bipartisan drafting camp in Washington, emphasizing consumer protection, reserve integrity and a workable path for compliant non-bank issuers.",
    keyPoints: [
      "Frequently works across party lines on digital-asset bills.",
      "Balances innovation language with reserve and disclosure guardrails.",
    ],
  },
  {
    id: "us-hill",
    name: "French Hill",
    role: "Representative · House Financial Services Committee Chair",
    scope: "americas",
    summary:
      "Hill is one of the most important House gatekeepers for stablecoin bills, with direct influence over committee sequencing, markup priorities and the shape of issuer oversight in the House.",
    keyPoints: [
      "Controls one of the main House venues for stablecoin legislation.",
      "Often frames stablecoins as a U.S. financial-innovation priority.",
    ],
  },
  {
    id: "ca-csa",
    name: "Canadian Securities Administrators (CSA)",
    role: "Provincial regulators · interim VRCA rules for trading platforms",
    scope: "americas",
    summary:
      "Before Canada's new federal stablecoin regime is fully live, the CSA remains the main practical gatekeeper for which fiat-referenced tokens can appear on Canadian trading platforms.",
    keyPoints: [
      "Uses the VRCA framework to impose reserve, redemption and custody conditions.",
      "Still matters even after the federal Stablecoin Act was enacted.",
    ],
  },
  {
    id: "hk-hkma",
    name: "Hong Kong Monetary Authority (HKMA)",
    role: "Regulator · first stablecoin issuer licences under Cap. 656",
    scope: "asia",
    summary:
      "HKMA now runs one of the world's clearest dedicated licensing regimes for fiat-referenced stablecoins, with reserve, stabilisation and redemption standards already in force.",
    keyPoints: [
      "Stablecoins Ordinance took effect on 1 August 2025.",
      "Granted the first two issuer licences on 10 April 2026.",
    ],
  },
  {
    id: "sg-mas",
    name: "Monetary Authority of Singapore (MAS)",
    role: "Regulator · single-currency stablecoin framework",
    scope: "asia",
    summary:
      "MAS is still one of the global reference setters for a conservative but innovation-friendly stablecoin regime, especially around reserve backing, redemptions and use of the 'MAS-regulated stablecoin' label.",
    keyPoints: [
      "Framework centres on SGD- or G10-backed single-currency stablecoins.",
      "Pairs stablecoin rules with broader digital-payment-token supervision.",
    ],
  },
  {
    id: "jp-fsa",
    name: "Financial Services Agency (Japan)",
    role: "Regulator · EPI framework for fiat-backed stablecoins",
    scope: "asia",
    summary:
      "Japan's FSA oversees one of the most conservative stablecoin systems: fiat-backed, par-redeemable tokens are treated as electronic payment instruments and kept inside a tightly supervised issuer perimeter.",
    keyPoints: [
      "Core stablecoin framework has applied since June 2023.",
      "Restricts issuance and handling to licensed entities under the PSA regime.",
    ],
  },
  {
    id: "au-asic",
    name: "ASIC",
    role: "Australia regulator · stablecoin distribution relief",
    scope: "asia",
    summary:
      "Australia does not yet have a standalone stablecoin statute in force, so ASIC has become the key actor through class relief and interpretation of existing financial-services law.",
    keyPoints: [
      "Instrument 2025/631 opened targeted distribution relief in September 2025.",
      "Broader relief for certain stablecoins and wrapped tokens followed in December 2025.",
    ],
  },
  {
    id: "uk-fca",
    name: "Financial Conduct Authority (FCA)",
    role: "UK regulator · future qualifying stablecoin authorisations",
    scope: "europe",
    summary:
      "The FCA is shaping how the UK's not-yet-commenced stablecoin regime will work in practice, including authorisation expectations for firms that want to issue or safeguard qualifying stablecoins.",
    keyPoints: [
      "Consulted on future-regime guidance in April 2026.",
      "Expected to begin taking authorisation applications from September 2026.",
    ],
  },
  {
    id: "uk-boe",
    name: "Bank of England (BoE)",
    role: "Central bank · systemic stablecoin oversight",
    scope: "europe",
    summary:
      "The BoE remains the key institution for the UK's systemic stablecoin perimeter, especially where a token or payment arrangement grows large enough to matter for financial stability.",
    keyPoints: [
      "Separate from the FCA's firm-by-firm conduct and authorisation role.",
      "Critical for any at-scale sterling stablecoin design.",
    ],
  },
  {
    id: "de-bafin",
    name: "BaFin",
    role: "Germany regulator · MiCA supervisor for issuers and CASPs",
    scope: "europe",
    summary:
      "BaFin is one of the most important national supervisors inside the MiCA system, especially for euro stablecoin projects and enforcement against structures that do not fit the authorised perimeter.",
    keyPoints: [
      "Applies MiCA's EMT and ART rules in Germany.",
      "Has already taken visible action against non-compliant token structures.",
    ],
  },
  {
    id: "ch-finma",
    name: "FINMA",
    role: "Swiss regulator · bank-guarantee model for stablecoins",
    scope: "europe",
    summary:
      "FINMA's guidance matters because Switzerland still offers an alternative model: some stablecoin structures may avoid full banking treatment if redemption claims are protected through a compliant Swiss bank guarantee.",
    keyPoints: [
      "Guidance 06/2024 remains the core reference point.",
      "Shows a different supervisory path from MiCA's issuer-licensing model.",
    ],
  },
];

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase();
}

export default function PoliticiansOverview() {
  const [scope, setScope] = useState<Scope>("all");

  const rows = useMemo(
    () =>
      scope === "all"
        ? PREVIEW_FIGURES
        : PREVIEW_FIGURES.filter((p) => p.scope === scope),
    [scope],
  );

  const totals = useMemo(() => {
    const counts = { americas: 0, europe: 0, asia: 0 };
    for (const person of PREVIEW_FIGURES) counts[person.scope] += 1;
    return counts;
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => {
            const active = scope === s.key;
            const count =
              s.key === "all"
                ? PREVIEW_FIGURES.length
                : totals[s.key as keyof typeof totals];
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setScope(s.key)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? "bg-ink text-white"
                    : "bg-black/[.04] text-muted hover:bg-black/[.08] hover:text-ink"
                }`}
              >
                {s.label}
                <span className={`ml-1.5 ${active ? "text-white/60" : "text-muted/70"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-xs text-muted">
          Stablecoin-focused preview
        </div>
      </div>

      <PersonTileGrid rows={rows} />
    </div>
  );
}

function PersonTileGrid({ rows }: { rows: StablecoinFigure[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? rows.find((p) => p.id === activeId) ?? null : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((p, i) => (
          <FadeInOnView key={p.id} delay={Math.min(i * 40, 320)}>
            <PersonTile
              p={p}
              isActive={p.id === activeId}
              onToggle={() => setActiveId((id) => (id === p.id ? null : p.id))}
            />
          </FadeInOnView>
        ))}
      </div>
      <PersonDetail person={active} onClose={() => setActiveId(null)} />
    </div>
  );
}

function PersonDetail({
  person,
  onClose,
}: {
  person: StablecoinFigure | null;
  onClose: () => void;
}) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ gridTemplateRows: person ? "1fr" : "0fr" }}
      aria-hidden={!person}
    >
      <div
        className={`overflow-hidden transition-opacity duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
          person ? "opacity-100 delay-100" : "opacity-0"
        }`}
      >
        {person && (
          <div className="mt-2 rounded-2xl bg-white shadow-[0_6px_20px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.03)] p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <Avatar name={person.name} />
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink tracking-tight">
                    {person.name}
                  </div>
                  <div className="text-xs text-muted mt-0.5 leading-snug">
                    {person.role}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-muted hover:text-ink shrink-0 mt-1"
              >
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M3 3L9 9M9 3L3 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <p className="text-sm text-ink leading-[1.55] max-w-prose">
              {person.summary}
            </p>

            {(person.keyPoints?.length ?? 0) > 0 && (
              <ul className="flex flex-col gap-2">
                {person.keyPoints!.slice(0, 3).map((pt, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 text-[13px] text-ink/80 leading-snug"
                  >
                    <span
                      className="mt-[.55em] w-1 h-1 rounded-full bg-ink/30 shrink-0"
                      aria-hidden
                    />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PersonTile({
  p,
  isActive,
  onToggle,
}: {
  p: StablecoinFigure;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isActive}
      className={`group rounded-2xl p-4 flex items-start gap-3 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] text-left ${
        isActive
          ? "bg-white shadow-[0_6px_20px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.03)]"
          : "bg-bg/60 hover:bg-white hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.03)]"
      }`}
    >
      <Avatar name={p.name} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink tracking-tight truncate">
          {p.name}
        </div>
        <div className="text-xs text-muted mt-0.5 leading-snug line-clamp-2">
          {p.role}
        </div>
      </div>
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = initialsFor(name);
  return (
    <div className="w-10 h-10 rounded-full bg-black/[.04] flex items-center justify-center text-[11px] font-medium text-muted flex-shrink-0">
      {initials}
    </div>
  );
}
