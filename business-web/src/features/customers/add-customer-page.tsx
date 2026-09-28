"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { customersApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { whyNot } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { ForbiddenState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { PartyForm } from "@/features/parties/party-form";

/**
 * A whole page rather than a dialog: adding a customer is often the first
 * thing a new shop does, on a phone, and a full page gives the keyboard room.
 * After saving, the shop owner lands on the new customer's page, ready to
 * make a sale or record money.
 */
export function AddCustomerPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href={ROUTES.customers}>
          <ArrowLeft className="h-4 w-4" />
          Customers
        </Link>
      </Button>

      <PageHeader title="Add Customer" description="Only the name is needed. Everything else can be added later." />

      {can("parties.manage") ? (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <PartyForm
              kind="customer"
              mode="create"
              submitLabel="Save customer"
              save={(body) => customersApi.create(body)}
              onCancel={() => router.push(ROUTES.customers)}
              onSaved={(saved) => {
                toast.success(`${saved.name} added`);
                queryClient.invalidateQueries({ queryKey: ["customer"] });
                router.push(DETAIL_ROUTES.customer(saved.id));
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <ForbiddenState message={whyNot("parties.manage")} />
      )}
    </div>
  );
}
