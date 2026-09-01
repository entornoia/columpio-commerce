import type { NextConfig } from "next";
import { publicAppOrigin } from "./src/lib/public-origin";

const publicOrigin = process.env.NODE_ENV === "development" ? publicAppOrigin() : null;

const nextConfig: NextConfig = {
  allowedDevOrigins: publicOrigin ? [new URL(publicOrigin).hostname] : undefined,
};

export default nextConfig;
