import type { NextConfig } from "next";

const devAllowedOrigin =
  process.env.NODE_ENV === "development"
    ? process.env.PLANME_DEV_ALLOWED_ORIGIN?.trim()
    : undefined;

const nextConfig: NextConfig = {
  transpilePackages: ["@planme/core"],
  allowedDevOrigins: devAllowedOrigin
    ? [devAllowedOrigin.replace(/:\d+$/, "")]
    : undefined,
  experimental: {
    serverActions: {
      allowedOrigins: devAllowedOrigin ? [devAllowedOrigin] : undefined,
    },
  },
};

export default nextConfig;
