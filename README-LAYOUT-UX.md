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
