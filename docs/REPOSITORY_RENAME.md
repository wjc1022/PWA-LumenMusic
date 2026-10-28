# PrivateKara repository rename

## Status and link inventory (2026-10-28)

Issue #2 prepares a rename from `wjc1022/PWA-LumenMusic` to `wjc1022/PrivateKara`. The rename is pending owner action. A GitHub API lookup of the intended repository returned 404 during implementation; the new URL is not yet verified. Keep the PR in Draft until the checklist below is complete.

Tracked files were inspected with `git grep -n -I -E 'https?://|git@github|PWA-LumenMusic|your-username'`:

| Reference | Decision |
| --- | --- |
| About Source Code href and visible label | Replace the placeholder with `https://github.com/wjc1022/PrivateKara`. |
| English and Chinese README setup | Add the intended repository and clone URLs; neither previously had a clone URL. Clearly mark rename dependency. |
| README heritage links to `Behnooddev/PWA-LumenMusic` | Preserve upstream attribution. |
| About author link, `index.html`, `src/main.js`, usage guide and package specification links to `Behnooddev` | Preserve original-author and historical references. |
| Locale attribution naming PWA-LumenMusic, LICENSE notices and historical documentation | Preserve provenance. |
| Localhost setup/test URLs and platform documentation links | Preserve; these do not identify this fork. |
| Git origin | Leave at the existing repository until rename; upstream remains unchanged. |

No other hardcoded fork URL or project URL placeholder was found in tracked application files. The service-worker shell advances from `lumen-shell-v35` to `lumen-shell-v36` to deliver the changed cached About module, as required by AGENTS.md. The `lumen-shell` prefix and all data identifiers/formats remain unchanged.

## Owner action and merge prerequisites

The safe rename point is after the feature branch is pushed and the Draft PR exists, before marking it ready or merging. The owner must open the current repository's **Settings → General → Repository name**, enter **PrivateKara**, and click **Rename**. Codex must not perform this operation.

After the owner renames the repository:

- [ ] Verify `https://github.com/wjc1022/PrivateKara` resolves directly to the intended repository, with the expected owner and name; an old-URL redirect alone is insufficient.
- [ ] Open the existing Draft PR under the new repository URL and confirm its number, base, head branch, commits and diff are intact.
- [ ] Update each checkout with `git remote set-url origin https://github.com/wjc1022/PrivateKara.git`; inspect `git remote -v`, run `git ls-remote origin HEAD` and `git fetch origin`. Keep the Behnooddev upstream remote unchanged.
- [ ] Verify both README repository links and `git ls-remote https://github.com/wjc1022/PrivateKara.git HEAD`.
- [ ] Preview About in English, Chinese and Persian; verify the Source Code label and destination and preserved upstream attribution. Follow the destination and check the final repository identity.
- [ ] Inspect actual hosting configuration and published site URL (none is declared in the tracked files). If using repository-scoped GitHub Pages, verify the new path, deployment settings, manifest and service worker. A changed site origin/path can affect access to browser-local data; retain backups and do not claim data migration.
- [ ] Deploy/preview the changed shell and verify the published About link, including after a service-worker update. Record the final URLs and results in the PR, update this status and remove the pending-rename caveats in both READMEs once verified.

Only then may the owner/reviewer mark the PR ready and consider merging. Until then the PR remains Draft, and the planned links may be unavailable. No repository rename, hosting change, data migration or merge is part of this implementation.
