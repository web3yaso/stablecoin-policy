import { readSupabaseConfig, SupabaseHttpClient } from "../data/supabase-client";
import type { PublicLegalCorpusRepository } from "./public-repository";
import { SupabasePublicLegalCorpusRepository } from "./supabase-public-repository";

let repository: PublicLegalCorpusRepository | undefined;

export function getPublicLegalCorpusRepository(): PublicLegalCorpusRepository {
  repository ??= new SupabasePublicLegalCorpusRepository(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  return repository;
}
