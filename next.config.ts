import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/leads/discover": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  serverExternalPackages: ["firebase-admin", "@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
