import type { NextConfig } from "next";

// Cache Components stays off: every page is per-user and rendered at request time.
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
};

export default nextConfig;
