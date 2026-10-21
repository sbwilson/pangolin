import { type DragEvent, useId, useState } from "react";
import { cn } from "@/lib/utils.ts";
import { formatSize } from "../../lib/import-format.ts";

export interface DropZoneProps {
  readonly file: File | null;
  readonly disabled?: boolean;
  readonly onFile: (file: File) => void;
}

/** A drop target that is also a keyboard-reachable file picker (the input is the control). */
export function DropZone({ file, disabled = false, onFile }: DropZoneProps) {
  const inputId = useId();
  const [over, setOver] = useState(false);

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) onFile(dropped);
  };

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-input px-4 py-6 text-center text-sm focus-within:ring-2 focus-within:ring-ring",
        over && "border-primary bg-accent",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        id={inputId}
        type="file"
        className="sr-only"
        disabled={disabled}
        data-testid="import-file"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          // Cleared so choosing the same file again still reports a change.
          event.target.value = "";
          if (chosen !== undefined) onFile(chosen);
        }}
      />
      {file === null ? (
        <>
          <span className="font-semibold">Drop a bank file here</span>
          <span className="text-muted-foreground">or choose a file (CSV, OFX or QIF)</span>
        </>
      ) : (
        <>
          <span className="font-semibold">{file.name}</span>
          <span className="text-muted-foreground">
            {formatSize(file.size)} · drop another file to replace it
          </span>
        </>
      )}
    </label>
  );
}
