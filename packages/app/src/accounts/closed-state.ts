// The one meaning of "closed" for an account (Epic 2 retrospective, finding Q1). Three rules
// touch `closedOn`, and each answers a different question:
//
// - The closed state (this file): an account is closed once `closedOn` is today or earlier by the
//   clock. The default account list leaves a closed account out (it is archived), and the
//   closing-balance warning and its review item exist only for a closed account.
// - The lock (`ledger/closed-lock.ts`): the ledger refuses an entry dated after `closedOn`. It
//   applies as soon as `closedOn` is set, even for a future date, so it never looks at the clock.
//   The closed date itself is archived and still takes entries dated that day.
// - The `closeAccount` refusal: any set `closedOn`, past or future, makes a second close a
//   `Conflict`; the date is moved with `updateAccount`.
//
// A future `closedOn` is therefore not closed yet: the account is listed, carries no warning and
// no review item, but already refuses later entries. A daily job (`closing-balance-sync`) brings
// the review item in step on the day the date arrives, because a read cannot raise it and a write
// is not guaranteed on the day.

/** True once the account's `closedOn` (`YYYY-MM-DD`) is `today` (`YYYY-MM-DD`) or earlier. */
export function isClosed(account: { readonly closedOn: string | null }, today: string): boolean {
  return account.closedOn !== null && account.closedOn <= today;
}
