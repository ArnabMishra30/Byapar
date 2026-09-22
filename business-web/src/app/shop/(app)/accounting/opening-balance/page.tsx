import { AuthGuard } from "@/components/layout/auth-guard";
import { OpeningBalancePage } from "@/features/accounting/opening-balance-page";

export default function Page() {
  return (
    <AuthGuard requireAdmin>
      <OpeningBalancePage />
    </AuthGuard>
  );
}
