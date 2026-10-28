# AI collaboration workflow

PrivateKara follows: **ChatGPT + user discussion → GitHub Issue → Codex implementation → Draft PR → ChatGPT review → user approval → merge and Issue closure**. The Issue records agreed scope; source and tests establish technical facts. See the [agent guide](../AGENTS.md), [README](../README.md), and [roadmap](ROADMAP.md).

## 1. Agree on the work

The user and ChatGPT discuss the problem, design, boundaries, and acceptance criteria. ChatGPT creates a GitHub Issue once scope is agreed, applying `ai-managed` for AI-managed work. Include exclusions and validation expectations when relevant. Small fixes can use short Issues; avoid unnecessary ceremony.

Do not silently expand scope. Record proposed changes and obtain user agreement before implementing them; use separate Issues for independent work where appropriate.

## 2. Implement on a safe branch

Codex reads the complete Issue, relevant comments, `AGENTS.md`, relevant docs, source, and tests. Resolve stale technical notes against implementation.

Before editing, inspect status, local diffs, branch, and remotes. Preserve existing uncommitted work. Fetch latest `origin/main` and create a dedicated feature branch from it for new work. If local changes interfere, use an isolated worktree or another non-destructive arrangement; do not discard or silently include them. For an existing PR, continue its branch, inspect divergence from fetched main, and integrate updates as needed without rewriting others' work. Do not force-push or work directly on main.

Implement the agreed scope, run appropriate checks, inspect the final diff, commit, and push. Open/update a **Draft PR** referencing the Issue, for example `Refs #4`; avoid automatic closure keywords. Keep its description current with:

- The problem, resulting behavior, and changed files or areas.
- Checks actually run, commands, outcomes, failures, and skipped checks.
- Compatibility/data risks, limitations, unknowns, and remaining device validation.

Codex reports completion in Chinese with the PR URL and these evidence boundaries. Passing checks do not authorize merging.

## 3. Review independently and iterate

ChatGPT reviews the actual GitHub diff and relevant surrounding code against the Issue's scope and acceptance criteria, rather than relying solely on Codex's summary. If required context or the diff cannot be accessed, state the limitation and leave review incomplete.

Distinguish **Codex-reported tests**, visible CI results, and **checks independently run by the reviewer**. Never present Codex's tests as independently executed. Identify the reviewed commit so later changes cannot inherit an obsolete review. Source inspection and desktop checks do not establish real-iPhone compatibility.

Send findings to Codex for rework on the same PR branch. Codex revises, reruns affected checks, pushes, and updates the summary. ChatGPT reviews the new diff and resolves findings with evidence. Repeat until acceptance criteria are met or remaining limitations are explicitly presented to the user. Keep the PR in Draft while implementation or review is ongoing.

## 4. Obtain approval, merge, and verify

Codex must not merge PRs or close Issues. ChatGPT presents the reviewed result, unresolved risks, and validation limits to the user. **The user must explicitly authorize both merging and Issue closure.** Creating an Issue, requesting implementation, opening a Draft PR, or passing tests is not that authorization. If approval covers only one action, perform only that action. Changes after approval require renewed review and approval of the changed result.

Only after the relevant approval may ChatGPT mark the PR ready and merge it, and close the Issue once approved acceptance criteria are satisfied. Do not enable auto-merge or automatic Issue closure to bypass these gates.

When relevant, verify the merged main commit, CI/deployment status, and affected behavior after merge. Report actual checks, distinguish local/deployment/device evidence, and record remaining problems for follow-up. Failed post-merge verification must be reported and follow-up agreed, rather than silently declaring success.
