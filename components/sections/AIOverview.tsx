import newsSummaries from "@/data/news/summaries.json";

function formatRelative(iso: string | undefined): string {
  if (!iso) return "recently";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AIOverview() {
  const regional = newsSummaries.regional as
    | Record<string, { summary?: string }>
    | undefined;
  const summary =
    regional?.na?.summary ??
    "No overview available yet. Run scripts/sync/news.ts to generate one.";
  const updated = formatRelative(newsSummaries.generatedAt);

  return (
    <div className="bg-black/[.02] rounded-3xl p-8">
      <div className="text-[13px] font-medium text-muted tracking-tight flex items-center gap-1.5">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="#F5C518"
          aria-hidden
          className="flex-shrink-0"
        >
          <path d="M7 0L8.27 5.73L14 7L8.27 8.27L7 14L5.73 8.27L0 7L5.73 5.73Z" />
        </svg>
        AI overview · Updated {updated}
      </div>
      <p className="text-sm text-ink/80 leading-relaxed mt-4 max-w-3xl">
        {summary}
      </p>
    </div>
  );
}
