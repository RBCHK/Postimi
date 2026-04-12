import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/**
 * Host-aware Web App Manifest.
 * - app host: full PWA with standalone display + start_url pointing to the dashboard.
 *   This is what iPhone installs remember; changing subdomain later = broken installs.
 * - marketing host: minimal metadata, display: "browser" so installation is not offered.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host") ?? "";
  const rawHost = host.split(":")[0].toLowerCase();
  const isApp = rawHost.startsWith("app.") || rawHost.endsWith(".vercel.app");

  if (isApp) {
    return {
      name: "Postimi",
      short_name: "Postimi",
      description: "AI-powered growth copilot for X, LinkedIn, and Threads",
      start_url: "/schedule",
      scope: "/",
      display: "standalone",
      background_color: "#131314",
      theme_color: "#131314",
      orientation: "portrait",
    };
  }

  return {
    name: "Postimi",
    short_name: "Postimi",
    description: "AI growth copilot for creators",
    start_url: "/",
    display: "browser",
  };
}
