import { ClerkProvider } from "@clerk/nextjs";

/**
 * Shared ClerkProvider wrapper used by both the app shell and the sign-in route.
 * Marketing pages (landing, waitlist, legal) intentionally do NOT mount this —
 * keeping Clerk SDK out of marketing bundles is part of the subdomain split rationale.
 */
export function ClerkProviderWrapper({ children }: { children: React.ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
