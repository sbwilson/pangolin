import type { ReviewCard } from "../../api.ts";
import { HandoffCard } from "./HandoffCard.tsx";
import { NoticeCard } from "./NoticeCard.tsx";
import { ReadOnlyCard } from "./ReadOnlyCard.tsx";
import { SetAsideCard } from "./SetAsideCard.tsx";
import {
  DuplicateCard,
  RuleOfferCard,
  TransferCard,
  UnclassifiedCard,
} from "./TransactionCards.tsx";

/** The card for one item, by kind. A kind with no card of its own gets the read-only one. */
export function ReviewCardView({ card }: { readonly card: ReviewCard }) {
  const { detail } = card;
  switch (card.kind) {
    case "classify.unclassified":
      if (detail.type === "transaction") return <UnclassifiedCard card={card} detail={detail} />;
      break;
    case "classify.rule_offer":
      if (detail.type === "transaction") return <RuleOfferCard card={card} detail={detail} />;
      break;
    case "import.probable_duplicate":
      if (detail.type === "transaction") return <DuplicateCard card={card} detail={detail} />;
      break;
    case "import.transfer_ambiguous":
      if (detail.type === "transaction") return <TransferCard card={card} detail={detail} />;
      break;
    case "import.set_aside":
      if (detail.type === "batch") return <SetAsideCard card={card} detail={detail} />;
      break;
    case "imports.handoff":
      if (detail.type === "handoff") return <HandoffCard card={card} detail={detail} />;
      break;
    case "identity.partner-reset":
    case "identity.recovery-code-used":
      if (detail.type === "notice") return <NoticeCard card={card} detail={detail} />;
      break;
  }
  return <ReadOnlyCard card={card} detail={detail} />;
}
