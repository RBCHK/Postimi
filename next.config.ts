import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "media.licdn.com" },
      { protocol: "https", hostname: "*.cdninstagram.com" },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
