/**
 * LinkedIn API client (Posts API + Image Upload)
 * All functions require LinkedInApiCredentials (OAuth 2.0 per-user tokens from DB).
 */

const REST_BASE = "https://api.linkedin.com/rest";
const LINKEDIN_VERSION = "202504";

export interface LinkedInApiCredentials {
  accessToken: string;
  linkedinUserId: string;
  linkedinName: string | null;
}

const linkedInHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  "X-Restli-Protocol-Version": "2.0.0",
  "LinkedIn-Version": LINKEDIN_VERSION,
});

/**
 * Post a text-only post to LinkedIn.
 */
export async function postToLinkedIn(
  credentials: LinkedInApiCredentials,
  text: string
): Promise<{ postUrn: string }> {
  const body = {
    author: `urn:li:person:${credentials.linkedinUserId}`,
    lifecycleState: "PUBLISHED",
    visibility: "PUBLIC",
    commentary: text,
    distribution: { feedDistribution: "MAIN_FEED" },
  };

  const res = await fetch(`${REST_BASE}/posts`, {
    method: "POST",
    headers: linkedInHeaders(credentials.accessToken),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const respBody = await res.text();
    throw new Error(`LinkedIn post failed ${res.status}: ${respBody}`);
  }

  // LinkedIn returns the post URN in the x-restli-id header
  const postUrn = res.headers.get("x-restli-id") ?? "";

  return { postUrn };
}

/**
 * Upload an image to LinkedIn.
 * Three-step process: initialize upload → upload binary → return image URN.
 */
export async function uploadImageToLinkedIn(
  credentials: LinkedInApiCredentials,
  imageBuffer: Buffer,
  mimeType: string
): Promise<string> {
  // Step 1: Initialize upload
  const initRes = await fetch(`${REST_BASE}/images?action=initializeUpload`, {
    method: "POST",
    headers: linkedInHeaders(credentials.accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: `urn:li:person:${credentials.linkedinUserId}`,
      },
    }),
  });

  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(`LinkedIn image upload init failed ${initRes.status}: ${body}`);
  }

  const initData = (await initRes.json()) as {
    value: { uploadUrl: string; image: string };
  };
  const { uploadUrl, image: imageUrn } = initData.value;

  // Step 2: Upload binary
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(imageBuffer),
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`LinkedIn image binary upload failed ${uploadRes.status}: ${body}`);
  }

  return imageUrn;
}

/**
 * Post to LinkedIn with a single image.
 */
export async function postToLinkedInWithImage(
  credentials: LinkedInApiCredentials,
  text: string,
  imageUrn: string
): Promise<{ postUrn: string }> {
  const body = {
    author: `urn:li:person:${credentials.linkedinUserId}`,
    lifecycleState: "PUBLISHED",
    visibility: "PUBLIC",
    commentary: text,
    distribution: { feedDistribution: "MAIN_FEED" },
    content: {
      media: {
        title: "Image",
        id: imageUrn,
      },
    },
  };

  const res = await fetch(`${REST_BASE}/posts`, {
    method: "POST",
    headers: linkedInHeaders(credentials.accessToken),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const respBody = await res.text();
    throw new Error(`LinkedIn post with image failed ${res.status}: ${respBody}`);
  }

  const postUrn = res.headers.get("x-restli-id") ?? "";

  return { postUrn };
}

/**
 * Post to LinkedIn with multiple images.
 * Uses the multiImage content type.
 */
export async function postToLinkedInWithImages(
  credentials: LinkedInApiCredentials,
  text: string,
  imageUrns: string[]
): Promise<{ postUrn: string }> {
  const body = {
    author: `urn:li:person:${credentials.linkedinUserId}`,
    lifecycleState: "PUBLISHED",
    visibility: "PUBLIC",
    commentary: text,
    distribution: { feedDistribution: "MAIN_FEED" },
    content: {
      multiImage: {
        images: imageUrns.map((urn) => ({ id: urn })),
      },
    },
  };

  const res = await fetch(`${REST_BASE}/posts`, {
    method: "POST",
    headers: linkedInHeaders(credentials.accessToken),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const respBody = await res.text();
    throw new Error(`LinkedIn multi-image post failed ${res.status}: ${respBody}`);
  }

  const postUrn = res.headers.get("x-restli-id") ?? "";

  return { postUrn };
}
