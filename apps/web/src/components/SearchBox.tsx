import { useEffect, useRef, useState } from "react";
import { MAX_QUERY } from "../routes/search.ts";
import { INPUT_CLASS_RING } from "./ui/input-class.ts";

/** Milliseconds after the last keystroke before the search box changes the list. */
const SEARCH_DEBOUNCE_MS = 300;

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | undefined }) {
  clearTimeout(ref.current);
  ref.current = undefined;
}

export interface SearchBoxProps {
  readonly value: string;
  readonly resetKey: number;
  readonly onChange: (q: string | undefined) => void;
}

/**
 * The search box: the text lives in the URL as `q`, put there after a pause in typing so the list
 * is not fetched on every key. A `q` that arrives from outside (Back, a link) or a `resetKey`
 * change (Clear filters) replaces what is typed and cancels the pending send. The URL's echo of
 * what this box sent does not reset it, nor does a late echo of an earlier value while a newer one
 * is still in flight.
 */
export function SearchBox({ value, resetKey, onChange }: SearchBoxProps) {
  const [text, setText] = useState(value);
  /** The last value this box sent (or took from the URL). */
  const sent = useRef(value);
  /** Earlier values sent and not yet echoed back, so a late echo is not mistaken for a new URL. */
  const inFlight = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;
  const latestValue = useRef(value);
  latestValue.current = value;

  useEffect(() => () => clearTimer(timer), []);

  useEffect(() => {
    if (value === sent.current) {
      inFlight.current = [];
      return;
    }
    if (inFlight.current.includes(value)) return;
    clearTimer(timer);
    sent.current = value;
    inFlight.current = [];
    setText(value);
  }, [value]);

  useEffect(() => {
    if (resetKey === 0) return;
    clearTimer(timer);
    sent.current = latestValue.current;
    inFlight.current = [];
    setText(latestValue.current);
  }, [resetKey]);

  const type = (next: string) => {
    setText(next);
    clearTimer(timer);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const trimmed = next.trim();
      if (trimmed === sent.current) return;
      inFlight.current.push(trimmed);
      sent.current = trimmed;
      latest.current(trimmed === "" ? undefined : trimmed);
    }, SEARCH_DEBOUNCE_MS);
  };

  return (
    <div className="mt-3">
      <label className="sr-only" htmlFor="filter-search">
        Search transactions
      </label>
      <input
        id="filter-search"
        type="search"
        value={text}
        maxLength={MAX_QUERY}
        autoComplete="off"
        placeholder="Search name, notes, tag or amount"
        onChange={(e) => type(e.target.value)}
        className={INPUT_CLASS_RING}
      />
    </div>
  );
}
