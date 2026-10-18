# Development context

- Lumen is the application being extended. `../karaoke-stage` is a read-only implementation reference.
- Keep the app framework-free and dependency-free; serve the repository over HTTP. No build step is required.
- Read `docs/KTV_PLAN.md` and `docs/LRC_DESIGN.md` before changing lyrics or playback.
- Keep imported media and lyrics local. Google Drive integration is a later phase.
- Preserve existing English/Persian lyrics records and plain-text editing.
- Use audio element currentTime as the playback clock; never accumulate a separate lyrics clock.
- Add new runtime modules to sw.js and change its cache version when shipping app-shell changes.
- Test parser behavior with `node --test tests/lrc.test.mjs`. Verify playback, paused seeking, track switching, persistence, and offline behavior in a browser when available.
- Run all lyrics tests with `node --experimental-vm-modules --test tests/*.test.mjs` (use explicit filenames if the shell does not expand wildcards). VM tests stub browser/database interfaces; they do not replace real browser acceptance.
- Delegate only disjoint file ownership, with explicit interfaces and acceptance criteria. The primary agent integrates and verifies the result.
