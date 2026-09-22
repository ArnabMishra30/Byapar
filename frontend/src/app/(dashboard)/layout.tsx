"use client";

import React from "react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-muted/20">
        {/* Desktop / Laptop Sidebar */}
        <div className="hidden md:flex h-screen sticky top-0 shrink-0 z-30">
          <Sidebar />
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col min-w-0 overflow-x-hidden">
          <Header />
          <main className="flex-1 px-3 py-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto animate-fade-in">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
