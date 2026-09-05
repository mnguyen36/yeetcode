import type { NextConfig } from "next";

// Two deployment targets from one codebase:
//   STATIC_EXPORT=1  -> fully static bundle for GitHub Pages (no API, no DB)
//   unset            -> server build for Vercel, including /api/runs
const staticExport = process.env.STATIC_EXPORT === "1";

// Set to "/yeetcode" by the Pages workflow; empty everywhere else.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export" as const } : {}),
  basePath: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1", "192.168.1.78"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
