import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils.ts";
import type { Me } from "../api.ts";
import { MascotLogo } from "./MascotLogo.tsx";
import { NeedsReviewBadge } from "./review/index.ts";

export interface AppSidebarProps {
  readonly me: Me;
  readonly signOut: () => Promise<void>;
  readonly className?: string;
}

export function AppSidebar({ me, signOut, className }: AppSidebarProps) {
  return (
    <aside
      className={cn(
        "hidden md:flex md:w-56 md:shrink-0 md:flex-col md:justify-between border-r bg-sidebar p-3",
        className,
      )}
    >
      <div>
        <div className="flex items-center gap-2 px-2 py-3">
          <MascotLogo />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <Link
            to="/cash-flow"
            activeOptions={{ exact: true }}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{
              className: "bg-accent font-semibold text-primary",
              "aria-current": "page",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 20V4M4 7l3-3 3 3M17 4v16M14 17l3 3 3-3" />
            </svg>
            <span>Cash flow</span>
          </Link>

          <Link
            to="/transactions"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{
              className: "bg-accent font-semibold text-primary",
              "aria-current": "page",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" />
            </svg>
            <span>Transactions</span>
          </Link>

          <Link
            to="/review"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{
              className: "bg-accent font-semibold text-primary",
              "aria-current": "page",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 13h5l2 3h4l2-3h5M5.5 5h13L21 13v6H3v-6z" />
            </svg>
            <span className="flex-1">Needs review</span>
            <NeedsReviewBadge />
          </Link>

          <Link
            to="/accounts"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{
              className: "bg-accent font-semibold text-primary",
              "aria-current": "page",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
            </svg>
            <span>Accounts</span>
          </Link>

          <div className="my-2.5 h-px bg-border" />
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Planning
          </div>

          <span
            aria-disabled="true"
            className="flex cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-muted-foreground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7h16a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM5 7l3-3h9v3M16 13h2" />
            </svg>
            <span>Budgets</span>
          </span>

          <span
            aria-disabled="true"
            className="flex cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-muted-foreground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="12" cy="12" r="1" />
            </svg>
            <span>Goals</span>
          </span>

          <span
            aria-disabled="true"
            className="flex cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-muted-foreground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6" />
            </svg>
            <span>Home buying</span>
          </span>

          <span
            aria-disabled="true"
            className="flex cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-muted-foreground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
            </svg>
            <span>Forecast</span>
          </span>
        </nav>
      </div>

      <div className="mt-auto border-t border-border pt-3">
        <Link
          to="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          activeProps={{
            className: "bg-accent font-semibold text-primary",
            "aria-current": "page",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
          </svg>
          <span>Settings</span>
        </Link>

        <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
          <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0" aria-hidden="true">
            <circle cx="4" cy="4" r="4" fill={me.colour || "currentColor"} />
          </svg>
          <div className="min-w-0 flex-1 truncate">
            <div className="truncate font-medium text-foreground">{me.displayName}</div>
            <div className="truncate text-xs text-muted-foreground">
              Signed in as {me.displayName}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
