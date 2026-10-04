// The seed's tags and payees. Shared ones come from public activity; owner-only ones come from
// a person's private account (AD-18) and are seen only by them.
import type { SeedModule } from "../module.ts";
import type { PayeeCreatedEvent, TagCreatedEvent } from "../world.ts";
import { ACCOUNT_KEYS, PAYEES, TAGS } from "./catalogue.ts";

const PRIVATE_ACCOUNT = {
  "person-a": ACCOUNT_KEYS.privateA,
  "person-b": ACCOUNT_KEYS.privateB,
} as const;

export const classification: SeedModule = {
  name: "classification",
  dependsOn: ["institutions-and-accounts"],
  generate() {
    const tags: TagCreatedEvent[] = TAGS.map((tag) => ({
      type: "tag.created",
      key: tag.key,
      name: tag.name,
      origin: tag.owner === null ? null : PRIVATE_ACCOUNT[tag.owner],
    }));
    const payees: PayeeCreatedEvent[] = PAYEES.map((payee) => ({
      type: "payee.created",
      key: payee.key,
      name: payee.name,
      websiteUrl: payee.websiteUrl,
      defaultCategory: payee.category,
      origin: payee.owner === null ? null : PRIVATE_ACCOUNT[payee.owner],
    }));
    const scoped = (e: { origin: string | null }, account: string) => e.origin === account;
    return {
      events: [...tags, ...payees],
      expectations: {
        tagCount: tags.length,
        payeeCount: payees.length,
        sharedTagKeys: tags.filter((t) => t.origin === null).map((t) => t.key),
        sharedPayeeKeys: payees.filter((p) => p.origin === null).map((p) => p.key),
        ownerOnlyTagKeys: {
          "person-a": tags.filter((t) => scoped(t, ACCOUNT_KEYS.privateA)).map((t) => t.key),
          "person-b": tags.filter((t) => scoped(t, ACCOUNT_KEYS.privateB)).map((t) => t.key),
        },
        ownerOnlyPayeeKeys: {
          "person-a": payees.filter((p) => scoped(p, ACCOUNT_KEYS.privateA)).map((p) => p.key),
          "person-b": payees.filter((p) => scoped(p, ACCOUNT_KEYS.privateB)).map((p) => p.key),
        },
      },
    };
  },
};
