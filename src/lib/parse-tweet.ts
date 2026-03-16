const TWEET_URL_REGEX = /https?:\/\/(twitter\.com|x\.com)\/\S+/i;

export function extractTweetUrl(text: string): string | null {
  const match = text.match(TWEET_URL_REGEX);
  return match ? match[0] : null;
}

export async function fetchTweetText(url: string): Promise<{ text: string } | { error: string }> {
  try {
    const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
    const res = await fetch(oEmbedUrl, { next: { revalidate: 3600 } });

    if (!res.ok) {
      return { error: "Не удалось загрузить. Вставьте текст вручную" };
    }

    const data = await res.json();
    // Strip HTML tags from the oembed html field to get plain text
    const html: string = data.html ?? "";
    const text = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    if (!text) {
      return { error: "Не удалось загрузить. Вставьте текст вручную" };
    }

    return { text };
  } catch {
    return { error: "Не удалось загрузить. Вставьте текст вручную" };
  }
}

export async function fetchTweetFromText(text: string): Promise<{ text: string } | null> {
  const url = extractTweetUrl(text);
  if (!url) return null;
  const result = await fetchTweetText(url);
  return "text" in result ? result : null;
}
