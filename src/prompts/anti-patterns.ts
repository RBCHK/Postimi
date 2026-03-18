export const ANTI_PATTERNS = {
  // Words and phrases that immediately signal AI or low-quality content
  bannedWords: [
    "Great point",
    "Totally agree",
    "Well said",
    "Spot on",
    "Fascinating",
    "Insightful",
    "I completely agree",
    "You're right",
    "That's a great",
    "I couldn't agree more",
    "This is so true",
    "Preach",
    "Facts",
    "Banger",
    "Ultimately",
    "Navigate",
    "Testament",
    "Game-changer",
    "Ah,",
  ],

  // Structural patterns that reveal AI authorship
  aiTells: [
    "Using em dash (—) anywhere — the user NEVER uses em dash. It signals AI-polished text instantly. Replace with: ellipsis (...), new line, or comma",
    "Starting with 'I think' or 'I believe'",
    "Bullet-point dump in a reply (3+ bullets)",
    "Ending with an open question ('What do you think?', 'Thoughts?')",
    "Transitional phrases: 'Furthermore', 'Moreover', 'In addition', 'Additionally'",
    "Balanced hedge: 'On one hand... on the other hand'",
    "The word 'delve' or 'crucial' or 'landscape'",
    "Emoji-heavy formatting",
    "Starting reply with the author's name: '@username Great point...'",
    "Starting sentences with 'Remember,' or 'It is important to note'",
    "Overusing exclamation marks to fake enthusiasm",
  ],

  // Content structures to avoid
  bannedStructures: [
    "List-only reply with no connective prose",
    "Restating what the original post already said",
    "Generic encouragement without adding specific value",
    "Ending with a CTA ('Follow me for more', 'Check out my profile')",
    "More than 2 emojis in a reply",
    "Rhetorical question as the entire reply",
    "Summarizing your own reply at the end (no conclusion paragraph needed)",
    "The 'Compliment Sandwich' (praise, critique, praise) — just be direct",
  ],
} as const;

export function formatAntiPatternsForPrompt(): string {
  const { bannedWords, aiTells, bannedStructures } = ANTI_PATTERNS;
  return `
BANNED WORDS (never use): ${bannedWords.join(", ")}

AI TELLS (structural patterns that reveal AI — strictly avoid):
${aiTells.map((t) => `- ${t}`).join("\n")}

BANNED STRUCTURES:
${bannedStructures.map((s) => `- ${s}`).join("\n")}
`.trim();
}
