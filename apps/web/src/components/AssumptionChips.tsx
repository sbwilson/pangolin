// The net-worth mode's "Assumptions" chips row: four chips wired to GET/PUT
// `/api/planning/forecast-assumptions`. Click-to-edit inline, a dot on every value that differs
// from the all-zero defaults, a per-chip `reset` and a row-end "Reset all". Every successful PUT
// writes the answer back to the assumptions cache and invalidates the net-worth lines, so the
// chart redraws immediately; a failed PUT alerts and the chips keep showing the stored values.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  type AccountView,
  type ForecastAssumptionMortgage,
  type ForecastAssumptionMortgageInput,
  type ForecastAssumptions,
  type ForecastAssumptionsPatch,
  listAccounts,
  upsertForecastAssumptions,
} from "../api.ts";
import { cn } from "../lib/utils.ts";

/** Where the page caches the assumptions; a successful PUT writes the whole answer back here. */
export const ASSUMPTIONS_QUERY_KEY = ["planning", "forecast", "assumptions"] as const;

/** What nothing-stored means (neutral zeros, no mortgage rows); "changed" reads against this. */
export const FORECAST_ASSUMPTION_DEFAULTS: ForecastAssumptions = {
  savingsRateBps: 0,
  returnLowBps: 0,
  returnMidBps: 0,
  returnHighBps: 0,
  superRateBps: 0,
  mortgages: [],
};

// --- percent text ⇄ integer basis points (45% is 4500 bps; the text trims trailing zeros) ---

/** 4500 → `"45"`, 1250 → `"12.5"`, 1234 → `"12.34"`. */
export const bpsToPercentText = (bps: number): string => {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}`;
  if (frac % 10 === 0) return `${whole}.${frac / 10}`;
  return `${whole}.${String(frac).padStart(2, "0")}`;
};

/** `"45"` → 4500; undefined for anything outside 0–100 or with more than two decimals. */
export const percentTextToBps = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (value > 100) return undefined;
  return Math.round(value * 100);
};

/** `{loan name} loan paid down, offset counted`, joined per loan; none says so honestly.
 * An account that does not resolve (still loading, or gone) reads "A home loan paid down". */
export const mortgageProse = (
  mortgages: readonly ForecastAssumptionMortgage[],
  loanName: (accountId: string) => string | undefined,
): string => {
  if (mortgages.length === 0) return "No mortgage paid down";
  return mortgages
    .map((m) => {
      const name = loanName(m.accountId);
      const base = name === undefined ? "A home loan paid down" : `${name} loan paid down`;
      return m.countOffset ? `${base}, offset counted` : base;
    })
    .join(" · ");
};

const ROW = "mt-3.5 flex flex-wrap items-center gap-2";
const LABEL = "mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const CHIP =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground";
const EDIT_BUTTON = "cursor-pointer";
const DOT = "inline-block size-[7px] shrink-0 rounded-full bg-primary";
const RESET_BUTTON = "ml-0.5 cursor-pointer text-xs text-primary underline";
const INPUT = "w-14 rounded border border-border bg-card px-1 py-0.5 text-xs tabular-nums";
const POPOVER =
  "absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-card p-3 shadow-lg";

const ChangedDot = () => (
  // The mockup's `.chdot`: a labelled dot marking a value that differs from the default.
  <span role="img" aria-label="changed" className={DOT} />
);

/**
 * One percent field editing in place: commits on Enter or blur, and only valid text ever
 * reaches the server — invalid text keeps the editor open and marked invalid. Escape cancels.
 */
function PercentEditor({
  label,
  initialBps,
  onCommit,
  onCancel,
}: {
  readonly label: string;
  readonly initialBps: number;
  readonly onCommit: (bps: number) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState(() => bpsToPercentText(initialBps));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const bps = percentTextToBps(text);
    if (bps === undefined) {
      setInvalid(true);
      return;
    }
    onCommit(bps);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <label className="inline-flex items-center gap-1">
        <span className="text-muted-foreground">{label}</span>
        <input
          value={text}
          aria-label={label}
          aria-invalid={invalid}
          // biome-ignore lint/a11y/noAutofocus: the inline editor opens on the person's click
          autoFocus
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onCancel();
          }}
          onBlur={commit}
          className={cn(INPUT, invalid && "border-destructive")}
        />
      </label>
      <span aria-hidden="true">%</span>
    </span>
  );
}

/** The returns editor: three percents, one PUT. The group commits once all three are valid. */
function ReturnsEditor({
  low,
  mid,
  high,
  onCommit,
  onCancel,
}: {
  readonly low: number;
  readonly mid: number;
  readonly high: number;
  readonly onCommit: (bps: { low: number; mid: number; high: number }) => void;
  readonly onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => ({
    low: bpsToPercentText(low),
    mid: bpsToPercentText(mid),
    high: bpsToPercentText(high),
  }));
  const [invalid, setInvalid] = useState({ low: false, mid: false, high: false });

  const commit = () => {
    const parsed = {
      low: percentTextToBps(text.low),
      mid: percentTextToBps(text.mid),
      high: percentTextToBps(text.high),
    };
    if (parsed.low === undefined || parsed.mid === undefined || parsed.high === undefined) {
      setInvalid({
        low: parsed.low === undefined,
        mid: parsed.mid === undefined,
        high: parsed.high === undefined,
      });
      return;
    }
    onCommit({ low: parsed.low, mid: parsed.mid, high: parsed.high });
  };

  const field = (
    key: "low" | "mid" | "high",
    caption: string,
    ariaName: string,
    focused = false,
  ) => (
    <label className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{caption}</span>
      <input
        value={text[key]}
        aria-label={ariaName}
        aria-invalid={invalid[key]}
        // biome-ignore lint/a11y/noAutofocus: the inline editor opens on the person's click
        autoFocus={focused}
        onChange={(e) => {
          setText((t) => ({ ...t, [key]: e.target.value }));
          setInvalid((f) => ({ ...f, [key]: false }));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={(e) => {
          // The group commits only when focus leaves it entirely.
          if (box.current !== null && !box.current.contains(e.relatedTarget as Node | null)) {
            commit();
          }
        }}
        className={cn(INPUT, "w-12", invalid[key] && "border-destructive")}
      />
    </label>
  );

  return (
    <div ref={box} className="flex flex-wrap items-center gap-1.5">
      {field("low", "low", "Low expected return", true)}
      {field("mid", "mid", "Mid expected return")}
      {field("high", "high", "High expected return")}
      <span aria-hidden="true">%</span>
    </div>
  );
}

type EditingChip = "savings" | "returns" | "mortgages" | "super" | null;

/** The editable assumption chips row; net-worth mode only, under the forecast card. */
export function AssumptionChips({ assumptions }: { readonly assumptions: ForecastAssumptions }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<EditingChip>(null);

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    retry: false,
  });
  const homeLoans = (accounts.data ?? []).filter((a: AccountView) => a.type === "home_loan");
  const loanName = (accountId: string): string | undefined =>
    accounts.data?.find((a) => a.id === accountId)?.name;

  const save = useMutation({
    mutationFn: (patch: ForecastAssumptionsPatch) => upsertForecastAssumptions(patch),
    onSuccess: (next) => {
      client.setQueryData(ASSUMPTIONS_QUERY_KEY, next);
      void client.invalidateQueries({ queryKey: ["planning", "forecast", "networth"] });
    },
  });

  const changed = {
    savings: assumptions.savingsRateBps !== FORECAST_ASSUMPTION_DEFAULTS.savingsRateBps,
    returns:
      assumptions.returnLowBps !== FORECAST_ASSUMPTION_DEFAULTS.returnLowBps ||
      assumptions.returnMidBps !== FORECAST_ASSUMPTION_DEFAULTS.returnMidBps ||
      assumptions.returnHighBps !== FORECAST_ASSUMPTION_DEFAULTS.returnHighBps,
    mortgages: assumptions.mortgages.length > 0,
    super: assumptions.superRateBps !== FORECAST_ASSUMPTION_DEFAULTS.superRateBps,
  };
  const anyChanged = changed.savings || changed.returns || changed.mortgages || changed.super;

  /** Closes whatever is open and PUTs the patch — nothing optimistic, the answer redraws it. */
  const commit = (patch: ForecastAssumptionsPatch, unchanged = false): void => {
    setEditing(null);
    if (!unchanged) save.mutate(patch);
  };

  // The mortgage popover closes on Escape or a click outside the chip.
  const mortgageBox = useRef<HTMLDivElement>(null);
  const mortgagesOpen = editing === "mortgages";
  useEffect(() => {
    if (!mortgagesOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setEditing(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (mortgageBox.current !== null && !mortgageBox.current.contains(event.target as Node)) {
        setEditing(null);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [mortgagesOpen]);

  /**
   * Rebuilds the whole list with one loan's paid-down/offset box toggled. Retained loans echo
   * their stored terms; a newly listed loan sends `{accountId, countOffset}` only. Stored rows
   * whose account is not in the visible list (closed or hidden loans) are carried over as-is —
   * the server replaces the list wholesale, so dropping them would silently delete them.
   */
  const toggleMortgage = (accountId: string, next: "paidDown" | "countOffset"): void => {
    const stored = assumptions.mortgages;
    const rows: ForecastAssumptionMortgageInput[] = homeLoans
      .filter((loan) => {
        const member = stored.some((m) => m.accountId === loan.id);
        if (loan.id !== accountId || next !== "paidDown") return member;
        return !member;
      })
      .map((loan) => {
        const row = stored.find((m) => m.accountId === loan.id);
        const countOffset =
          loan.id === accountId && next === "countOffset"
            ? !(row?.countOffset ?? false)
            : (row?.countOffset ?? false);
        return row === undefined
          ? { accountId: loan.id, countOffset }
          : {
              accountId: loan.id,
              countOffset,
              annualRatePercent: row.annualRatePercent,
              monthlyRepaymentCents: row.monthlyRepaymentCents,
            };
      });
    for (const row of stored) {
      if (!homeLoans.some((loan) => loan.id === row.accountId)) rows.push({ ...row });
    }
    save.mutate({ mortgages: rows });
  };

  const returnsText = `Returns: low ${bpsToPercentText(assumptions.returnLowBps)}% · mid ${bpsToPercentText(
    assumptions.returnMidBps,
  )}% · high ${bpsToPercentText(assumptions.returnHighBps)}%`;
  const prose = mortgageProse(assumptions.mortgages, loanName);

  return (
    <>
      <div className={ROW} data-testid="assumption-chips">
        <span className={LABEL}>Assumptions</span>

        <span className={CHIP} data-testid="assumption-chip-savings">
          {changed.savings ? <ChangedDot /> : null}
          {editing === "savings" ? (
            <PercentEditor
              label="Savings rate"
              initialBps={assumptions.savingsRateBps}
              onCommit={(bps) =>
                commit({ savingsRateBps: bps }, bps === assumptions.savingsRateBps)
              }
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              type="button"
              className={EDIT_BUTTON}
              aria-label={`Savings rate: ${bpsToPercentText(assumptions.savingsRateBps)}%. Edit`}
              onClick={() => setEditing("savings")}
            >
              {`Savings rate ${bpsToPercentText(assumptions.savingsRateBps)}%`}
            </button>
          )}
          {/* While an editor is open its resets are hidden: clicking one would blur-commit the
              edited text first, firing two PUTs for one intention. */}
          {changed.savings && editing === null ? (
            <button
              type="button"
              className={RESET_BUTTON}
              aria-label="Reset savings rate"
              onClick={() =>
                commit({ savingsRateBps: FORECAST_ASSUMPTION_DEFAULTS.savingsRateBps })
              }
            >
              reset
            </button>
          ) : null}
        </span>

        <span className={CHIP} data-testid="assumption-chip-returns">
          {changed.returns ? <ChangedDot /> : null}
          {editing === "returns" ? (
            <ReturnsEditor
              low={assumptions.returnLowBps}
              mid={assumptions.returnMidBps}
              high={assumptions.returnHighBps}
              onCommit={(bps) =>
                commit(
                  { returnLowBps: bps.low, returnMidBps: bps.mid, returnHighBps: bps.high },
                  bps.low === assumptions.returnLowBps &&
                    bps.mid === assumptions.returnMidBps &&
                    bps.high === assumptions.returnHighBps,
                )
              }
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              type="button"
              className={EDIT_BUTTON}
              aria-label={`${returnsText}. Edit`}
              onClick={() => setEditing("returns")}
            >
              {returnsText}
            </button>
          )}
          {changed.returns && editing === null ? (
            <button
              type="button"
              className={RESET_BUTTON}
              aria-label="Reset returns"
              onClick={() =>
                commit({
                  returnLowBps: FORECAST_ASSUMPTION_DEFAULTS.returnLowBps,
                  returnMidBps: FORECAST_ASSUMPTION_DEFAULTS.returnMidBps,
                  returnHighBps: FORECAST_ASSUMPTION_DEFAULTS.returnHighBps,
                })
              }
            >
              reset
            </button>
          ) : null}
        </span>

        <div
          className={cn(CHIP, "relative")}
          ref={mortgageBox}
          data-testid="assumption-chip-mortgages"
        >
          {changed.mortgages ? <ChangedDot /> : null}
          <button
            type="button"
            className={EDIT_BUTTON}
            aria-label={`Mortgages: ${prose}. Edit`}
            aria-expanded={mortgagesOpen}
            onClick={() => setEditing(mortgagesOpen ? null : "mortgages")}
          >
            {prose}
          </button>
          {changed.mortgages && editing === null ? (
            <button
              type="button"
              className={RESET_BUTTON}
              aria-label="Reset mortgages"
              onClick={() => commit({ mortgages: [] })}
            >
              reset
            </button>
          ) : null}
          {mortgagesOpen ? (
            <fieldset className={POPOVER}>
              <legend className="sr-only">Mortgages paid down</legend>
              {accounts.isPending ? (
                <p className="text-xs text-muted-foreground">Loading home loans…</p>
              ) : accounts.isError ? (
                <p className="text-xs text-muted-foreground">
                  The home loan list could not be loaded. Please reload to try again.
                </p>
              ) : homeLoans.length === 0 ? (
                <p className="text-xs text-muted-foreground">No home loans yet</p>
              ) : (
                homeLoans.map((loan) => {
                  const row = assumptions.mortgages.find((m) => m.accountId === loan.id);
                  const member = row !== undefined;
                  return (
                    <div key={loan.id} className="flex flex-wrap items-center gap-x-3 py-1">
                      <span className="min-w-24 text-xs font-medium">{loan.name}</span>
                      <label className="inline-flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={member}
                          disabled={save.isPending}
                          aria-label={`${loan.name} paid down`}
                          onChange={() => toggleMortgage(loan.id, "paidDown")}
                        />
                        paid down
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={row?.countOffset ?? false}
                          disabled={!member || save.isPending}
                          aria-label={`${loan.name} offset counted`}
                          onChange={() => toggleMortgage(loan.id, "countOffset")}
                        />
                        offset counted
                      </label>
                    </div>
                  );
                })
              )}
            </fieldset>
          ) : null}
        </div>

        <span className={CHIP} data-testid="assumption-chip-super">
          {changed.super ? <ChangedDot /> : null}
          {editing === "super" ? (
            <PercentEditor
              label="Super contributions"
              initialBps={assumptions.superRateBps}
              onCommit={(bps) => commit({ superRateBps: bps }, bps === assumptions.superRateBps)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              type="button"
              className={EDIT_BUTTON}
              aria-label={`Super contributions: ${bpsToPercentText(assumptions.superRateBps)}%. Edit`}
              onClick={() => setEditing("super")}
            >
              {`Super contributions ${bpsToPercentText(assumptions.superRateBps)}%`}
            </button>
          )}
          {changed.super && editing === null ? (
            <button
              type="button"
              className={RESET_BUTTON}
              aria-label="Reset super contributions"
              onClick={() => commit({ superRateBps: FORECAST_ASSUMPTION_DEFAULTS.superRateBps })}
            >
              reset
            </button>
          ) : null}
        </span>

        {anyChanged && editing === null ? (
          <button
            type="button"
            className="cursor-pointer text-sm font-semibold text-primary hover:underline"
            data-testid="assumption-reset-all"
            onClick={() =>
              commit({
                savingsRateBps: 0,
                returnLowBps: 0,
                returnMidBps: 0,
                returnHighBps: 0,
                superRateBps: 0,
                mortgages: [],
              })
            }
          >
            Reset all
          </button>
        ) : null}
      </div>

      {save.isError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="assumption-save-error">
          The change could not be saved. The chips show the stored values.
        </p>
      ) : null}
    </>
  );
}
