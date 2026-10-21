import type { ReviewCard, ReviewDetail } from "../../api.ts";
import { ReviewCardFrame } from "./ReviewCardFrame.tsx";

/** Words for the kinds that have no action: they clear when the thing they report is fixed. */
function readOnlyText(card: ReviewCard, detail: ReviewDetail): string {
  switch (card.kind) {
    case "accounts.closing-balance": {
      const name = detail.type === "account" ? detail.accountName : null;
      return `${name ?? "A closed account"} closed with a balance. It clears when the balance reaches zero or the account is reopened.`;
    }
    case "system.upgrade-failed":
      return "The last upgrade did not finish. The server rolled back; check the system status.";
    case "system.restored":
      return "The data was restored from a backup, so recent changes may be missing.";
    case "system.backup-verification-failed":
      return "A backup check or restore drill failed. It clears when the next one passes.";
    case "job.dead":
      return "A background job failed and gave up. See the system status for which.";
    default:
      return "This needs attention, and there is nothing to do about it here yet.";
  }
}

/** A card with no action of its own: the closing balance, the system kinds, and any unknown kind. */
export function ReadOnlyCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: ReviewDetail;
}) {
  return (
    <ReviewCardFrame card={card}>
      <p className="m-0 mt-1">{readOnlyText(card, detail)}</p>
    </ReviewCardFrame>
  );
}
