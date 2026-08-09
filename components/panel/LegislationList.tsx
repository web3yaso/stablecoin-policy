"use client";

import type { Legislation } from "@/types";
import BillTimeline from "@/components/ui/BillTimeline";

export default function LegislationList({
  legislation,
}: {
  legislation: Legislation[];
}) {
  if (legislation.length === 0) {
    return (
      <p className="text-sm text-muted">
        No dedicated Stablecoin legislation is listed for this jurisdiction.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {legislation.map((bill) => (
        <article key={bill.id} className="rounded-2xl bg-bg/70 p-4">
          <div className="text-xs text-muted">{bill.billCode}</div>
          <h3 className="mt-1 text-sm font-medium tracking-tight text-ink">
            {bill.title}
          </h3>
          {bill.summary && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {bill.summary}
            </p>
          )}
          <BillTimeline stage={bill.stage} />
          {bill.sourceUrl && (
            <a
              href={bill.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex text-xs font-medium text-ink hover:underline"
            >
              Official source →
            </a>
          )}
        </article>
      ))}
    </div>
  );
}
