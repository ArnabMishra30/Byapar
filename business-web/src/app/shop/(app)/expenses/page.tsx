import { Suspense } from "react";
import { ExpensesPage } from "@/features/expenses/expenses-page";

export default function Page() {
  // ?new=1 opens the form; reading the query string needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ExpensesPage />
    </Suspense>
  );
}
