import { ClerkProviderWrapper } from "@/components/clerk-provider-wrapper";

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <ClerkProviderWrapper>{children}</ClerkProviderWrapper>;
}
