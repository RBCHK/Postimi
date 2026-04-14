"use client";

import Link from "next/link";

type ParsedAiError =
  | { kind: "subscription_required" }
  | { kind: "quota_exceeded"; usedUsd: number; limitUsd: number }
  | { kind: "rate_limit"; limitPerMinute: number }
  | { kind: "generic"; message: string };

function parseAiError(error: Error): ParsedAiError {
  // AI SDK v6 puts response JSON body into error.message for non-2xx responses.
  try {
    const body = JSON.parse(error.message);
    if (body?.error === "subscription_required") return { kind: "subscription_required" };
    if (body?.error === "quota_exceeded") {
      return {
        kind: "quota_exceeded",
        usedUsd: Number(body.usedUsd ?? 0),
        limitUsd: Number(body.limitUsd ?? 0),
      };
    }
    if (body?.error === "rate_limit") {
      return { kind: "rate_limit", limitPerMinute: Number(body.limitPerMinute ?? 30) };
    }
  } catch {
    // fall through to generic
  }
  return { kind: "generic", message: error.message || "Ошибка при обращении к модели" };
}

export function AiErrorBanner({ error }: { error: Error }) {
  const parsed = parseAiError(error);

  if (parsed.kind === "subscription_required") {
    return (
      <Banner tone="warn">
        Для использования AI нужна активная подписка.{" "}
        <Link href="/app/settings/billing" className="underline font-medium">
          Оформить Postimi Pro
        </Link>
      </Banner>
    );
  }

  if (parsed.kind === "quota_exceeded") {
    return (
      <Banner tone="warn">
        Месячный лимит AI исчерпан: ${parsed.usedUsd.toFixed(2)} / ${parsed.limitUsd.toFixed(2)}.{" "}
        <Link href="/app/settings/billing" className="underline font-medium">
          Настройки биллинга
        </Link>
      </Banner>
    );
  }

  if (parsed.kind === "rate_limit") {
    return (
      <Banner tone="warn">
        Слишком много запросов ({parsed.limitPerMinute}/мин). Подожди минуту и попробуй снова.
      </Banner>
    );
  }

  return <Banner tone="error">{parsed.message}</Banner>;
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : "border-red-500/20 bg-red-500/10 text-red-400";
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-2">
      <p className={`rounded-lg border px-4 py-2 text-sm ${cls}`}>{children}</p>
    </div>
  );
}
