"use client";

import { Download, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Print, download and share for any document page.
 *
 * Print and Download both use the browser's print dialog, which every browser
 * can "Save as PDF" from. No PDF is generated on this side. Mark anything that
 * must not appear on paper (buttons, tabs) with the data-print-hide attribute;
 * globals.css hides it, along with the app's sidebar and header.
 *
 * Share uses the phone's own share sheet where there is one (WhatsApp, SMS…)
 * and copies the link everywhere else.
 */
export function PrintActions({ title }: { title?: string }) {
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: title ?? document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      /* the user closed the share sheet */
    }
  };

  return (
    <div className="flex flex-wrap gap-2" data-print-hide>
      <Button variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        Print
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          toast.info('Choose "Save as PDF" in the print window.');
          window.print();
        }}
      >
        <Download className="h-4 w-4" />
        Download
      </Button>
      <Button variant="outline" size="sm" onClick={share}>
        <Share2 className="h-4 w-4" />
        Share
      </Button>
    </div>
  );
}
