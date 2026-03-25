import { clerkSetup } from "@clerk/testing/playwright";

// Must run as globalSetup (before webServer starts) so the Next.js dev server
// picks up the .clerk/ testing configuration on startup.
export default async function globalSetup() {
  await clerkSetup();
}
