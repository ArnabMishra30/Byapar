import { AuthGuard } from "@/components/layout/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { SubscriptionNotice } from "@/features/subscription/subscription-notice";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-muted/20">
        {/* Sidebar from lg up; below that the header owns navigation. */}
        <div className="sticky top-0 hidden h-screen lg:block" data-app-chrome>
          <Sidebar />
        </div>

        {/* min-w-0 is what stops a wide table stretching the whole layout. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />

          {/*
            Sits directly under the header, above every page, so a shop whose
            plan is running out sees it wherever they are. It renders nothing at
            all when there is nothing to say.
          */}
          <div data-app-chrome>
            <SubscriptionNotice />
          </div>

          {/* Bottom padding below lg leaves room for the mobile tab bar. */}
          <main className="mx-auto w-full max-w-7xl flex-1 animate-fade-in px-3 pb-24 pt-4 sm:px-6 sm:pt-6 lg:pb-6">
            {children}
          </main>
        </div>
      </div>
      <MobileTabBar />
    </AuthGuard>
  );
}
