# Sticky resume workbenches — 2026-09-30

Completed header name editing and the source/application layout follow-up. The saved base name remains in the breadcrumb and header; its edit button replaces the title with one labeled name field associated with the section-save form. New scratch resumes begin with that field focused. Uploads still request a name in their initial form.

The selected resume tab owns content scrolling, with auto-growing prose editors, navigation and add/save controls outside that scroll region. The left rail stays sticky during fallback page scrolling. Desktop source editors fit the viewport from 768 pixels wide and 800 pixels tall; application workspaces fit from 1280 pixels wide and 800 pixels tall. Narrower or shorter screens preserve page flow to keep all controls reachable.

Application resumes now precede the supporting cards in DOM order and sit on their left at desktop width. Resume Judge, ATS Keywords, Job Description, Generation Settings and Notes have a separately bounded, keyboard-focusable right column. CSS layout containment prevents its descendant overflow from enlarging the page. Comparison remains full width. Removed obsolete settings-height measurement and its observer/listener.

Review findings fixed:

- Re-upload while editing a header name could leave two name inputs with the same ID. Re-upload now closes header editing; a regression test covers the transition.
- Supporting cards could extend document scroll height despite their scroll container. Layout containment keeps that overflow local without clipping the resume rail.
- Regeneration wrappers and first-generation/empty placeholders needed bounded desktop heights after removing height matching. They now inherit the workspace height while retaining progress and cancel controls.

Validation used the Makefile-managed local Docker dev stack: all 218 frontend tests passed; TypeScript and the production build passed; `git diff --check` passed. Added tests for header rename cancellation, Enter submission through the external form, new-resume focus, re-upload recovery and supporting-panel DOM order/landmarks. Existing application tests cover generation locks, recovery, comparison and save behavior.

Browser checks on localhost verified a source viewport of 850 × 1080 with document height equal to viewport height; scrolling long Experience content changed only its panel offset and left navigation stayed at the same position. At 1600 × 1000 the application document also fit exactly; scrolling supporting cards to offset 1003 left page scroll at zero and resume navigation unchanged. A narrow 487 × 800 application viewport stacked resume before details with no horizontal overflow. Temporary viewport overrides were reset, and the original source page was restored. No browser saves or AI operations were performed.

Confidence: 96%. Additional browser engines and more unusually tall banners/custom-section lists would increase confidence in responsive edge cases. No backend, schema, model or prompt behavior changed.
