// The default Australian category tree and ATO tax categories (spec: categorisation.md).
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type {
  CategoryGroupKind,
  CategoryGroupRow,
  CategoryRow,
  TaxCategoryRow,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export interface DefaultCategoryGroup {
  readonly name: string;
  readonly kind: CategoryGroupKind;
  readonly categories: readonly {
    readonly name: string;
    /** Essentials are fixed-cost; everything else is not. */
    readonly isFixedCost: boolean;
  }[];
}

const fixed = (name: string) => ({ name, isFixedCost: true });
const variable = (name: string) => ({ name, isFixedCost: false });

/** The 13 default groups, in display order. Income is `income`, Transfers `transfer`, the rest `expense`. */
export const DEFAULT_CATEGORIES: readonly DefaultCategoryGroup[] = [
  {
    name: "Income",
    kind: "income",
    categories: [
      "Salary",
      "Rental income",
      "Interest",
      "Distributions and dividends",
      "Refunds",
      "Other income",
    ].map(variable),
  },
  {
    name: "Housing",
    kind: "expense",
    categories: [
      fixed("Rent"),
      fixed("Mortgage repayments"),
      fixed("Rates and strata"),
      variable("Home maintenance"),
      fixed("Home and contents insurance"),
    ],
  },
  {
    name: "Utilities",
    kind: "expense",
    categories: ["Electricity", "Gas", "Water", "Internet", "Mobile"].map(fixed),
  },
  {
    name: "Food",
    kind: "expense",
    categories: ["Groceries", "Dining out", "Takeaway and delivery", "Coffee", "Alcohol"].map(
      variable,
    ),
  },
  {
    name: "Transport",
    kind: "expense",
    categories: [
      variable("Fuel"),
      variable("Public transport"),
      variable("Tolls"),
      variable("Parking"),
      variable("Rideshare"),
      fixed("Registration and CTP"),
      fixed("Car insurance"),
      variable("Servicing"),
    ],
  },
  {
    name: "Health",
    kind: "expense",
    categories: [
      variable("GP and specialists"),
      variable("Pharmacy"),
      variable("Dental"),
      variable("Optical"),
      fixed("Private health insurance"),
      variable("Fitness"),
    ],
  },
  {
    name: "Personal",
    kind: "expense",
    categories: ["Clothing", "Hair and beauty", "Gifts", "Donations"].map(variable),
  },
  {
    name: "Lifestyle",
    kind: "expense",
    categories: [
      variable("Entertainment"),
      fixed("Subscriptions"),
      variable("Hobbies"),
      variable("Books and media"),
    ],
  },
  {
    name: "Travel",
    kind: "expense",
    categories: ["Flights", "Accommodation", "Activities", "Travel insurance"].map(variable),
  },
  {
    name: "Work and study",
    kind: "expense",
    categories: [
      "Professional registration and memberships",
      "Indemnity insurance",
      "Courses and conferences",
      "Books and equipment",
    ].map(variable),
  },
  {
    name: "Financial",
    kind: "expense",
    categories: [
      variable("Bank fees"),
      variable("Interest charges"),
      variable("Tax agent fees"),
      fixed("Life and income protection insurance"),
    ],
  },
  {
    name: "Investment property",
    kind: "expense",
    categories: [
      fixed("Loan repayments"),
      variable("Agent fees"),
      fixed("Council rates"),
      variable("Repairs"),
      variable("Insurance"),
      variable("Other property costs"),
    ],
  },
  {
    name: "Transfers (not spending)",
    kind: "transfer",
    categories: ["Between our accounts", "Credit card payment", "To savings", "To investments"].map(
      variable,
    ),
  },
];

/** The ATO labels the spec suggests. A deductible share of 0 until a person sets one. */
export const DEFAULT_TAX_CATEGORIES: readonly {
  readonly code: string;
  readonly label: string;
  readonly defaultDeductibleBp: number;
}[] = [
  { code: "D1", label: "Work-related car expenses", defaultDeductibleBp: 0 },
  { code: "D2", label: "Work-related travel expenses", defaultDeductibleBp: 0 },
  { code: "D4", label: "Work-related self-education expenses", defaultDeductibleBp: 0 },
  { code: "D5", label: "Other work-related expenses", defaultDeductibleBp: 0 },
  { code: "D9", label: "Gifts and donations", defaultDeductibleBp: 0 },
  { code: "D10", label: "Cost of managing tax affairs", defaultDeductibleBp: 0 },
  {
    code: "D15",
    label: "Other deductions (income protection outside super)",
    defaultDeductibleBp: 0,
  },
  { code: "RENTAL", label: "Rental property schedule", defaultDeductibleBp: 0 },
];

export const seedDefaultsInput = z.object({}).strict();

/**
 * `classify.seedDefaults`: creates the default category groups, categories and tax categories,
 * only when the household has no category groups, so running it again changes nothing. IDs are
 * server-minted; every row is audited. Returns whether it seeded.
 */
export function seedDefaults(
  ctx: UseCaseContext,
  input: z.input<typeof seedDefaultsInput> = {},
): boolean {
  parseInput(seedDefaultsInput, input);
  // A read first, so a start on a household that already has its tree opens no write transaction.
  if (ctx.uow.read((repos) => repos.categoryGroups.list(ctx.viewer).length > 0)) return false;
  return write(ctx, (tx, audit) => {
    if (tx.categoryGroups.list(ctx.viewer).length > 0) return false;
    const at = formatInstant(ctx.clock.now());
    DEFAULT_CATEGORIES.forEach((group, index) => {
      const groupRow: CategoryGroupRow = {
        id: ctx.newId<"CategoryGroup">(),
        name: group.name,
        kind: group.kind,
        sort: index + 1,
        createdAt: at,
        updatedAt: at,
      };
      tx.categoryGroups.insert(groupRow);
      audit({
        entity: "category_group",
        entityId: groupRow.id,
        action: "create",
        before: null,
        after: groupRow,
      });
      for (const item of group.categories) {
        const row: CategoryRow = {
          id: ctx.newId<"Category">(),
          groupId: groupRow.id,
          name: item.name,
          isFixedCost: item.isFixedCost,
          createdAt: at,
          updatedAt: at,
        };
        tx.categories.insert(row);
        audit({ entity: "category", entityId: row.id, action: "create", before: null, after: row });
      }
    });
    for (const item of DEFAULT_TAX_CATEGORIES) {
      const row: TaxCategoryRow = {
        id: ctx.newId<"TaxCategory">(),
        ...item,
        createdAt: at,
        updatedAt: at,
      };
      tx.taxCategories.insert(row);
      audit({
        entity: "tax_category",
        entityId: row.id,
        action: "create",
        before: null,
        after: row,
      });
    }
    return true;
  });
}
