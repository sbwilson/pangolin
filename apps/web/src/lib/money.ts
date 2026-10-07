/**
 * Money text to and from integer cents, without floating point. These only translate what a
 * person types; the web never adds amounts up (the server owns every sum).
 */

/** `-4.5` becomes -450. Returns undefined for anything that is not an amount to the cent. */
export function parseCents(text: string): number | undefined {
  const match = /^\s*(-?)(\d{1,12})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (match === null) return undefined;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return match[1] === "-" && cents !== 0 ? -cents : cents;
}

/** -450 becomes "-4.50" (what an amount field holds). */
export function centsToText(cents: number): string {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}
