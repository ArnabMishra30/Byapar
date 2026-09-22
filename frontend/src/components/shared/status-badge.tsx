import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusType =
  | "Active"
  | "Inactive"
  | "Draft"
  | "Posted"
  | "Cancelled"
  | "Reversed"
  | "Pending"
  | "Paid"
  | "Partially Paid"
  | "Overdue"
  | "OPEN"
  | "CLOSED"
  | "DRAFT"
  | "POSTED"
  | "CANCELLED"
  | "REVERSED"
  | "PAID"
  | "PARTIALLY_PAID"
  | "CREDITED"
  | string;

interface StatusBadgeProps {
  status: StatusType | boolean | null | undefined;
  className?: string;
  size?: "sm" | "default";
}

export function StatusBadge({ status, className, size = "default" }: StatusBadgeProps) {
  if (status === null || status === undefined) return null;

  // Handle boolean active status
  if (typeof status === "boolean") {
    return status ? (
      <Badge variant="success" className={cn("capitalize", className)}>
        Active
      </Badge>
    ) : (
      <Badge variant="destructive" className={cn("capitalize", className)}>
        Inactive
      </Badge>
    );
  }

  const s = String(status).toUpperCase();

  switch (s) {
    case "ACTIVE":
    case "PAID":
    case "OPEN":
      return (
        <Badge variant="success" className={cn("capitalize", className)}>
          {s === "PAID" ? "Paid" : s === "ACTIVE" ? "Active" : "Open"}
        </Badge>
      );
    case "INACTIVE":
    case "CANCELLED":
    case "CLOSED":
      return (
        <Badge variant="destructive" className={cn("capitalize", className)}>
          {s === "INACTIVE" ? "Inactive" : s === "CANCELLED" ? "Cancelled" : "Closed"}
        </Badge>
      );
    case "DRAFT":
    case "PENDING":
      return (
        <Badge variant="warning" className={cn("capitalize", className)}>
          {s === "DRAFT" ? "Draft" : "Pending"}
        </Badge>
      );
    case "POSTED":
      return (
        <Badge variant="info" className={cn("capitalize", className)}>
          Posted
        </Badge>
      );
    case "PARTIALLY_PAID":
    case "PARTIALLY PAID":
      return (
        <Badge variant="purple" className={cn("capitalize", className)}>
          Partially Paid
        </Badge>
      );
    case "REVERSED":
    case "CREDITED":
      return (
        <Badge variant="secondary" className={cn("capitalize", className)}>
          {s === "REVERSED" ? "Reversed" : "Credited"}
        </Badge>
      );
    case "OVERDUE":
      return (
        <Badge variant="destructive" className={cn("capitalize font-bold", className)}>
          Overdue
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className={cn("capitalize", className)}>
          {status}
        </Badge>
      );
  }
}
