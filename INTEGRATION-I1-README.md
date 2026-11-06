# Kistefunn — integration I1.0 (offline contract)

Base: `layout-ux` v1.11, commit `f05b424b2e7ee2d7cdbc9024d4eac53e5317421e`.

B1 technical proof: R131 passed, archived R132. Current B1 v4 transport is **one fixed `Nintendo Switch OLED` query, one result/detail, `EBAY_DE`, one approval campaign**; it is **not a general market provider**. Never reuse consumed campaign or attempt markers.

## Added

- `lib/market-data-port.mjs`: a pure, testable request contract and synthetic fixture normalizer. No network, no DB, no eBay data and no learning.
- `scripts/test-market-data-port-i1.mjs`: deterministic Node.js regressions.
- `vercel.json`: disables Git auto-deploy for `integration/b1-kistefunn`, retains existing `layout-ux` exclusion.

## Explicit non-goals

- No changes to `api/analyze.js` (base backend `v15.5.60-test7.27-valuation-consistency-diagnostics`), `index.html` (layout v1.11), Supabase or existing valuation rules.
- No new B1 Capture deployment, OAuth, eBay search, valuation or training.
- Synthetic outputs are **not market evidence**, and must not be mixed into valuation or L1 learning.
- Nothing is activated in the user-facing Kistefunn application.

## Next step

Separately review/approve a bounded B1 v5 transport interface that supports Kistefunn query planning, multiple marketplace/query calls and exact audit accounting. Confirm eBay rights for valuation and learning before using real data for those purposes. Then integrate behind an off-by-default feature flag and compare against the unchanged v15.5.60 baseline.

Production/Main/Testrunner/layout-ux remain unchanged. Do not deploy before approval.
