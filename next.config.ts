import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is shared over the local network for phone/PC testing.
  allowedDevOrigins: ["192.168.254.114"],
};

export default nextConfig;
