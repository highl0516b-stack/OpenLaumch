import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname),
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack(config) {
    if (!config.resolve) config.resolve = {};
    if (!config.resolve.alias) config.resolve.alias = {};
    Object.assign(config.resolve.alias, {
      "@/components": require("path").resolve(__dirname, "components"),
      "@openlaunch/core": require("path").resolve(__dirname, "../../packages/core/dist"),
    });
    return config;
  },
};

export default nextConfig;