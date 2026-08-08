import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output traces the exact files the server needs and copies them
   * into `.next/standalone`, so the runtime image can skip node_modules and the
   * source tree entirely. It is the difference between roughly 200MB and well
   * over a gigabyte.
   */
  output: "standalone",

  /**
   * better-sqlite3 is a native addon. Bundling it would break the .node binary,
   * so it stays external and is copied into the image as-is.
   */
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
