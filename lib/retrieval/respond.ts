import type { EvidenceSearchRequest, EvidenceSearchResponse } from "./contracts";
import type { EvidenceSearchService } from "./search";

export type EvidenceSearchHttpResult = {
  status: number;
  body: EvidenceSearchResponse;
  headers: Record<string, string>;
};

export async function respondEvidenceSearch(
  service: EvidenceSearchService,
  request: EvidenceSearchRequest,
): Promise<EvidenceSearchHttpResult> {
  const body = await service.search(request);
  return {
    status: body.status === "RETRIEVAL_UNAVAILABLE" ? 503 : 200,
    body,
    headers: {
      "Cache-Control": "no-store",
      "X-Evidence-Assurance": request.filters.assuranceTier,
      "X-Retrieval-Status": body.status,
    },
  };
}
