"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonViewerProps {
  data: any;
  initialExpanded?: boolean;
  className?: string;
}

export function JsonViewer({
  data,
  initialExpanded = true,
  className,
}: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(initialExpanded);

  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return (
      <span className="text-xs text-muted-foreground italic">
        No additional metadata
      </span>
    );
  }

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("rounded-lg border bg-muted/40 overflow-hidden text-xs", className)}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/70 border-b border-border/60">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 font-mono font-medium text-foreground/80 hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <span>Metadata ({Object.keys(data).length} fields)</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-500" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </Button>
      </div>

      {expanded && (
        <pre className="p-3 font-mono text-[11px] overflow-x-auto max-h-64 text-foreground/90 whitespace-pre-wrap leading-relaxed">
          {jsonString}
        </pre>
      )}
    </div>
  );
}
