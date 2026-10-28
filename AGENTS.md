# PrivateKara agent guide

## Scope and source of truth

PrivateKara is a local-first, bring-your-own-media karaoke PWA for phone playback and venue screen mirroring. It does not supply or generate media or lyrics. Cloud access and record persistence remain future work; do not assume a backend or account system.

Read the agreed Issue, [README.md](README.md), [roadmap](docs/ROADMAP.md), relevant source/tests, and the [AI workflow](docs/AI_WORKFLOW.md). Verify technical details against current implementation; historical notes and legacy specifications may be stale.

## Architecture and constraints

- Keep native HTML/CSS/JavaScript ES modules: no framework, new dependencies, or build step. Serve locally with `python -m http.server 8080`; use HTTPS for phone/PWA testing, not `file://`.
- `index.html` and `src/main.js` define the shell and router; `src/pages/` contains views, `src/components/` shared UI, and `src/styles/main.css` styles.
- `src/services/audioEngine.js` owns playback. Player UI is in `src/components/miniPlayer.js`, `playerSheet.js`, and `playerLyrics.js`. Lyrics follow active media `currentTime`; protect asynchronous song changes against stale results.
- `src/database/db.js` owns library storage. Import/backup services are in `src/services/importService.js`, `lyricFile.js`, `transferService.js`, and `lmpService.js`. `src/lyrics/lrc.mjs` already parses Enhanced LRC word tags.
- Localize UI through `src/locales/en.json`, `zh-CN.json`, and `fa.json`; respect Persian RTL. Lyric language is independent of UI language.
- `sw.js` caches the app shell. Inspect resource coverage and cache lifecycle for runtime shell changes; documentation-only work does not require a cache bump.

## Data and compatibility

- Preserve persistent identifiers, including `lumen-db`, existing storage keys/events, and the Lumen Music Package name. Branding does not authorize renaming or migrating data.
- Current IndexedDB is `lumen-db` version 2: song metadata/resource IDs, separate `media` and `songState`, plus playlists, recents, lyrics, and settings. The existing upgrade recreates stores and clears prior app data. Do not extend destructive resets without agreed scope and a compatibility plan.
- JSON backups use `formatVersion: 3`; `.lmp` manifests use `packageFormatVersion: 3`. Both importers reject older versions. Inspect import and export together before format changes.
- Each song has one raw lyric text: database/JSON `{ songId, text }`, package lyric file `{ id, text }`. Preserve whitespace, multilingual text, and word tags through round trips; do not export derived display lines or language columns.
- Browser storage is not a backup. Preserve user resources and failure evidence; do not mask persistence failures by clearing data or reimporting.

## Working and documentation rules

- Inspect status and diffs first; preserve existing work. Fetch latest `origin/main` and branch from it for new Issues, or safely continue an existing PR branch. Do not overwrite unrelated changes, force-push, or commit directly to main.
- Stay within the Issue's acceptance criteria; raise scope changes explicitly. Do not delegate to sub-agents unless the user explicitly requests it.
- Keep this guide in English; preserve each document's language and maintain paired English/Chinese docs when both are affected. Use UTF-8. Distinguish implementation, plans, and historical evidence; keep durable guidance concise.
- Preserve upstream attribution to Behnood Shafiei / PWA-LumenMusic and all MIT notices in [LICENSE](LICENSE), including Lumen contributors and Junchao Wen.
- Commit/push and open/update a Draft PR referencing the Issue. Codex must not merge or close Issues; follow the workflow's explicit user approval gates.

## Verification and reporting

Run from the repository root with Node.js; no npm install is needed:

```sh
node --test tests/lrc.test.mjs
node --experimental-vm-modules --test tests/*.test.mjs
```

For PowerShell, expand the test paths explicitly (Node may receive a literal wildcard):

```powershell
$testFiles = (Get-ChildItem tests/*.test.mjs).FullName
node --experimental-vm-modules --test $testFiles
```

The full suite uses experimental VM modules for source-module harnesses. Optional desktop Chromium checks use `node tests/browser-runner.mjs`; modes include `--storage`, `--diagnostics`, `--video`, and `--stable-audio`. Set `CHROME_PATH` if Chrome is not at the runner's default Windows path. Inspect fixture/environment requirements before running.

Choose checks proportional to the change. Documentation requires `git diff --check`, local link/path checks, and source verification of technical claims. Runtime changes need relevant automated/browser checks. Report actual commands, outcomes, failures, and skipped checks; do not reuse historical pass counts.

Real iOS Safari and installed-PWA validation remains necessary for file selection, restart persistence, audible output, sustained playback, instrumental switching, wake lock, touch/safe areas, fullscreen/orientation, and mirroring. Playback is foreground-oriented; native video fullscreen cannot show custom HTML lyrics. Desktop harnesses, metadata loading, or advancing time do not prove iPhone reliability.

Report completion in Chinese with changed files, decisions, actual checks/results, limitations/unknowns, and PR URL. Separate source inspection, automated checks, browser checks, and real-device evidence. Never claim checks you did not run.
