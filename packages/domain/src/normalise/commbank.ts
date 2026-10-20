/**
 * Normalisation rules for CommBank transaction descriptions (AD-20).
 * Strips card prefixes, pending noise, collapses whitespace, and trims.
 */

const PENDING_PREFIX_RE = /^PENDING\s*-\s*/i;

const CARD_NOISE_RE =
  /^(?:(?:VISA(?:\s+DEBIT)?|DEBIT\s+MASTERCARD|MASTERCARD|DEBIT(?:\s+CARD)?)\s+PURCHASE|PURCHASE)\s+(?:CARD\s+\d{4}|CARD\s+XXXX|\d{4})\s*/i;

const BARE_CARD_RE = /^CARD\s+\d{4}\s+/i;

const WHITESPACE_RE = /\s+/g;

/**
 * Normalises a CommBank description for deduplication and rule matching.
 * Keeps the core merchant / transfer text while stripping transient card and pending markers.
 */
export function normaliseCommBankDescription(description: string): string {
  let cleaned = description.trim();

  // Strip pending prefix
  cleaned = cleaned.replace(PENDING_PREFIX_RE, "");

  // Strip card noise
  cleaned = cleaned.replace(CARD_NOISE_RE, "");
  cleaned = cleaned.replace(BARE_CARD_RE, "");

  // Collapse multiple spaces/tabs into a single space, trim, and upper-case
  cleaned = cleaned.replace(WHITESPACE_RE, " ").trim().toUpperCase();

  return cleaned;
}
