# Kistefunn I1.1 — B1 Rights Gate (deny-by-default)

Status: REVIEW CANDIDATE, NOT DEPLOYED. Implemented on `integration/b1-kistefunn` only.

## Source baseline
- Base branch: `layout-ux` v1.11, originally from `Testrunner`.
- Backend version: `v15.5.61-i1.1-rights-gate`, advanced from `v15.5.60-test7.27-valuation-consistency-diagnostics`.
- Frontend header: layout v1.12 / integration I1.1 (only result text changed).
- B1 R131 Capture and R132 archive remain **unchanged and separately proven**. The current B1 v4 Capture cannot yet handle normal multi-query app searches.

## Rights policy
- `lib/b1-rights-policy.mjs`: private reviewed configuration; ALL external grants are `null` by default.
- `lib/b1-rights-gate.mjs`: validates source/purpose and structured, time-bound written-approval metadata; any missing/unknown/expired scope is rejected.
- Allowed by default: offline synthetic inspection and first-party item identification, **not** use of synthetic prices for valuation/training.
- Blocked by default: eBay Browse API acquisition for this valuation pipeline; eBay prices in valuations; eBay data for AI training; external-web price acquisition/valuation/training.
- This is a technical restriction, **not** an eBay permission or a legal-compliance certificate. The grant record validation checks structure, not whether eBay really granted the rights. The supporting document must be independently verified by a person with authority.

## Actual enforcement points
- `api/analyze.js`: checks both `ebay_browse:market_retrieval` AND `ebay_browse:market_valuation` before executing `searchEbay`. All token, search and detail functions have independent rights assertions.
- External-web price fallback is skipped unless both `external_web:market_retrieval` and `external_web:market_valuation` are approved; the web search helper has independent assertions.
- `marketSources.ebay.enabled` and `marketSources.web_reference.enabled` also require approved rights (defense in depth).
- Successful AI-only responses emit `market_data_status: ai_estimate_only` and a bounded `rights_status` object. No raw credentials, approval documents, or eBay payloads are exposed.
- Frontend displays: “Beløpet er et AI-estimat, ikke en bekreftet markedsverdi.”
- L1 is not built or activated. Its future ingestion pipeline MUST invoke `requireRights(source,'ai_training')` with trusted provenance. Do not assume the existence of this helper makes any future learning pipeline safe by itself.

## Reopening a source in the future
1. Obtain an actual applicable written agreement/permission and review it for the specific provider, country/market, retention, disclosure and purpose.
2. Record an approval reference, SHA-256 of secured documentary evidence (do not commit the document), responsible reviewer and bounded validity window in the server policy.
3. Obtain user authorization for the code/config change, add tests for the exact permitted scope, review and deploy to a separate restricted Preview. Do not enable production merely by flipping an environment flag.
4. Confirm eBay usage, data retention and buyer redirect requirements and revalidate on policy/terms changes.
5. Reuse neither old B1 one-shot markers nor the spent R131 campaign. The B1 transport itself needs a separately approved new version before generalized market ingestion.

## Regression commands (run on a clone)
```bash
node --test scripts/test-market-data-port-i1.mjs
node --test scripts/test-b1-rights-gate-i11.mjs
node --test scripts/test-b1-analyze-rights-i11.mjs
node scripts/test-test7.27-valuation-consistency.mjs
node --check api/analyze.js
node --check lib/b1-rights-gate.mjs
node --check lib/b1-rights-policy.mjs
```

## Scope and unresolved work
This intentionally changes the integrated analysis experience to AI-only estimation until rights are approved. The existing public/Main production and the isolated R131 Capture build have not been modified. Other third-party data sources and upstream AI service terms should receive separate review before production. No external market pricing should be advertised as approved by this implementation.

No Vercel deployment, Git merge, Neon SQL mutation, API GET/POST or eBay calls were needed for this change.
