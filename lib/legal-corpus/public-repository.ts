import type {
  ChangesResponse,
  CoverageResponse,
  PublicSourceResponse,
} from "./public-contracts";

export interface PublicLegalCorpusRepository {
  getCoverage(): Promise<CoverageResponse>;
  findSource(documentId: string): Promise<PublicSourceResponse | null>;
  listChanges(afterCursor?: string): Promise<ChangesResponse>;
}

