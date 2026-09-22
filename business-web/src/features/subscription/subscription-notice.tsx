"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock } from "lucide-react";
import { subscriptionApi } from "@/lib/api";

/**
 * The renewal notice.
 *
 * A COURTESY, NOT A CONTROL. This tells a shopkeeper why a form is about to
 * refuse them, so they are not left staring at an error. What actually prevents
 * an expired shop from recording business lives in the backend, at the single
 * point every posted document passes through — hiding a banner would change
 * nothing there, and neither would forging one.
 *
 * WHAT AN EXPIRED SHOP CAN STILL DO: read every page of its own books, run every
 * report, and export everything. Only recording NEW business stops. Locking a
 * shop out of its own history to extract a renewal would be a hostage-taking,
 * not a product.
 */

/** Starts nagging this many days out. Early enough to act, late enough to matter. */
const WARN_WITHIN_DAYS = 10;

export function SubscriptionNotice() {
  const { data } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: () => subscriptionApi.getMine(),
    // It changes at most once a day; there is no point asking on every render.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!data) return null;

  // A shop that was never sold a plan is not an expired shop. Nothing to say.
  if (data.status === "NONE") return null;

  if (!data.isEntitled) {
    return (
      <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-destructive">
            {data.status === "CANCELLED"
              ? "Your subscription was cancelled"
              : "Your subscription has ended"}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {data.reason ?? "Renew it to carry on recording business."}{" "}
            Everything you have already recorded stays available to read and export.
          </p>
          <p className="mt-1.5">
            <Link
              href="/shop/subscription"
              className="text-sm font-medium text-destructive underline underline-offset-4"
            >
              What this means and how to renew
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const days = data.daysRemaining;
  if (days === null || days > WARN_WITHIN_DAYS) return null;

  return (
    <div className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {days === 0
            ? "Your subscription ends today"
            : `Your subscription ends in ${days} day${days === 1 ? "" : "s"}`}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {data.plan ? `${data.plan} · ` : ""}
          Ends {data.endDate}. Speak to your sales representative to renew.
        </p>
      </div>
    </div>
  );
}
