import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strip console.* in production builds (keeps console.error / warn for
  // genuine problems). Removes the lone bioguide-mismatch warn that ships
  // from lib/politicians-data.ts.
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },

  // Tree-shake heavy deps that ship CJS namespace imports by default.
  // Saves measurable bytes on every page that touches the map or the
  // animation primitives.
  experimental: {
    optimizePackageImports: [
      "framer-motion",
      "d3-geo",
      "react-simple-maps",
      "@number-flow/react",
      "topojson-client",
    ],
    // Turbopack: persist compiler artifacts on disk between `next dev`
    // restarts. Free cold-start speedup.
    turbopackFileSystemCacheForDev: true,
  },

  // Allow next/image to optimize politician portraits and any other
  // remote portraits referenced via `photoUrl`. Any host added here is
  // explicitly trusted — keep the list tight.
  images: {
    // Prefer AVIF — ~20% smaller than WebP for photographic content
    // (politician portraits). Falls back to WebP for unsupported clients.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // unitedstates.github.io serves the Congressional bioguide portraits
      // used for every US politician's photoUrl in data/politicians/*.json.
      { protocol: "https", hostname: "unitedstates.github.io" },
      { protocol: "https", hostname: "bioguide.congress.gov" },
      { protocol: "https", hostname: "www.congress.gov" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "**.europarl.europa.eu" },
      { protocol: "https", hostname: "members-api.parliament.uk" },
    ],
  },
};

export default nextConfig;
