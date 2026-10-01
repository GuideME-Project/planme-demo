import { resolve } from "node:path";
import type { NextConfig } from "next";

const devAllowedOrigin =
  process.env.NODE_ENV === "development"
    ? process.env.PLANME_DEV_ALLOWED_ORIGIN?.trim()
    : undefined;

const nextConfig: NextConfig = {
  // Docker image runs the traced standalone server; the monorepo root is traced so @planme/core is included.
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
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
