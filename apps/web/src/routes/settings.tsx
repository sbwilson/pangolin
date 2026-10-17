import { createRoute } from "@tanstack/react-router";
import { ThemeSwitcher } from "../components/ThemeSwitcher.tsx";
import { rootRoute } from "./root.tsx";

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">Settings</h1>
      </header>
      <div id="appearance" className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <ThemeSwitcher />
      </div>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
