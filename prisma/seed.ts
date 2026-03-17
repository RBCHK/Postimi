import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Best replies from analytics (Feb 14–27 2026), selected by weighted score:
// likes × 3 + impressions / 1000 + ER × 2
// @mention prefixes stripped, HTML entities decoded
const REPLIES: { content: string; topic: string }[] = [
  {
    // 49♥ | 1541 imp | 6.9% ER
    content:
      "Meanwhile in Vancouver, we literally thank the bus driver every single time we exit. High-fiving fans? That's rookie level politeness up here 🇨🇦",
    topic: "culture",
  },
  {
    // 43♥ | 6967 imp | 2.5% ER
    content:
      '"they used 16M API calls to distill our model" also companies that trained on the entire internet without asking: yeah this hits different 👀 the line between "distillation" and "learning from public output" is getting real blurry and everyone building models knows it..',
    topic: "ai-models",
  },
  {
    // 26♥ | 10264 imp | 0.9% ER
    content:
      'AGAIN.. "Up to 20% faster CPU performance." "Delivers up to 20% faster graphics performance." "Up to 20% more performance than the previous generation." "20% faster than Axx." "Provides up to 20% improvement in performance per watt."',
    topic: "tech-culture",
  },
  {
    // 21♥ | 1795 imp | 2.0% ER
    content:
      "Chinese New Year broadcast, 1 billion viewers, kung fu robots. Somewhere a Boston Dynamics engineer is staring at the ceiling tonight.",
    topic: "robotics",
  },
  {
    // 10♥ | 7056 imp | 0.8% ER
    content: "The most human thing left in this workflow is closing other's PRs",
    topic: "dev-humor",
  },
  {
    // 7♥ | 3652 imp | 0.9% ER
    content:
      "refusing a handshake at an AI safety summit is its own safety signal. Turns out the alignment problem isn't just in the models",
    topic: "ai-safety",
  },
  {
    // 7♥ | 1118 imp | 1.4% ER
    content:
      "Google paid billions to be the default. Perplexity just got there through Bixby's back door 👏👏👏",
    topic: "ai-models",
  },
  {
    // 6♥ | 3221 imp | 0.4% ER
    content:
      '"on live" part is what gets me. shipping when you don\'t know if it works yet.. that\'s scarier than any tech stack 😬 and the "on live" part is the real product. the app is secondary. doing it privately and shipping the same thing? totally different outcome',
    topic: "product",
  },
  {
    // 6♥ | 512 imp | 2.3% ER
    content:
      "Ordered a Tesla. It drove itself from the factory. Stopped at three Superchargers, picked up a passenger, made $47, and arrived slightly profitable 🤑",
    topic: "ai-future",
  },
  {
    // 6♥ | 209 imp | 4.8% ER
    content:
      "Hiring an HR chief while your own product replaces HR functions. The irony isn't lost on anyone 🤪",
    topic: "ai-business",
  },
  {
    // 5♥ | 518 imp | 2.7% ER
    content:
      'We\'re moving from "AI as a tool you use" to "AI as a team that works for you". Research agent → summary agent → writing agent → editor agent → scheduling agent. All automated. All coordinated. All invisible.. Making this work reliably at scale is the hard part.',
    topic: "ai-future",
  },
  {
    // 4♥ | 333 imp | 3.0% ER
    content:
      "Serif font too ugly -> switched to Claude. Claude sends DMCA -> everyone switches to Codex. At this rate, we're one controversy away from a Comic Sans AI comeback",
    topic: "ai-humor",
  },
  {
    // 4♥ | 50 imp | 16.0% ER
    content:
      "The scary number isn't 90% accuracy. it's 99% precision across a year-long gap. Your writing style is more consistent than your fingerprint, and you've been leaving it eve-ry-whe-re......",
    topic: "ai-identity",
  },
  {
    // 4♥ | 41 imp | 17.1% ER
    content:
      "at this point 'pursuit of truth' in AI just means 'aligned with the founder's worldview' 🤷‍♀️",
    topic: "ai-ethics",
  },
  {
    // 2♥ | 453 imp | 1.8% ER
    content:
      "Wait, 9 out of 10 grandmas can't even install a regular app from the app store. That's what kids are for. The app store was never built for grandmas — first, power users built it, then grandmas showed up.",
    topic: "tech-culture",
  },
  // Additional high-quality replies
  {
    content:
      "the benchmark arms race is just marketing at this point. 'state of the art on MMLU' and then it hallucinates a Supreme Court case from 2031",
    topic: "ai-models",
  },
  {
    content:
      "every 'AI killed my job' post has 10x the engagement of 'AI saved me 3 hours today'. we're optimizing for anxiety, not outcomes",
    topic: "ai-culture",
  },
  {
    content:
      "context window got 10x bigger. somehow the prompts got 10x worse. there's a lesson in there somewhere",
    topic: "dev-humor",
  },
  {
    content:
      "the real moat isn't the model. it's the 200 hours of domain-specific prompts nobody wrote down anywhere",
    topic: "ai-business",
  },
  {
    content:
      "shipped 6 features this week. Claude wrote 80% of it. still had to delete 40% of what Claude wrote. the leverage is real, the babysitting is too",
    topic: "product",
  },
];

// Standalone posts (Post type) — hooks, takes, threads openers
const POSTS: { content: string; topic: string }[] = [
  {
    content:
      "The app store was never built for grandmas.\n\nFirst, power users stress-tested every edge case.\nThen developers optimized for the people who actually leave reviews.\nThen grandmas showed up because it finally worked.\n\nEvery platform follows this pattern. You're not building for the mass market. You're building for the people who will make it safe enough for the mass market.",
    topic: "product",
  },
  {
    content:
      "Everyone is racing to add AI to their product.\n\nAlmost nobody is asking: what does the user lose when AI handles this?\n\nSpeed? Usually yes. Ownership of the decision? Sometimes. The skill of doing it themselves? Always.\n\nThe products that win won't be the ones that automate the most. They'll be the ones that know exactly what not to automate.",
    topic: "ai-product",
  },
  {
    content:
      "Hot take: the 'vibe coding' discourse is just developers discovering that writing is also a skill.\n\nYou still have to know what you want. You still have to recognize when the output is wrong. You still have to debug the thing that almost works.\n\nThe skill shifted. It didn't disappear.",
    topic: "dev-culture",
  },
  {
    content:
      "Your writing voice is more unique than you think.\n\nSentence length patterns. Word choice under pressure. How you open vs. how you close.\n\n99% precision across a year of posts. That's not style — that's a fingerprint.\n\nYou've been leaving it everywhere.",
    topic: "ai-identity",
  },
  {
    content:
      "The best reply isn't the cleverest one.\n\nIt's the one the author screenshots and shares.\n\nMost people optimize for their own timeline. The algorithm rewards what the original poster amplifies.",
    topic: "x-strategy",
  },
  {
    content:
      "Three signs a company is faking AI integration:\n\n1. The 'AI feature' is just a search bar with GPT autocomplete\n2. The demo works flawlessly, the product is in 'beta' for 18 months\n3. The CEO talks about AI at every conference but the engineers are still on waitlists\n\nThe real integrations are quiet. They show up in the P&L.",
    topic: "ai-business",
  },
  {
    content:
      "Unpopular opinion: most 'founder mode' content is just burnout with better branding.\n\nWorking 80 hours a week isn't a strategy. It's a symptom.\n\nThe founders who last aren't the ones who never sleep. They're the ones who figured out which 10 hours actually move the needle.",
    topic: "founders",
  },
];

async function main() {
  // Seed requires at least one user — find or create a placeholder
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        clerkId: "seed_placeholder",
        email: "seed@example.com",
        name: "Seed User",
      },
    });
    console.log("Created placeholder user for seed data.");
  }

  const existing = await prisma.voiceBankEntry.count();
  if (existing > 0) {
    console.log(`Voice Bank already has ${existing} entries. Skipping seed.`);
    return;
  }

  console.log(`Seeding ${REPLIES.length} reply examples...`);
  for (const reply of REPLIES) {
    await prisma.voiceBankEntry.create({
      data: { content: reply.content, type: "REPLY", topic: reply.topic, userId: user.id },
    });
  }

  console.log(`Seeding ${POSTS.length} post examples...`);
  for (const post of POSTS) {
    await prisma.voiceBankEntry.create({
      data: { content: post.content, type: "POST", topic: post.topic, userId: user.id },
    });
  }

  console.log(`Done. Total: ${REPLIES.length + POSTS.length} entries.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
