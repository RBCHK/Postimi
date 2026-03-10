import type { CsvRow, CsvSummary, CsvTopPost } from "./types";

function parseNumber(value: string): number {
  const n = parseInt(value.replace(/,/g, "").trim(), 10);
  return isNaN(n) ? 0 : n;
}

// Parses a single CSV line respecting quoted fields
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCsv(raw: string): CsvSummary {
  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV file is empty or has no data rows");
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());

  const idx = {
    postId: headers.indexOf("Post id"),
    date: headers.indexOf("Date"),
    text: headers.indexOf("Post text"),
    impressions: headers.indexOf("Impressions"),
    likes: headers.indexOf("Likes"),
    engagements: headers.indexOf("Engagements"),
    bookmarks: headers.indexOf("Bookmarks"),
    shares: headers.indexOf("Shares"),
    newFollows: headers.indexOf("New follows"),
    replies: headers.indexOf("Replies"),
    reposts: headers.indexOf("Reposts"),
  };

  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 4) continue;

    rows.push({
      postId: fields[idx.postId]?.trim() ?? "",
      date: fields[idx.date]?.trim() ?? "",
      text: fields[idx.text]?.trim() ?? "",
      impressions: parseNumber(fields[idx.impressions] ?? "0"),
      likes: parseNumber(fields[idx.likes] ?? "0"),
      engagements: parseNumber(fields[idx.engagements] ?? "0"),
      bookmarks: parseNumber(fields[idx.bookmarks] ?? "0"),
      shares: parseNumber(fields[idx.shares] ?? "0"),
      newFollows: parseNumber(fields[idx.newFollows] ?? "0"),
      replies: parseNumber(fields[idx.replies] ?? "0"),
      reposts: parseNumber(fields[idx.reposts] ?? "0"),
    });
  }

  if (rows.length === 0) {
    throw new Error("No valid data rows found in CSV");
  }

  const totalPosts = rows.length;
  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
  const avgImpressions = Math.round(totalImpressions / totalPosts);
  const maxImpressions = Math.max(...rows.map((r) => r.impressions));
  const totalNewFollows = rows.reduce((s, r) => s + r.newFollows, 0);
  const totalEngagements = rows.reduce((s, r) => s + r.engagements, 0);
  const avgEngagementRate =
    totalImpressions > 0
      ? Math.round((totalEngagements / totalImpressions) * 10000) / 100
      : 0;

  const dates = rows.map((r) => r.date).filter(Boolean);
  const dateRange = {
    from: dates[dates.length - 1] ?? "",
    to: dates[0] ?? "",
  };

  const topPosts: CsvTopPost[] = [...rows]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5)
    .map((r) => ({
      text: r.text.slice(0, 200),
      impressions: r.impressions,
      engagements: r.engagements,
      likes: r.likes,
    }));

  return {
    totalPosts,
    dateRange,
    avgImpressions,
    maxImpressions,
    totalNewFollows,
    avgEngagementRate,
    topPosts,
  };
}
