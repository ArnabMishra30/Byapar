"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Loader2, Store } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const schema = z.object({
  email: z.string().min(1, "Enter your email").email("That does not look like an email"),
  password: z.string().min(1, "Enter your password"),
});

type FormValues = z.infer<typeof schema>;

/**
 * Sign in.
 *
 * NO CREDENTIALS ARE DISPLAYED ON THIS PAGE, and none may ever be added. A
 * login screen that advertises a password is both a security problem and, if
 * the password is wrong, a support problem that looks exactly like a broken
 * login.
 */
function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Only ever an in-app path, so a crafted ?redirect=https://evil.example
  // cannot bounce someone off the site after they sign in.
  const requested = searchParams.get("redirect");
  const redirectTo =
    requested && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/shop/dashboard";

  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      router.replace(redirectTo);
    } catch (error) {
      if (error instanceof ApiError) {
        // Field-level messages from the backend go back onto the fields.
        if (error.fieldErrors?.length) {
          for (const item of error.fieldErrors) {
            const field = item.field.replace(/^body\./, "");
            if (field === "email" || field === "password") {
              setError(field, { message: item.message });
            }
          }
          return;
        }
        setFormError(
          error.isOffline
            ? "Cannot reach the server. Check your connection and try again."
            : error.message,
        );
        return;
      }
      setFormError("Could not sign in. Please try again.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Store className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Byapar</h1>
          <p className="text-sm text-muted-foreground">Sign in to run your business</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Use the account your business gave you.</CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <CardContent className="space-y-4">
              {formError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
                {errors.email ? (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.password)}
                  {...register("password")}
                />
                {errors.password ? (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                ) : null}
              </div>

              {/* isSubmitting stays true until the request settles, so a second
                  press cannot fire a second login. */}
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </CardContent>
          </form>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          For shops with or without GST registration.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-muted/30">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <LoginForm />
    </React.Suspense>
  );
}
