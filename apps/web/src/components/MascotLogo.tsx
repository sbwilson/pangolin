import { cn } from "@/lib/utils.ts";

export interface MascotLogoProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
  readonly showWordmark?: boolean;
}

export function MascotIcon({
  size = "md",
  className,
}: {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}) {
  const dimensions =
    size === "sm"
      ? { width: 24, height: 17 }
      : size === "lg"
        ? { width: 40, height: 29 }
        : { width: 30, height: 22 };

  return (
    <svg
      aria-hidden="true"
      width={dimensions.width}
      height={dimensions.height}
      viewBox="0 0 140 100"
      className={cn("shrink-0", className)}
    >
      <path
        d="M112 72 q22 2 18 -16 q-3 -10 -12 -6"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path d="M40 74 Q40 30 84 30 Q118 32 118 74 Z" fill="var(--primary)" />
      <path
        d="M42,70 a10,10 0 0 1 20,0"
        fill="var(--primary)"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M60,70 a10,10 0 0 1 20,0"
        fill="var(--primary)"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M78,70 a10,10 0 0 1 20,0"
        fill="var(--primary)"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M96,70 a10,10 0 0 1 20,0"
        fill="var(--primary)"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M50,56 a10,10 0 0 1 20,0"
        fill="var(--mascot-scale-1, var(--primary))"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M68,56 a10,10 0 0 1 20,0"
        fill="var(--mascot-scale-1, var(--primary))"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M86,56 a10,10 0 0 1 20,0"
        fill="var(--mascot-scale-1, var(--primary))"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M59,43 a10,10 0 0 1 20,0"
        fill="var(--mascot-scale-2, var(--accent))"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M77,43 a10,10 0 0 1 20,0"
        fill="var(--mascot-scale-2, var(--accent))"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="M44 74 Q30 72 18 66 Q12 62 20 58 Q30 54 46 56 Z"
        fill="var(--muted-foreground)"
        opacity="0.3"
      />
      <circle cx="17" cy="62" r="2.4" fill="var(--mascot-ink, #1F2328)" />
      <circle cx="34" cy="61" r="2.6" fill="var(--mascot-ink, #1F2328)" />
      <rect x="56" y="72" width="10" height="9" rx="4" fill="var(--mascot-ink, #1F2328)" />
      <rect x="96" y="72" width="10" height="9" rx="4" fill="var(--mascot-ink, #1F2328)" />
    </svg>
  );
}

export function MascotLogo({ size = "md", className, showWordmark = true }: MascotLogoProps) {
  const textSize =
    size === "sm" ? "text-sm" : size === "lg" ? "text-xl font-bold" : "text-base font-semibold";

  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <MascotIcon size={size} />
      {showWordmark ? (
        <span className={cn("tracking-tight text-foreground", textSize)}>Pangolin</span>
      ) : null}
    </div>
  );
}
