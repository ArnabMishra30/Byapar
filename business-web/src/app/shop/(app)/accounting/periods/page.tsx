import { AuthGuard } from "@/components/layout/auth-guard";
import { PeriodsPage } from "@/features/accounting/periods-page";

export default function Page() {
  return (
    <AuthGuard requireAdmin>
      <PeriodsPage />
    </AuthGuard>
  );
}
