import { cn } from "@/lib/utils.ts";
import { Button } from "../ui/button.tsx";
import { useImport } from "./ImportProvider.tsx";

/** The header's Import button; `compact` is the phone's, beside the title. */
export function ImportButton({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { openImport } = useImport();
  return (
    <Button
      type="button"
      size={compact ? "sm" : "default"}
      aria-haspopup="dialog"
      className={cn(className)}
      onClick={() => openImport()}
    >
      Import
    </Button>
  );
}
