"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * The last line of defence. A React crash shows this instead of a white screen,
 * and never shows the user a stack trace.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Sorry — that screen failed to load. Your data is safe.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
