import { useEffect, useState } from "react";
import { cn } from "@/lib/utils.ts";

export interface SettingsSection {
  readonly id: string;
  readonly label: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "appearance", label: "Appearance" },
  { id: "security", label: "Sign-in & security" },
  { id: "devices", label: "Signed-in devices" },
  { id: "partner", label: "Partner" },
  { id: "household", label: "Household" },
  { id: "status", label: "System status" },
];

export interface SettingsNavProps {
  readonly activeSection?: string;
  readonly onSectionChange?: (sectionId: string) => void;
  readonly className?: string;
}

export function SettingsNav({
  activeSection: controlledActive,
  onSectionChange,
  className,
}: SettingsNavProps) {
  const [internalActive, setInternalActive] = useState<string>(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const hash = window.location.hash.replace("#", "");
      if (SETTINGS_SECTIONS.some((s) => s.id === hash)) return hash;
    }
    return "appearance";
  });

  const active = controlledActive ?? internalActive;

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (SETTINGS_SECTIONS.some((s) => s.id === hash)) {
        setInternalActive(hash);
        onSectionChange?.(hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [onSectionChange]);

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            if (SETTINGS_SECTIONS.some((s) => s.id === id)) {
              setInternalActive(id);
              onSectionChange?.(id);
              break;
            }
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );

    for (const sec of SETTINGS_SECTIONS) {
      const el = document.getElementById(sec.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [onSectionChange]);

  const selectSection = (id: string) => {
    setInternalActive(id);
    onSectionChange?.(id);
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Mobile chip bar */}
      <nav
        aria-label="Settings sections mobile"
        className="mb-2 flex gap-2 overflow-x-auto pb-2 scrollbar-none md:hidden"
      >
        {SETTINGS_SECTIONS.map((sec) => {
          const isCurrent = active === sec.id;
          return (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              onClick={() => selectSection(sec.id)}
              className={cn(
                "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                isCurrent
                  ? "border-primary bg-accent font-semibold text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
              aria-current={isCurrent ? "location" : undefined}
            >
              {sec.label}
            </a>
          );
        })}
      </nav>

      {/* Desktop sticky navigation rail */}
      <nav
        aria-label="Settings sections"
        className="sticky top-4 hidden w-[188px] shrink-0 flex-col gap-0.5 border-l border-border pl-0.5 md:flex"
      >
        <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          On this page
        </div>
        {SETTINGS_SECTIONS.map((sec) => {
          const isCurrent = active === sec.id;
          return (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              onClick={() => selectSection(sec.id)}
              className={cn(
                "-ml-[2px] block rounded-r-md border-l-2 px-3 py-1.5 text-[13.5px] transition-colors",
                isCurrent
                  ? "border-l-primary bg-accent font-semibold text-primary"
                  : "border-l-transparent text-muted-foreground hover:text-foreground",
              )}
              aria-current={isCurrent ? "location" : undefined}
            >
              {sec.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
