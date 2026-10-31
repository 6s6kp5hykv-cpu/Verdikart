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
