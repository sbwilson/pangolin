import type { BankId } from "../../lib/import-format.ts";

/** Export steps per bank. CommBank is from the mockup; the others are [ASSUMPTION] copy. */
const TIPS: Readonly<
  Record<BankId, { readonly title: string; readonly steps: readonly string[] }>
> = {
  commbank_csv: {
    title: "How to export from CommBank",
    steps: [
      "In NetBank on the web, open the account.",
      "Choose Export, pick OFX (best) or CSV, and set the dates from your last import to today.",
      "Drop the file above.",
    ],
  },
  ubank_csv: {
    title: "How to export from ubank",
    steps: [
      "In ubank on the web, open the account and choose Transactions.",
      "Choose Download, pick CSV and set the dates from your last import to today.",
      "Drop the file above.",
    ],
  },
  up_csv: {
    title: "How to export from Up",
    steps: [
      "In the Up app, open the account and choose Export transactions.",
      "Pick CSV and the dates you want.",
      "Drop the file above.",
    ],
  },
  fy2025_multibank_csv: {
    title: "The FY2025 multi-bank export",
    steps: [
      "Use the single timestamped export that covers 1 Jul 2024 to 30 Jun 2025.",
      "Pick the account it belongs to.",
      "Drop the file above.",
    ],
  },
};

export function ExportTips({ bank }: { readonly bank: BankId }) {
  const tips = TIPS[bank];
  return (
    <section aria-label="Export tips" className="rounded-lg bg-muted/50 p-3 text-sm">
      <h3 className="mb-1 font-semibold">{tips.title}</h3>
      <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
        {tips.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-2 text-muted-foreground">Re-importing the same file changes nothing.</p>
    </section>
  );
}
