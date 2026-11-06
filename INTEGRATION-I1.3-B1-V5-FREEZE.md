# Kistefunn Integration I1.3 — checkpoint for B1 v5

**Status 2026-11-06:** isolated PREVIEW smoke-tested REVIEW CANDIDATE. B1 not active for users and no eBay-derived valuations or L1 training are enabled.

## Pinned versions
- Kistefunn integration branch: `integration/b1-kistefunn` based on `layout-ux` v1.11.
- Backend: `v15.5.63-i1.3-b1-v5-transport`; frontend presentation remains layout v1.13.
- B1 v5: `b1-market-v5.0-rights-gated` in private branch `integration/b1-v5-rights-gated`, tested CI commit `f281e977fcaef517c04a3aae69f139846bbdc5e5`.
- Original B1 v4 Capture commit `fe1966ba553411a036013f6f8905b43ebb9dce3a` remains untouched.

## Integration
- Existing S1 `buildStrictQueries` generates a bounded v4-compatible planning summary and a v5 transport plan.
- `lib/b1-v5-client.mjs` supports authenticated server-to-server POST, exact approved `https://*.vercel.app/api/b1-v5-market` destination, random nonce, HMAC SHA-256 response integrity, TTL, no redirects, timeout, source/response binding and strict fail-closed behavior.
- Third-party data rights are blocked by `lib/b1-rights-policy.mjs` and `lib/b1-rights-gate.mjs`; no eBay, external web valuation, AI training or B1 outbound network calls when rights are denied.
- `api/analyze.js` returns `b1_v5_transport` with a nonvaluative status and retains the previously reviewed `b1_integration` evidence.
- `api/b1-integration-status.js` provides GET-only, Preview-only, read-only integration metadata to aid smoke checks, no market requests.
- App code does not yet consume B1 results in the valuation algorithm. Replacing the old built-in eBay acquisition will require separate rights-cleared, audited integration and tests.

## Automated offline tests (GitHub Actions)
- Kistefunn run: https://github.com/6s6kp5hykv-cpu/Verdikart/actions/runs/42241292560 (success).
- Private B1 v5 run: https://github.com/6s6kp5hykv-cpu/kistefunn-b1-ebay-capture/actions/runs/42240538511 (success).
- Tests cover market-query input limits, source validation, URL/price projection, auth refusal, HMAC signature tampering, stale responses, rights gates, S1→B1 v5 planning and actual `api/analyze` handler with isolated AI and zero eBay calls.
- The B1 v5 contract/provider tests use injected offline responses, **not real marketplace data**.

## Protected Vercel Preview smoke checks
- B1 v5 deployment `dpl_HvZmS8PeRbSAG9rXJRACKkGFehPb` READY, GET `/api/b1-v5-health` HTTP 200 `rights_blocked`, GET `/api/b1-v5-market` 405.
- Kistefunn deployment `dpl_D1L6nLwRpvY3EpVcgA64h83p3hw1` READY; GET `/` HTTP 200 layout v1.13 and GET `/api/analyze` HTTP 405.
- Existing Preview protection enabled on both Vercel projects. No domain/promotion/production deployment made.
- The new read-only `/api/b1-integration-status` endpoint must be verified on the final deployment after its commit.

## Still blocked and not yet proven
- No protected live server-to-server POST with configured secrets across the two Vercel deployments. Authenticated protocol verified offline, not cloud-end-to-end.
- No real v5 multi-query eBay lookup (license unresolved); no per-item details enrichment.
- No production-safe multi-request durable replay/rate ledger and full retention, security and operational approval.
- No use of eBay-derived listings for valuation, training or public launch.
- No verification of full browser login/mobile/analysis POST paths in this phase.

## Freeze rule
Freeze B1 v5 and this integration as a rights-blocked review candidate; do not merge to Main, change R131/R132, configure credentials, bypass protection, or activate live data without an explicit separate user approval and legal/operational review. These remaining items are a future activation workstream, not prerequisites for moving development focus to S1, L1 (with own data), and UI/UX.
