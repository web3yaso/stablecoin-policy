export default function AIOverview() {
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
        AI overview · Updated 2 hours ago
      </div>
      <p className="text-sm text-ink/80 leading-relaxed mt-4 max-w-3xl">
        Maine LD 307 passed both chambers and awaits final enactment — it would
        be the first statewide data center moratorium, banning facilities over
        20 MW until November 2027. At the federal level, Sanders and
        Ocasio-Cortez introduced S.4214, the AI Data Center Moratorium Act, in
        March 2026. Virginia&rsquo;s moratorium bill died but HB 2084 (rate
        classification review) was enacted. The pattern holds: state moratoriums
        stall in committee while dozens of municipalities enact construction
        pauses independently.
      </p>
    </div>
  );
}
