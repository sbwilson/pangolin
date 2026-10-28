// The shared logo/initial box for every payee surface: the stored logo served from
// `GET /api/payees/:id/logo` (same host, CSP `img-src 'self'`), falling back to the payee's
// initial — else the row's own label — when there is no logo or the image fails to load.
import { useState } from "react";
import { cn } from "@/lib/utils.ts";

export interface MerchantLogoProps {
  /** The row's payee; the logo is only ever fetched when both ids are present. */
  readonly payeeId: string | null;
  readonly logoAttachmentId: string | null;
  /** The payee's name; its initial is the fallback. */
  readonly name: string | null;
  /** The row's own label, used for the initial when there is no payee name. */
  readonly description?: string | null;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

const BOX = {
  sm: "h-[18px] w-[18px] text-[9px]",
  md: "h-[26px] w-[26px] text-[11px]",
} as const;

/**
 * `<img src="/api/payees/<payeeId>/logo">` when the payee has a logo; a `404` or any load
 * error falls back to the initial, never to a third-party host.
 */
export function MerchantLogo({
  payeeId,
  logoAttachmentId,
  name,
  description = null,
  size = "md",
  className,
}: MerchantLogoProps) {
  const [failed, setFailed] = useState(false);
  const box = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground select-none",
    BOX[size],
    className,
  );
  if (payeeId != null && logoAttachmentId != null && !failed) {
    return (
      <img
        src={`/api/payees/${encodeURIComponent(payeeId)}/logo`}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className={cn(box, "object-contain")}
        data-testid="merchant-logo-img"
      />
    );
  }
  const label = name ?? description ?? "";
  const initial = label.trim().charAt(0).toUpperCase();
  return (
    <span className={box} data-testid="merchant-logo-initial" aria-hidden="true">
      {initial}
    </span>
  );
}
