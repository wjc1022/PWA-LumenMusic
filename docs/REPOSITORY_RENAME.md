# PrivateKara repository rename

## Status and link inventory (2026-10-29, Asia/Tokyo)

The owner has renamed `wjc1022/PWA-LumenMusic` to `wjc1022/PrivateKara`. Direct GitHub API verification now returns `full_name: wjc1022/PrivateKara`, repository ID `1435119298` (unchanged), and `html_url: https://github.com/wjc1022/PrivateKara`. The pre-rename 404 recorded on 2026-10-28 is historical and no longer describes the current repository. [Issue #2](https://github.com/wjc1022/PrivateKara/issues/2) remains open and [PR #3](https://github.com/wjc1022/PrivateKara/pull/3) remains Draft and unmerged.

Tracked files were inspected with `git grep -n -I -E 'https?://|git@github|PWA-LumenMusic|your-username'`:

| Reference | Decision |
| --- | --- |
| About Source Code href and visible label | Replace the placeholder with `https://github.com/wjc1022/PrivateKara`. |
| English and Chinese README setup | Use the verified repository and clone URLs; remove obsolete pending-rename warnings. |
| README heritage links to `Behnooddev/PWA-LumenMusic` | Preserve upstream attribution. |
| About author link, `index.html`, `src/main.js`, usage guide and package specification links to `Behnooddev` | Preserve original-author and historical references. |
| Locale attribution naming PWA-LumenMusic, LICENSE notices and historical documentation | Preserve provenance. |
| Localhost setup/test URLs and platform documentation links | Preserve; these do not identify this fork. |
| Git origin | Updated this checkout to `https://github.com/wjc1022/PrivateKara.git`; upstream remains `https://github.com/Behnooddev/PWA-LumenMusic.git`. |

No other hardcoded fork URL or project URL placeholder was found in tracked application files. The service-worker shell advances from `lumen-shell-v35` to `lumen-shell-v36` to deliver the changed cached About module, as required by AGENTS.md. The `lumen-shell` prefix and all data identifiers/formats remain unchanged.

## Completed post-rename checks

- [x] Verified the new repository directly through `GET /repos/wjc1022/PrivateKara`, including owner/name, stable ID and final repository URL; verification does not rely on an old-URL redirect.
- [x] Verified PR #3 through its API, commits and changed-files endpoints: open Draft, base `main`, head `feature/privatekara-repository-urls`, original commit `032f108dbe78b132e5bc11d2dbaf0de27a105c10`, and the same seven-file implementation diff. Continued on this existing branch; no new PR was created.
- [x] Confirmed a clean working tree before editing. Updated this checkout's origin, inspected `git remote -v`, ran `git ls-remote origin HEAD` and `git fetch origin`. Local and remote feature heads matched (0 ahead / 0 behind). The upstream fetch/push URLs are unchanged. Other checkouts have not been inspected.
- [x] Checked both README repository and clone references, and ran `git ls-remote https://github.com/wjc1022/PrivateKara.git HEAD`: returned `316f38ecde98c6b608311bdaa1b15c142e85459e`, matching `origin/main` and repository HEAD at verification time.
- [x] Checked tracked active UI/source and README URLs: no old fork URL or placeholder project URL remains. Upstream and historical references are preserved.
- [x] Re-ran the existing local Chromium suite: `node tests/browser-runner.mjs` → **PASS 149**, including About Source Code href/label/external-link attributes in English, Chinese and Persian, attribution, persistence and local offline reload. The emitted repository destination matches the directly verified GitHub repository. This is local browser validation, not published-site verification.
- [x] Re-ran `node --experimental-vm-modules --test tests/lrc.test.mjs tests/lmp-lyrics.test.mjs tests/lyrics-modal.test.mjs tests/import-lyrics.test.mjs tests/audio-engine.test.mjs tests/lyric-file.test.mjs tests/transfer-lyrics.test.mjs tests/media-diagnostics.test.mjs` → **71 passed, 0 failed**.
- [x] Removed pending-rename warnings from both READMEs. This follow-up edits documentation only; no further shell cache bump or runtime/data change is required.

Read AGENTS.md, both READMEs, LICENSE, Issue #2, PR #3 and docs/LRC_DESIGN.md. The AGENTS.md reference to docs/KTV_PLAN.md is still absent from this checkout.

## Outstanding verification and limitations

- [ ] Inspect actual hosting/Pages configuration and successful deployment. Repository metadata now declares `https://wjc1022.github.io/PrivateKara/` as its homepage; this is a candidate published URL, not evidence that the site is deployed or functioning.
- [ ] Verify the live site path, manifest, service-worker scope, shell update delivery, published About destination and offline behavior after deployment. Local browser checks do not complete this item.
- [ ] Validate real iPhone Safari/installed-PWA behavior, media persistence and playback. No real-device acceptance was performed.
- [ ] If hosting origin/path changes, assess access to browser-local data separately; retain backups and do not claim migration.

Keep PR #3 in Draft. No merge, Issue #2 closure, hosting change or data migration was performed. The repository-rename dependency is resolved; the deployment and device checks above remain unverified.
