import { type ReviewCard, type ReviewDetail, reviewAction } from "../../api.ts";
import { Button } from "../ui/button.tsx";
import { ReviewCardFrame, useReviewAction } from "./ReviewCardFrame.tsx";

type NoticeDetail = Extract<ReviewDetail, { type: "notice" }>;

/** What a notice says, with its date and, for a recovery link, who issued it. */
export function noticeText(kind: string, createdAt: string, issuedBy: string | null): string {
  const on = createdAt.slice(0, 10);
  if (kind === "identity.partner-reset") {
    return `A one-time recovery link for your account was issued on ${on} by ${issuedBy ?? "someone"}. If you didn't ask for this, revoke it.`;
  }
  if (kind === "identity.recovery-code-used") {
    return `One of your recovery codes was used to sign in on ${on}, and your passkeys were removed. If this wasn't you, reset your password and tell your partner.`;
  }
  return kind;
}

/** An identity notice to the signed-in person: "Got it", and for a recovery link, revoke it. */
export function NoticeCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: NoticeDetail;
}) {
  const { run, busy, error } = useReviewAction();
  return (
    <ReviewCardFrame card={card} error={error}>
      <p className="m-0 mt-1">{noticeText(card.kind, card.createdAt, detail.issuedBy)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "dismiss-notice"))}
        >
          Got it
        </Button>
        {card.kind === "identity.partner-reset" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => reviewAction(card.id, "revoke-links"))}
          >
            Revoke the link
          </Button>
        ) : null}
      </div>
    </ReviewCardFrame>
  );
}
