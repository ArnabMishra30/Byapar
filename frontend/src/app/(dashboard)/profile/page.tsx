"use client";

import { roleLabel, roleDescription } from "@/lib/auth/roles";

import React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials, formatDate } from "@/lib/utils";
import {
  User,
  Shield,
  Building2,
  Mail,
  Calendar,
  LogOut,
  KeyRound,
  CheckCircle2,
} from "lucide-react";

export default function ProfilePage() {
  const { user, company, logout } = useAuth();

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="border-b pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <User className="w-7 h-7 text-primary" />
          <span>My Profile & Account</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          Manage your personal credentials, session details, and active company assignment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="md:col-span-1 border-border/80 text-center p-6 space-y-4">
          <Avatar className="h-20 w-20 mx-auto border-2 border-primary/20">
            <AvatarFallback className="text-xl font-bold bg-primary/10 text-primary">
              {getInitials(user?.name)}
            </AvatarFallback>
          </Avatar>

          <div className="space-y-1">
            <h3 className="font-bold text-lg text-foreground">{user?.name}</h3>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
            <Badge variant="default" className="mt-2 text-xs font-semibold uppercase">
              {roleLabel(user?.role)}
            </Badge>
          </div>

          <div className="pt-4 border-t w-full">
            <Button
              variant="destructive"
              size="sm"
              onClick={logout}
              className="w-full gap-2 text-xs"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </Button>
          </div>
        </Card>

        {/* Account Details & Active Company */}
        <div className="md:col-span-2 space-y-6">
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Account Information</CardTitle>
              <CardDescription className="text-xs">
                Your authenticated profile details in this system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <User className="w-3.5 h-3.5" />
                    <span>Full Name</span>
                  </div>
                  <p className="font-semibold text-foreground text-sm">
                    {user?.name}
                  </p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Mail className="w-3.5 h-3.5" />
                    <span>Email Address</span>
                  </div>
                  <p className="font-semibold text-foreground text-sm">
                    {user?.email}
                  </p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Shield className="w-3.5 h-3.5" />
                    <span>Role & Authorization</span>
                  </div>
                  <p className="font-semibold text-foreground text-sm">
                    {roleDescription(user?.role)}
                  </p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Assigned Business</span>
                  </div>
                  <p className="font-semibold text-foreground text-sm">
                    {company?.name || "Main Store"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-primary" />
                <span>Security & Active Session</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Your authenticated JWT session context
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3 rounded-lg border bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-semibold text-emerald-900 dark:text-emerald-300">
                    Session Status: Authenticated & Secure
                  </span>
                </div>
                <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                  Bearer JWT Active
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
