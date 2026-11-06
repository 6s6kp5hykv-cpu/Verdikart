# Kistefunn Integration I1.2 — S1-to-B1 Capture Bridge

**State:** implemented on isolated GitHub integration branch, reviewed with offline tests. **Not deployed. Not a running B1 market provider.**

## Pinned source and versions
- Main Kistefunn integration branch: `integration/b1-kistefunn`; base `layout-ux` v1.11, itself based on `Testrunner`.
- Backend: `v15.5.62-i1.2-b1-bridge` (sequential successor to v15.5.61).
- Frontend: layout v1.13 (sequential successor to v1.12).
- Separately maintained B1 private repository: `6s6kp5hykv-cpu/kistefunn-b1-ebay-capture`, reviewed v4 branch `b1-ebay-capture-preview`, pinned commit `fe1966ba553411a036013f6f8905b43ebb9dce3a`.
- B1 Capture v4 declares `CAPTURE_VERSION=b1-ebay-capture-preview-4-audited`, fixed `EBAY_DE` / `Nintendo Switch OLED`, search limit 1 and one detail request. Its output explicitly includes `captureComplete:true`, `analysisComplete:false`, `b1Status:blocked`, `b1Processing:NOT_RUN` and `marketCompleteness:incomplete`. Do not interpret it as a fully implemented market engine.

## Changes in Kistefunn
- `lib/b1-integration-bridge.mjs`: real S1 strict/discovery query planner, bounded to four unique queries times three marketplaces (max 12 planned operations), **none dispatched**; imports existing `lib/market-data-port.mjs` and the I1.1 server rights gate.
- `api/analyze.js`: uses its existing `buildStrictQueries(parsed)` to generate an internal B1 plan during analysis. Exposes only counts, protocol state, rights state and blocking reason as `b1_integration`. No user-entered query strings are returned in this field.
- `lib/b1-integration-bridge.mjs`: separately validates the published B1 v4 Capture output envelope, version, one-shot scope, item IDs and SHA-256 payload/receipt internal consistency. **Hash consistency is not authentication.** It returns only safe counts and states, never prices or raw listings. The verifier does not confer any source trust, valuation rights, training rights or authority to dispatch.
- `index.html`: when the I1.2 backend responds, market summary says the B1 interface is connected to S1, but B1 collection remains inactive.
- `scripts/test-b1-integration-i12.mjs`: 24 synthetic offline contract tests.
- `scripts/test-b1-integrated-handler-i12.mjs`: 8 tests to run against the real backend using fake AI/no network.
- Existing I1.1 rights regression and Test 7.27 version assertions advanced to the new backend/layout versions.

## Controls and limitations
- I1.1 rights policy stays deny-by-default; no modified approvals.
- No B1 Capture POST, OAuth request, eBay Browse call, Neon SQL, or real L1 training.
- B1 v4 R131/R132 source and completed one-shot campaign are untouched. Never replay that campaign.
- The B1 private repository code was **not copied** into the public Verdikart application repository; this is an independent compatibility layer.
- The current app is still AI-only while rights are blocked. The B1 plan status is **diagnostics only**, not real marketplace data.
- A future B1 v5 general transport and protected, authenticated communication between the separate services still must be built, tested and approved before live routing.
- A new Vercel Preview must be explicitly approved and verified before describing B1 as available on a Kistefunn test website.

## Checks performed this session
1. 24/24 offline bridge-contract tests **PASS** locally with Node 22 and no network; initial deduplication test discovered and fixed a real planning issue.
2. Four isolated actual `/api/analyze` execution tests **PASS** (Fender MIM 1995; Haibike Trekking 4; Nintendo Switch OLED; unknown item), using fake AI and hard-blocked network; all respond 200; no outbound calls; `market_data_status=ai_estimate_only`.
3. Frontend inline JavaScript syntax checked after text change; **PASS**.
4. Prior rights-gate and Test 7.27 source version pin updates checked. Complete GitHub CI suite and live protected Preview still **NOT RUN**.

## Next work
- Design and implement a separately reviewed B1 v5 general query/search/detail provider in the **private B1 repository**, with bounded calls, separate authorization, safe server-to-server authentication, provenance and license-aware retention, **disabled by default**.
- Write contract tests using the real, reviewed B1 service interface; no synthetic fixture is evidence of market prices.
- Add a strictly gated transport to Kistefunn, then separately approve a protected Preview deployment and conduct non-eBay UI/functional tests. No commercial eBay valuation or training until rights are resolved and approved.

**Do not deploy to Main or production; do not change Testrunner/layout-ux or B1 v4.**
