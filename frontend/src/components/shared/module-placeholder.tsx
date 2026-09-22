"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LucideIcon, ArrowLeft, Store, Sparkles } from "lucide-react";
import Link from "next/link";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  features?: string[];
}

export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
  features,
}: ModulePlaceholderProps) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3 border-b pb-5">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Icon className="w-7 h-7 text-primary" />
            <span>{title}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>

      <Card className="border-dashed border-border/80 bg-muted/10">
        <CardHeader className="text-center pb-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2">
            <Icon className="w-6 h-6" />
          </div>
          <CardTitle className="text-lg font-bold">{title} Module</CardTitle>
          <CardDescription className="text-xs max-w-md mx-auto">
            Backend API foundation is already live in Express & PostgreSQL. This frontend interface is ready to be connected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg mx-auto pb-8">
          {features && features.length > 0 && (
            <div className="p-4 rounded-xl border bg-card/60 space-y-2 text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>Supported Capabilities</span>
              </span>
              <ul className="space-y-1.5 text-muted-foreground list-disc list-inside">
                {features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-center pt-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">Return to Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
