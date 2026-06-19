import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // oracledb is a native module with a .node binary; keep it out of the
  // bundler so it's required at runtime on the server.
  serverExternalPackages: ["oracledb", "postgres"],
};

export default nextConfig;
