import type { NextConfig } from "next";
import { RETIRED_ROUTES } from "./lib/retired-routes";

const nextConfig: NextConfig = {
  // Strip console.* in production builds while retaining operational errors.
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
    ],
    // Turbopack: persist compiler artifacts on disk between `next dev`
    // restarts. Free cold-start speedup.
    turbopackFileSystemCacheForDev: true,
  },

  async redirects() {
    return [...RETIRED_ROUTES];
  },
};

export default nextConfig;
