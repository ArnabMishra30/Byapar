"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronRight, ScanLine } from "lucide-react";
import { UploadBillDialog } from "./bill-list";
import { Can } from "@/components/shared/permission-gate";

/**
 * The first thing on the dashboard, and deliberately the loudest.
 *
 * WHY IT EARNS THE TOP OF THE SCREEN. Typing a purchase means a supplier, a
 * date, an invoice number and a line per item - a minute or two on a phone
 * keyboard, standing at a counter. Photographing the bill is one tap. If the
 * fast path is buried under a row of small equal-weight buttons, people use the
 * slow one and conclude the product is slow.
 *
 * So it is a full-width card, not a tile in the quick-actions grid, and the
 * camera is the primary verb.
 */
export function ScanBillCta() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  // Which of the two buttons was pressed, so the dialog can open straight into
  // the camera instead of a file picker.
  const [startWithCamera, setStartWithCamera] = React.useState(false);

  const openWith = (camera: boolean) => {
    setStartWithCamera(camera);
    setOpen(true);
  };

  return (
    <Can do="purchases.draft">
      <section>
        <div className="overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <ScanLine className="h-6 w-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-tight sm:text-lg">
                  Scan a bill
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Photograph it and we read it for you. You check it before anything is saved.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              {/* The camera is the primary action. On a phone this opens the
                  camera directly; on a desktop the browser falls back to a file
                  picker, which is the sensible thing there anyway. */}
              <button
                type="button"
                onClick={() => openWith(true)}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:bg-primary/80 sm:flex-none"
              >
                <Camera className="h-5 w-5" aria-hidden />
                Take photo
              </button>

              <button
                type="button"
                onClick={() => openWith(false)}
                className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
              >
                Upload
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
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
              router.push(`/shop/bills/${bill.id}`);
            } else {
              router.push("/shop/bills");
            }
          }}
        />
      </section>
    </Can>
  );
}
