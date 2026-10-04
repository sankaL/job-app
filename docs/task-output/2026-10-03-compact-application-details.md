# Compact application details

Completed 2026-10-03 21:17 EDT.

The application workspace now starts directly with the resume sections. Generated/exported timestamps and the draft revision appear in small secondary italic text beside the company under the title. The supporting panel aligns with the title and uses a slightly stronger warm tint.

Job fields, base resume, target length, additional instructions and Notes open as read-only values. Each field has an Edit icon; long text has a three-line preview and an expansion control. Done and Escape preserve changes in page state. Job information and generation settings still use their existing explicit Save handlers, with Save shown only when changes exist. Notes still autosave. Changing applications resets individual editors; collapsing the panel preserves them.

Aggressiveness uses the Astryx Slider at Low, Medium and High stops. Labels expose existing full mode definitions on hover, keyboard focus and touch. The selected High warning remains visible. No AI prompts, generation parameters, backend or data contract changed.

## Validation

- Makefile-managed local Docker TypeScript/Vite build passed.
- Affected regression suite: 187 passed, 1 failed out of 188. The remaining failure is the known pre-existing test `switches the shell into immersive mode during compare and restores the default shell on close`; it observes `default` instead of `immersive` after opening comparison. The test was preserved.
- New tests cover isolated field editing, autofocus/focus restoration, retained values, empty placeholders, long-text expansion, generation setting edits, slider keyboard operation and tooltip disclosure.
- Local browser verified application title/panel alignment, muted timestamps, read-only job fields, editing only Job Description, read-only instructions, slider presentation, and panel collapse/expand. No user content was saved during visual checks.
- Whitespace diff check passed.

Screenshots are in the Codex visualization folder for this chat: `application-details-readonly.jpg` and `application-settings-compact.jpg`.
