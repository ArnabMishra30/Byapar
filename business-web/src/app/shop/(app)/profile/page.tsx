"use client";

import { LogOut, Mail, Shield, Store } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { roleLabel } from "@/lib/auth/roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { initials } from "@/lib/utils";

/**
 * The signed-in user, and the business they are working in.
 *
 * The company is shown, never chosen. The backend derives it from the token and
 * scopes every query to it, so there is nothing to switch and no company id for
 * this screen to send.
 */
export default function ProfilePage() {
  const { user, company, isAdmin, isGstEnabled, logout } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" description="Your account and your business." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your account</CardTitle>
            <CardDescription>How you sign in to Byapar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarFallback className="text-base">{initials(user?.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{user?.name}</p>
                <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {user?.email}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" aria-hidden />
                Your role
              </span>
              <Badge variant={isAdmin ? "default" : "secondary"}>
                {roleLabel(user?.role)}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "You can do everything in this business, including posting documents, recording money and managing staff."
                : "You can prepare sales, purchases and expenses, and see all your business information. An admin posts documents and records money in and out."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your business</CardTitle>
            <CardDescription>The shop this account belongs to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Store className="h-6 w-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{company?.name ?? "—"}</p>
                <p className="text-sm text-muted-foreground">
                  {isGstEnabled ? "GST registered" : "Not registered for GST"}
                </p>
              </div>
            </div>

            <p className="border-t pt-4 text-xs text-muted-foreground">
              Your account belongs to this business only. All your data is kept separate from every
              other business on Byapar.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium text-foreground">Sign out</p>
            <p className="text-sm text-muted-foreground">
              You will need your email and password to sign back in.
            </p>
          </div>
          <Button variant="outline" onClick={logout} className="gap-2 text-destructive">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
