import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ hostname: "pbs.twimg.com" }, { hostname: "img.clerk.com" }],
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
