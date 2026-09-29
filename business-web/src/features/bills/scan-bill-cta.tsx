"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, ScanLine, Upload } from "lucide-react";
import { UploadBillDialog } from "./bill-list";
import { Can } from "@/components/shared/permission-gate";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";

/**
 * "Scan a bill" - the other fast path, beside Quick Billing on Home.
 *
 * Typing a purchase means a supplier, a date, an invoice number and a line per
 * item: minutes on a phone keyboard. Photographing the bill is one tap. So it
 * gets a big tile of its own rather than a small one in the grid, and the
 * camera is the primary verb. The upload dialog opens right here, without
 * leaving Home.
 */
export function ScanBillCta() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  // Which button was pressed, so the dialog can open straight into the camera.
  const [startWithCamera, setStartWithCamera] = React.useState(false);

  const openWith = (camera: boolean) => {
    setStartWithCamera(camera);
    setOpen(true);
  };

  return (
    <Can do="bills.upload">
      <div className="flex min-h-[4.5rem] min-w-0 flex-col gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ScanLine className="h-6 w-6" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-bold text-foreground sm:text-lg">Scan a Bill</span>
            <span className="block text-xs text-muted-foreground sm:text-sm">
              Photograph it, we read it, you check it
            </span>
          </span>
        </div>

        <div className="flex shrink-0 gap-2">
          {/* On a phone this opens the camera; on a desktop the browser falls
              back to a file picker, which is right there anyway. */}
          <button
            type="button"
            onClick={() => openWith(true)}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:flex-none"
          >
            <Camera className="h-4 w-4" aria-hidden />
            Take photo
          </button>
          <button
            type="button"
            onClick={() => openWith(false)}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted sm:flex-none"
          >
            <Upload className="h-4 w-4" aria-hidden />
            Upload
          </button>
        </div>
      </div>

      <UploadBillDialog
        open={open}
        onOpenChange={setOpen}
        startWithCamera={startWithCamera}
        onUploaded={(bill) => {
          // Straight to the review screen when there is something to check -
          // that is the whole point of the shortcut.
          if (bill.status === "REVIEW" || bill.status === "FAILED") {
            router.push(DETAIL_ROUTES.bill(bill.id));
          } else {
            router.push(ROUTES.bills);
          }
        }}
      />
    </Can>
  );
}
