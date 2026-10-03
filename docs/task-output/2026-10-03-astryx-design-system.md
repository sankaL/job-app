# Astryx design-system conversion

Completed 2026-10-03. All authenticated routes and invite onboarding now use Astryx core 0.6.5 with the neutral theme. The existing sidebar, topbar, page placement, workbench order, modal content, filters and responsive rules remain. Marketing and login use their original palette and controls. No features, data fields or user actions were added.

## Shared implementation

- Installed and pinned `@astryxdesign/core`, `@astryxdesign/theme-neutral` and `@astryxdesign/cli` at 0.6.5, with `@stylexjs/stylex` at 0.19.1. Ran the requested CLI init and read its generated agent guidance, migration, theme, token and component docs.
- AppShell provides the neutral Theme to pages and document portals. Theme teardown restores document attributes on public routes. Existing layout containers are retained to honor the user's placement constraint.
- Shared UI adapters use real Astryx Button, Card, Token, Badge and Table components. Native Input, Textarea and Select adapters use theme tokens and retain browser validation, numeric/file types, option/change events, refs and Markdown selection behavior. Filters reuse these controls.
- Tables and loading tables share row/cell treatments. Account, action, notification and information menus share a Card-backed popover frame. Sidebar and topbar remain shared across normal app routes.
- App colors, typography, elevation, shape, syntax highlighting and chart accents now use semantic theme tokens. Tailwind's reset belongs to the reset cascade layer, allowing the Astryx component layer to style controls. The public palette remains scoped to marketing/login.
- Added a guarded Makefile frontend refresh target and a Docker ignore file so dependency updates refresh the existing local frontend without rebuilding unrelated services or importing host node_modules.

## Dead code and review

Removed an unreachable base-preview render helper and its orphaned variables, unused imports/state setters/props, unused parser/diff exports, superseded global utilities and button animation styles, plus Radix Slot and class-variance-authority dependencies. All source modules remain reachable. TypeScript rejects unused locals and parameters.

Knip's remaining reports concern the Chrome extension's manifest-loaded service worker/CSS and its dynamically evaluated test/bridge exports. Those are runtime dependencies and were retained.

Self-review found and fixed:

- Core tooltip semantics changed disabled buttons to aria-disabled; preserve native titles and true disabled/loading behavior.
- Library label wrapping changed icon/text alignment and a multi-line ATS tile; adapters preserve each original content layout.
- Core table header max-width collapsed columns; retain each caller's column geometry. Neutralize parent Card edge bleed inside the existing table frame, preserve native cell wrapping, and restore small-button typography/density.
- Sorting lacked keyboard activation and sort announcements; use shared header buttons and aria-sort. Interactive rows accept Enter/Space without activating from nested actions.
- Pagination lost its selected-page treatment; restore pressed/current state.
- Menus lacked Escape dismissal and duplicated their visual frame; share the popover adapter and clean up listeners. Keep the shared page header above supporting cards so action menus remain visible.
- Pending dialogs could dismiss through Escape/backdrop despite disabled close buttons; honor the pending state on all dismissal paths.
- Markdown placeholder/footer contrast and the mobile sidebar overlay needed semantic tokens. Use secondary text for the created chart series so it remains readable; status bars use info/success tokens consistently with status pills.
- Toast removal timers were untracked, and mobile toast width could overflow; clean up both timer types and constrain width to the existing right inset.

## Verification

- Makefile-managed local Docker frontend suite: 235 tests across 18 files passed. Covers app/admin flows, generation states, workbench editing, comparison, exports, disabled controls, native forms, refs, document theme cleanup, keyboard tables, pending dialogs and toast timer cleanup.
- Makefile-managed TypeScript/Vite production build passed, including unused-symbol checks. Vite still reports large chunks; no bundle-splitting redesign was included.
- Local environment guard suite: 15 tests passed.
- Astryx doctor: 11 checks passed, zero warnings/failures.
- Production dependency audit: zero advisories. Compatible dependency patches were applied. Seven advisories remain in the existing Tailwind 3 / Vitest 3 development dependency tree; resolving them requires a separate toolchain upgrade. These packages are excluded from the shipped runtime audit.
- Browser checked dashboard, applications, new-application modal, generated resume detail, source resume preview/edit, profile, extension page, admin metrics/user tables/subscriptions, action and notification menus, and responsive application filters. The requested mobile viewport override produced a browser layout below the mobile breakpoint with equal document/viewport widths. The override was reset after verification.
- Public login retained its prior appearance after theme teardown. Marketing source and its original styles remain isolated.

No live AI request or data migration was needed. No hosted service was used for testing. Admin writes and some asynchronous/error branches were verified through mocks rather than fresh browser mutations. User review of the converted screens and a wider responsive walkthrough would increase confidence in the remaining visual cases.
