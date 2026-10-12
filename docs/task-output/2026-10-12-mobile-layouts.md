# Phone layouts for authenticated pages (2026-10-12)

## Goal
Every authenticated page should be usable at phone width (about 375px) without scrolling sideways to see data. Less important information is hidden on phones.

## Breakpoints
- **Phones are below 768px.** This is the Astryx `md` breakpoint and the shell's MobileNav switch. Use `useIsMobile()` from `frontend/src/lib/use-is-mobile.ts`.
- **The application workspace splits into two columns from 1280px.** Use `useIsWideWorkspace()`.
- **Tests:** the jsdom `matchMedia` mock in `src/test/setup.ts` now understands both `min-width`/`max-width` and range syntax. `src/test/viewport.ts` exports `setViewportWidth(width)`, which returns a restore function.

## What changed

### Tables (`components/ui/data-table.tsx`)
- **Card props:** the new `mobileCard(row)` and optional `mobileHeader` props render a card list below 768px.
- **Shared rows:** the card list uses the same filtered, sorted, grouped and paginated rows as the table. Group headers collapse, and cards support row click and Enter/Space activation. A click on a button, input, link, checkbox or menu item inside a card does not navigate. `onVisibleRowsChange` still drives selection.
- **Phone toolbar:**
  - Search sits beside one ⋯ menu with Sort by, Group by and saved views.
  - The search field fills the row beside the ⋯ menu.
  - Filter chips sit in one horizontally scrolling row.
  - The result count sits right-aligned on the row above the cards, beside "Select page" where the page has selection.
  - Density and column visibility are hidden because they do not apply to cards.
  - The pagination row drops its "Page x of y" label.
- **Applications cards:** checkbox, title with notice, company, status, updated date, and the applied/delete actions. Base Resume is hidden. The bulk bar becomes a fixed bottom bar (`.app-mobile-action-bar`).
- **Admin Users cards:** name, email, status, tier, a pending-invite note and the actions. Invite dates and Updated are hidden. Desktop column widths no longer inflate the minimum table width.

### Top bar
- **Logo and breadcrumbs:** on phones the logo is hidden on every page, since the menu toggle replaces it. Breadcrumbs show only the current page, with no ancestor separators, so admin and user headers match.
- **New `PageHeader` props:** `mobileMenu` (secondary actions as data) and `mobilePrimary`. On phones only the primary action and a "More actions" menu render.
- **Pages using them:** base resume editor, Resumes, Admin Users and Extension.
- **Application detail:** shows Activity as an icon and drops the separate Close Comparison button on phones; Close comparison stays in its Actions menu.
- **Profile:** hides the "Unsaved changes" text visually on phones; it stays in the live region.

### Application detail
- **Below 1280px:** a full-width Resume | Details `SegmentedControl` sits under the page header. The workspace carries `data-mobile-pane`, and CSS hides the inactive pane, so both stay mounted.
- **Collapse rail:** wide-screen only.
- **Resume sheet on phones:** no longer has a fixed height, so the page scrolls once instead of a nested scroll area.
- **Keyword and Resume Judge breakdowns:** open as bottom sheets on phones (`.app-dialog-overlay`/`.app-dialog-panel`), using `100dvh`.

### Compare
- **`CompareHeroBar` on phones:** pins only the section nav and an Options toggle. The toggle reveals the summary and highlight modes. The layout selector appears from 1024px up.
- **`CompareSectionNav`:** the active pill now accounts for the strip's scroll offset and scrolls the active button into view.

### Smaller fixes
- **Section index:** on phones the resume section index is one sticky, horizontally scrolling row.
- **`ModalShell`:** caps its height at `100dvh - 2rem` and scrolls its body. Form padding is smaller on phones.
- **Activity panel:** gains a backdrop on phones and a flex body instead of a hard-coded height.
- **Resumes grid:** the minimum card width is now 280px.
- **Dashboard and admin rows:** the dashboard recent row keeps its badge from shrinking, and dashboard and admin headers wrap.
- **Removed:** the unused `.dt-hide-mobile` / `.mobile-filters-toggle` CSS.

## Verification
- `npx vitest run`: 316 tests pass. `base-resume-workbench.test.tsx` fails to load because `VITE_API_URL` is unset in the test environment. It fails the same way at HEAD.
- New tests:
  - Data-table phone cards and the desktop fallback.
  - Applications phone cards.
  - Resume / Details switch keeping unsaved edits.
  - The More actions menu.
  - The collapse test now runs at a 1440px viewport.
- `npm run build` passes.
- **Not done:** a visual browser check at 375px and 768px. Run the local stack and check each page for `document.documentElement.scrollWidth === innerWidth`.

## Not done from the plan
- The ⋯ row menu for application/admin card actions. The existing compact icon actions fit on the card, so they were kept.
- An attention dot on the Details tab. Action-required state already shows in the page header.
- A card-shaped loading skeleton for phones. The table skeleton still shows while loading.

## Code review fixes
- **Bulk bar:** the phone bulk bar is now portaled to `document.body`. `.page-enter` keeps a transform after its `both`-fill animation, which made the `position: fixed` bar scroll with the page.
- **Delete explanation:** the phone bulk bar now shows a short reason when Delete is disabled ("Can't delete while N still processing.").
- **Resume pane:** below 1280px, the detail page switches to the Resume pane when generation starts, so its progress and outcome are visible.
- **Card clicks:** cards ignore clicks on any `menuitem*` role, including radio and checkbox items.
- **Group headers:** cards get one header per group even when the sort interleaves group values.
- **`PageHeader`:** the desktop and phone action content are split into separate variables.
- **New tests:**
  - Card keyboard activation, the menu-item click guard and interleaved groups.
  - The bulk bar rendering at the document root.
- **Not changed:**
  - The split compare layout below 1024px. It already renders stacked there.
  - Counting selections in collapsed groups. This needs a product decision.
  - The duplicate addable-kind filter. It belongs to the separate Add Section change.
  - The detail page's own phone header actions.
  - The `matchMedia` mock's change events.
