import { createRoute } from "@tanstack/react-router";
import { SettingsNav } from "../components/SettingsNav.tsx";
import { SignedInDevices } from "../components/SignedInDevices.tsx";
import { SystemStatus } from "../components/SystemStatus.tsx";
import { ThemeSwitcher } from "../components/ThemeSwitcher.tsx";
import { rootRoute } from "./root.tsx";

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </header>

      <div className="grid items-start gap-7 md:grid-cols-[188px_minmax(0,640px)]">
        <SettingsNav />
        <div className="flex w-full min-w-0 max-w-[640px] flex-col gap-6">
          <section
            id="appearance"
            className="scroll-mt-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <ThemeSwitcher />
          </section>
          <section
            id="devices"
            className="scroll-mt-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <SignedInDevices />
          </section>
          <section
            id="status"
            className="scroll-mt-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <SystemStatus />
          </section>
        </div>
      </div>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
