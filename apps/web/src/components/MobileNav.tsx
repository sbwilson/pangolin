import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "@/lib/utils.ts";
import type { Me } from "../api.ts";
import { NeedsReviewBadge } from "./review/index.ts";
import { Sheet } from "./ui/sheet.tsx";

export interface MobileNavProps {
  readonly me: Me;
  readonly signOut: () => Promise<void>;
  readonly className?: string;
}

export function MobileNav({ signOut, className }: MobileNavProps) {
  const [activeSheet, setActiveSheet] = useState<"planning" | "more" | null>(null);
  const navigate = useNavigate();

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card py-1 md:hidden",
          className,
        )}
      >
        <Link
          to="/cash-flow"
          activeOptions={{ exact: true }}
          className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 text-center text-[10.5px] leading-tight text-muted-foreground transition-colors"
          activeProps={{
            className: "font-semibold text-primary",
            "aria-current": "page",
          }}
        >
          <svg
            width="20"
            height="20"
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
          className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 text-center text-[10.5px] leading-tight text-muted-foreground transition-colors"
          activeProps={{
            className: "font-semibold text-primary",
            "aria-current": "page",
          }}
        >
          <svg
            width="20"
            height="20"
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
          className="relative flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 text-center text-[10.5px] leading-tight text-muted-foreground transition-colors"
          activeProps={{
            className: "font-semibold text-primary",
            "aria-current": "page",
          }}
        >
          <svg
            width="20"
            height="20"
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
          <span>Needs review</span>
          <NeedsReviewBadge className="absolute right-2 top-0" />
        </Link>

        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={activeSheet === "planning"}
          onClick={() => setActiveSheet("planning")}
          className={cn(
            "flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 text-center text-[10.5px] leading-tight text-muted-foreground transition-colors",
            activeSheet === "planning" && "font-semibold text-primary",
          )}
        >
          <svg
            width="20"
            height="20"
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
          <span>Planning</span>
        </button>

        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={activeSheet === "more"}
          onClick={() => setActiveSheet("more")}
          className={cn(
            "flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 text-center text-[10.5px] leading-tight text-muted-foreground transition-colors",
            activeSheet === "more" && "font-semibold text-primary",
          )}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
          <span>More</span>
        </button>
      </nav>

      {activeSheet === "planning" ? (
        <Sheet title="Planning" onClose={() => setActiveSheet(null)}>
          <div className="flex flex-col divide-y divide-border py-2">
            <span className="flex cursor-default items-center gap-3 py-3 text-sm text-muted-foreground opacity-60">
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
            <span className="flex cursor-default items-center gap-3 py-3 text-sm text-muted-foreground opacity-60">
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
            <span className="flex cursor-default items-center gap-3 py-3 text-sm text-muted-foreground opacity-60">
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
            <span className="flex cursor-default items-center gap-3 py-3 text-sm text-muted-foreground opacity-60">
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
          </div>
        </Sheet>
      ) : null}

      {activeSheet === "more" ? (
        <Sheet title="More" onClose={() => setActiveSheet(null)}>
          <div className="flex flex-col divide-y divide-border py-2">
            <span className="flex cursor-default items-center gap-3 py-3 text-sm text-muted-foreground opacity-60">
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
                <path d="M3 3v18h18M7 14l4-4 4 4 5-5" />
              </svg>
              <span>Net worth</span>
            </span>

            <button
              type="button"
              onClick={() => {
                setActiveSheet(null);
                void navigate({ to: "/spending" });
              }}
              className="flex items-center gap-3 py-3 text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
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
                <path d="M12 3a9 9 0 1 0 9 9h-9zM15 3.6A9 9 0 0 1 20.4 9H15z" />
              </svg>
              <span>Spending</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSheet(null);
                void navigate({ to: "/accounts" });
              }}
              className="flex items-center gap-3 py-3 text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
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
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSheet(null);
                void navigate({ to: "/settings" });
              }}
              className="flex items-center gap-3 py-3 text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
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
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSheet(null);
                void signOut();
              }}
              className="flex items-center gap-3 py-3 text-left text-sm font-medium text-destructive transition-colors hover:opacity-80"
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
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
