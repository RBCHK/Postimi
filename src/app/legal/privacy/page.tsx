import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Postimi",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to Postimi
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        This is a placeholder. The full privacy policy will be published before Postimi opens to
        paying customers.
      </p>
    </main>
  );
}
