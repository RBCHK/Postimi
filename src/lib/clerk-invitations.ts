import { clerkClient } from "@clerk/nextjs/server";

export interface ClerkInvitation {
  id: string;
  emailAddress: string;
  url?: string;
  status: string;
}

export async function createClerkInvitation(
  email: string,
  redirectUrl: string
): Promise<ClerkInvitation> {
  const client = await clerkClient();
  const inv = await client.invitations.createInvitation({
    emailAddress: email,
    redirectUrl,
    notify: false,
  });
  return {
    id: inv.id,
    emailAddress: inv.emailAddress,
    url: inv.url,
    status: inv.status,
  };
}

export async function revokeClerkInvitation(invitationId: string): Promise<void> {
  const client = await clerkClient();
  await client.invitations.revokeInvitation(invitationId);
}
