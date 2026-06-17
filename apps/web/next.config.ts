import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@openlaunch/core"],
  },
};

export default nextConfig;
