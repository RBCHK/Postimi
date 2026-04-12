import Link from "next/link";

export const metadata = {
  title: "You're on the list — Postimi",
};

export default function WaitlistThankYouPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">You&apos;re on the list.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Thanks for signing up. We&apos;re inviting creators in small batches — keep an eye on your
          inbox.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm underline">
          Back to Postimi
        </Link>
      </div>
    </main>
  );
}
