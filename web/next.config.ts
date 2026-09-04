import type { NextConfig } from "next";

// Set to "/yeetcode" by the Pages workflow; empty for local dev.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1", "192.168.1.78"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
