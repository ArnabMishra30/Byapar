import type { Metadata } from "next";

// A shared bill is private to whoever was sent the link: never indexed, never
// previewed with its contents by a search engine.
export const metadata: Metadata = {
  title: "Your bill",
  robots: { index: false, follow: false },
};

export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-muted/30">{children}</div>;
}
