/** Every word the landing showcase invents. i18n.ts spreads this under
 *  `landing.showcase`, so the component reads it as
 *  `t("landing.showcase.<key>")`.
 *
 *  Only the fictional workspace's own content lives here. The surfaces inside
 *  the frame are the product's real components, so everything they say —
 *  column headings, status names and roles — comes from the
 *  app's own namespaces, and the tab labels are the app's names for its views.
 *  Identifiers (paths, symbols, hashes, handles, branches) stay in
 *  landing-demo.ts, because code reads the same in any language; a line that
 *  has to name one is handed it as a variable. */
export const landingShowcaseCopy = {
  en: {
    tablistLabel: "Wireal capabilities",
    pause: "Pause the tour",
    resume: "Resume the tour",
    fluidBackground: "Fluid background",

    projectStorefront: "Storefront",
    projectCheckout: "Checkout API",
    projectDesign: "Design system",

    taskRefund: "Refund totals drift",
    taskReceipts: "Localize receipt emails",
    taskGuest: "Ship guest checkout",
    taskFields: "Tokenize card fields",
    taskTax: "Audit tax rounding",
    taskChip: "Replace the price chip",
    taskTokens: "Publish button tokens",
    taskImages: "Cache product images",

    reportRefundBrief:
      "Two customers were refunded a cent short this week. Find where the figure is rounded before anything touches the ledger.",
    reportRefundFound:
      "Walked the refund path end to end: settleRefund rounds before tax is applied, and the ledger row is written from the rounded figure, which is where the totals drift.",
    reportRefundFix:
      "settleRefund now rounds after tax on {{branch}}, and the ledger takes the same figure the order total shows. Both checks pass in the worktree; refunds issued before this keep their stored amounts.",
    reportTax:
      "Ran the tax rounding suite at this commit: 41 cases pass, including the half-cent boundaries that used to differ between the order and its refund.",
    reportCheckout:
      "A guest session carries the cart to confirm without an account row, so the order is written once and the session is thrown away. Signed-in checkout is unchanged.",
    reportTokens:
      "Blocked: Button.tsx still imports the old spacing scale, so renaming the tokens breaks every control in the package. The scale has to move first.",
    reportChipBack:
      "The chip lost its focus ring on the dark theme, and the sale price now wraps under 340px. Take the branch again from where it is.",
    reportChip:
      "PriceChip now borrows Button's focus ring instead of drawing its own, which is the last thing keeping the storefront's copy of the control alive.",
    reportImages:
      "Product images are cached at the edge and warmed from the cart's product ids on first render. Cold loads drop from about 900ms to 120ms.",
  },
} as const;
