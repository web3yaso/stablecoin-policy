export interface RetiredRoute {
  source: string;
  destination: string;
  permanent: true;
}

/**
 * Product routes retired by Phase 7. Keep this list explicit and tested so
 * previously indexed URLs never fall through to an ambiguous 404.
 */
export const RETIRED_ROUTES: readonly RetiredRoute[] = [
  { source: "/datacenters", destination: "/", permanent: true },
  { source: "/datacenters/:path*", destination: "/", permanent: true },
  { source: "/politicians", destination: "/", permanent: true },
  { source: "/politicians/:path*", destination: "/", permanent: true },
  { source: "/globe", destination: "/", permanent: true },
];
