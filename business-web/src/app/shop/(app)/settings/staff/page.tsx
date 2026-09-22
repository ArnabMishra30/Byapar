import { AuthGuard } from "@/components/layout/auth-guard";
import { StaffPage } from "@/features/settings/staff-page";

export default function Page() {
  return (
    <AuthGuard requireAdmin>
      <StaffPage />
    </AuthGuard>
  );
}
