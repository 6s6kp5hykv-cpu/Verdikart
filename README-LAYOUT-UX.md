# Kistefunn layout-ux v1.0

Base: Testrunner commit eeb20016252f8b91837f607ae15bb2bfc1900ad7.

Separate UI candidate, 31 October 2026. No merge or production approval.

## Changes
- Desktop top navigation; mobile bottom navigation with safe-area clearance.
- Marketplace heading, two-column desktop filters and single-column mobile filters.
- Logged-out view: disabled marketplace fields, clear login action using the existing account screen. Existing authentication and access requirements are preserved.
- Find-value shortcut using the existing scan screen.
- Existing recommended sort default preserved.
- Candidate version visible on marketplace.

## Scope
Only index.html presentation and UI state synchronization changed. api/, search, valuation, Supabase operations, B1 and existing branches are untouched.

vercel.json disables automatic Git deployment for layout-ux only. Separate explicit Preview approval is required. Do not merge this candidate directly into main.

## Verification
Inline JavaScript syntax and unchanged core application functions checked locally. Browser tests could not run: local Chromium is not installed. Desktop/mobile rendering, navigation and login display checks remain pending. No live analysis or database requests were made. Live Preview verification is pending.

## v1.1 — 31 October 2026
Simplified Finn verdi into one form card, with collapsed photo tips, keyboard-accessible file-picker buttons and concise copy. All script blocks are byte-identical to v1.0; analysis/search/upload handlers are unchanged.

Preview source commit: 59c58744dac901af8ba0da5a4fcd6463a276fb29.
Preview: https://verdikartmvpiphone-5hoio0t00-rehtmar.vercel.app/
Verified in cloud browser: correct v1.1, Finn verdi navigation, text entry enables action, photo tips expand/collapse, reset clears text and disables action. No analysis submitted. Physical camera, file uploads, mobile viewport and logged-in state remain unverified. Backend/B1 and original branches untouched.

## v1.2 — result presentation candidate
Source commit: 2bb4a2f8819fe689909ba2599a78d0b24da6161a.
Preview: https://verdikartmvpiphone-5f21wk2sk-rehtmar.vercel.app/
Two-column desktop results (single column below 800px), collapsed search form while loading/complete, rotating SVG chest while loading and open lid on completion, edit-search action preserving inputs, collapsible methodology and external references. Original application script blocks byte-identical to v1.1; additional observer only synchronizes UI to existing loading/result classes. No valuation/filter/backend changes. Existing eBay data labels and inclusion flags preserved; screenshot proposal is not an exact pixel template.
Syntax PASS; Preview READY; live browser loading state checked with one Fender MIM 1995 request. Mobile, error flow and image upload remain pending.

## v1.3 — Kongekisten branding
Source commit: 59ec1a50230e3625d3ae7cc4b0456c25ddc8b2f8.
Preview: https://verdikartmvpiphone-byfx69p7f-rehtmar.vercel.app/
Ornate mahogany/brass Kongekisten artwork in header, enlarged brand name and gold tagline. Closed artwork rotates during loading; open artwork fades in on completion (two images, not an articulated 3D lid animation). Responsive header sizing and reduced-motion support. Asset WebP derivatives under assets/; generated originals retained separately. All existing script blocks unchanged. Desktop header visually checked in live Preview; no new live analysis run. Mobile/header breakpoints and search artwork transition still need visual testing. Backend/B1/production unchanged.

## v1.4 — account settings and admin navigation
Source commit: caf7d0748f48772612abdae6f0147773e8e03145.
Preview: https://verdikartmvpiphone-7680a4ydi-rehtmar.vercel.app/
Separate account subviews: overview, settings, admin. Logout and existing account deletion action moved to settings (deletion inside a disclosure). New profile inputs and password-change control explicitly disabled pending separately authorized backend work. Admin entry appears only after existing admin-diagnostics endpoint confirms access; no new authorization mechanism. Existing initial diagnostic fetch remains unchanged for access confirmation; its large history is visible only in the Diagnostics menu pane. Statistics/usage are labelled planned without fabricated metrics. All pre-existing JS blocks preserved; new presentation observer and navigation helpers only.
Syntax PASS; Preview opened; logged-out Min side checked. New origin requires user sign-in before settings/admin visual verification. No credentials copied between previews, no password/deletion/logout actions executed. Signed-in navigation, non-admin state and mobile view remain pending.

## v1.5 — account title shortcuts
Source commit: 3d3e94f7747beaa2219b7df1e740fa2fb95c9f0d.
Preview: https://verdikartmvpiphone-dxtko3yji-rehtmar.vercel.app/
Moved existing settings/admin buttons from bottom of account overview to right of Min side heading; compact buttons, stacked heading/actions below 650px. Existing IDs, authorization visibility and all JS preserved. Prior v1.4 signed-in account overview observed in cloud browser before change. Fresh-preview signed-in placement and mobile verification remain pending.

## v1.6 — saved finds and search history
Source commit: b9c5c0947e43fd44a1fbed71b34f40c5febc9486.
Preview: https://verdikartmvpiphone-mvkpvlht0-rehtmar.vercel.app/
User-facing Min samling/Samling renamed Mine funn; result save action renamed Lagre i mine funn. Former automatically recorded Mine funn renamed Søkehistorikk, with explanatory copy. Saved items retain existing collection_items persistence, history and sale actions; automatic local history remains separate under kf_finds. No migrations, data moves, auth/analysis changes. Existing saved items remain accessible. Syntax checked; authenticated save/delete not executed.

## v1.7 — saved-find grid and Enter login
Source commit: 34a34a3dfdf202ec20c52524dc8695a91e40a6b1.
Preview: https://verdikartmvpiphone-d9hoj96fb-rehtmar.vercel.app/
Saved findings: 3 columns on desktop, 4 from 1500px, 2 at tablet widths, 1 below 651px; photo beside existing actions; delete remains visible but visually subdued, existing confirmation unchanged. Long condition paragraph hidden in compact cards. Values formatted as NOK. Find-value callout moved to very top of marketplace. Password Enter invokes existing login() without changing auth implementation (IME composition ignored). Labels: Lagrede annonser, Kjøpsønsker, history count in søk. Syntax PASS; live Preview marketplace order checked. Authenticated grid, physical mobile and successful credential/Enter login remain pending user verification. No backend/B1 or production changes.
