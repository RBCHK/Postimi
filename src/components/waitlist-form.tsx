"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistResult, type WaitlistError } from "@/app/actions/waitlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ERROR_MESSAGES: Record<WaitlistError, string> = {
  invalid: "Please enter a valid email address.",
  rate_limited: "Too many attempts. Please try again in a few minutes.",
  server_error: "Something went wrong. Please try again.",
};

type Props = {
  source: string;
  className?: string;
};

export function WaitlistForm({ source, className }: Props) {
  const [state, action, pending] = useActionState<WaitlistResult | null, FormData>(
    async (_prev, formData) => {
      return joinWaitlist({
        email: formData.get("email"),
        source,
        locale: typeof navigator !== "undefined" ? navigator.language?.slice(0, 2) : undefined,
      });
    },
    null
  );

  return (
    <form action={action} className={className} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@example.com"
          aria-label="Email address"
          className="h-11 text-base sm:flex-1"
          disabled={pending || state?.ok === true}
        />
        <Button type="submit" size="lg" disabled={pending || state?.ok === true}>
          {pending ? "Joining…" : state?.ok === true ? "You're on the list" : "Join waitlist"}
        </Button>
      </div>
      <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">
        {state?.ok === true && (
          <p className="text-green-600 dark:text-green-400">
            You&apos;re on the list. We&apos;ll be in touch.
          </p>
        )}
        {state?.ok === false && (
          <p className="text-red-600 dark:text-red-400">{ERROR_MESSAGES[state.error]}</p>
        )}
      </div>
    </form>
  );
}
