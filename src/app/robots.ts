import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/**
 * Host-aware robots.txt.
 * - app.postimi.com / app.lvh.me / *.vercel.app: noindex everything (product surface)
 * - postimi.com / lvh.me: standard marketing allow-list
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  const rawHost = host.split(":")[0].toLowerCase();
  const isApp = rawHost.startsWith("app.") || rawHost.endsWith(".vercel.app");

  if (isApp) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/sign-in", "/app/"],
      },
    ],
    sitemap: "https://postimi.com/sitemap.xml",
  };
}
