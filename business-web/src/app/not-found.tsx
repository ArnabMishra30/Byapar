import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-5xl font-bold text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold text-foreground">This page does not exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be old, or the page may have moved.
      </p>
      <Button asChild>
        <Link href="/shop/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}
