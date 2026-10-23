import { useId, useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  type DateRange,
  fyToDateRange,
  isLastStep,
  quarterRange,
  rangeLabel,
  rangeUnit,
  stepRange,
} from "../lib/date-range.ts";
import { Button } from "./ui/button.tsx";
import { DateInput } from "./ui/date-input.tsx";

/** What a chevron steps by, for its accessible name. */
const STEP_NAME = { quarter: "quarter", fy: "year", custom: "period" } as const;

export interface DateRangeControlProps {
  /** The range shown, inclusive `YYYY-MM-DD` ends. */
  readonly range: DateRange;
  /** Today, `YYYY-MM-DD`, in the browser's time zone. */
  readonly today: string;
  /** Called with the range the person picked. */
  readonly onChange: (range: DateRange) => void;
}

/**
 * The header date-range control: chevrons that step the range by its unit, the range's label,
 * and Quarter · FY to date · Custom (Custom opens From and To). Quarter is pressed for any aligned
 * quarter, FY to date for a whole FY or the current one to date, else Custom. The next chevron
 * is disabled when the next range would start after today.
 */
export function DateRangeControl({ range, today, onChange }: DateRangeControlProps) {
  const unit = rangeUnit(range, today);
  const id = useId();
  // Custom's From/To stay open only for the range they were opened on: any other change of the
  // range (a chevron, a preset, back/forward, a link) lets the unit decide again.
  const key = `${range.from}|${range.to}`;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const mode = openFor === key || unit === "custom" ? "custom" : unit;
  const step = STEP_NAME[unit];
  const pick = (next: DateRange) => {
    setOpenFor(null);
    onChange(next);
  };
  const edit = (next: Partial<DateRange>) => {
    const merged = { ...range, ...next };
    if (merged.from === "" || merged.to === "" || merged.from > merged.to) return;
    onChange(merged);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Previous ${step}`}
            onClick={() => onChange(stepRange(range, -1, today))}
          >
            <span aria-hidden="true">‹</span>
          </Button>
          <span className="min-w-32 text-center text-sm font-medium" data-testid="range-label">
            {rangeLabel(range, today)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Next ${step}`}
            disabled={isLastStep(range, today)}
            onClick={() => onChange(stepRange(range, 1, today))}
          >
            <span aria-hidden="true">›</span>
          </Button>
        </div>
        <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0">
          <legend className="sr-only">Date range</legend>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={mode === "quarter"}
            className={cn(mode === "quarter" && "bg-accent")}
            onClick={() => pick(quarterRange(today))}
          >
            Quarter
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={mode === "fy"}
            className={cn(mode === "fy" && "bg-accent")}
            onClick={() => pick(fyToDateRange(today))}
          >
            FY to date
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={mode === "custom"}
            className={cn(mode === "custom" && "bg-accent")}
            onClick={() => setOpenFor(key)}
          >
            Custom
          </Button>
        </fieldset>
      </div>
      {mode === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="m-0 text-sm" htmlFor={`${id}-from`}>
            From
            <DateInput
              id={`${id}-from`}
              value={range.from}
              max={range.to}
              onChange={(e) => edit({ from: e.target.value })}
            />
          </label>
          <label className="m-0 text-sm" htmlFor={`${id}-to`}>
            To
            <DateInput
              id={`${id}-to`}
              value={range.to}
              min={range.from}
              onChange={(e) => edit({ to: e.target.value })}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
