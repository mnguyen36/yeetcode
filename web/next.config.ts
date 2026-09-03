import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["127.0.0.1", "192.168.1.78"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
