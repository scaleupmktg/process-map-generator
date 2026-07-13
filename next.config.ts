import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The /skill bundle is read from disk at request time by loadSkill().
  // Ensure those files are traced into the serverless function for /api/extract.
  outputFileTracingIncludes: {
    "/api/extract": ["./skill/**/*"],
  },
};

export default nextConfig;
