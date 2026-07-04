# Task Backlog GitHub Issue Migration Design

**Date:** 2026-07-04
**Status:** Approved for planning
**Goal:** Migrate the markdown backlog in `docs/tasks/` into GitHub issues using `gh`, while establishing a reusable issue-template set for future backlog capture.
**Out of scope:** Grooming migrated issues to a delivery-ready state. Reworking backlog priorities. Migrating `docs/tasks/index.md`, `docs/tasks/mcpwritetools.md`, or `docs/tasks/renaminganddeletion.md`.

---

## 1. Context and goals

Corum currently carries a feature backlog as individual markdown notes under `docs/tasks/`. The notes are inconsistent in depth: some are single-sentence prompts, some contain bullets, and some are fuller design notes. The repository also already has live GitHub issue usage, so backlog management should move there rather than continue to split between disk and GitHub.

This design solves two linked problems:

1. **Reusable intake**: define a small issue-template set that fits current backlog items and remains useful for future issue creation.
2. **Safe migration**: move each selected task file into a GitHub issue without leaving the same backlog item both on disk and half-migrated in GitHub.

The migration set is every markdown file directly under `docs/tasks/` except:

- `index.md`
- `mcpwritetools.md`
- `renaminganddeletion.md`

## 2. Design principles

- **Small template set**: prefer a few durable templates over many narrow ones.
- **Partially filled is acceptable**: the migration should preserve intent and context, not force premature refinement.
- **Traceability**: every migrated issue must preserve the original task file path in the body.
- **One-way completion rule**: a task file is deleted only after GitHub issue creation succeeds and the created issue number is captured.
- **Interrupt-safe execution**: process items one at a time so an interrupted run leaves remaining backlog items on disk.

## 3. Issue template set

The repository will define two markdown issue templates under `.github/ISSUE_TEMPLATE/`.

### 3.1 Backlog Item

This is the default template and covers the entire migration set.

Sections:

- `Summary`
- `Outcome`
- `Notes`
- `Source context`

It is intentionally lean so the backlog can be migrated quickly and refined later without forcing early structure. Product work, research, and workflow/process work all use this same template.

### 3.2 Bug / Regression

This template is included for future use because the repository already uses GitHub issues for bug tracking, but it is not expected to cover most items in this migration set.

Sections:

- `Observed behavior`
- `Expected behavior`
- `Reproduction`
- `Impact`
- `Evidence`
- `Suspected scope`
- `Source context`

## 4. Template implementation shape

Templates will use markdown issue-template files rather than GitHub issue forms.

Reasons:

- they are simple to maintain in-repo;
- they work cleanly with `gh issue create`;
- they allow the migration script to prefill issue bodies without needing to satisfy form-schema rules;
- they stay flexible while the backlog is still being normalized.

The repository will also include `.github/ISSUE_TEMPLATE/config.yml` to disable blank issues or, if preferred, to at least direct users toward the defined templates. The migration implementation can decide whether blank issues remain enabled, but the default should bias toward templates.

## 5. Template metadata and labels

Each template will provide:

- a stable template name;
- a short `about` description;
- default labels aligned to the template type.

Recommended defaults:

- `Backlog Item` -> `enhancement`
- `Bug / Regression` -> `bug`

If a label does not yet exist in the repository, the migration flow must create it before first use or fall back to unlabeled issue creation. Label setup is secondary to successful migration.

## 6. Migration mapping rules

Migration should classify each selected task file into exactly one template type using simple, explicit rules. The purpose is consistency and speed, not fine-grained taxonomy.

### 6.1 Default rule

Use `Backlog Item` for every selected migration file unless it is an actual bug report.

### 6.2 Bug rule

Use `Bug / Regression` only when the source note is clearly describing broken existing behavior, expected behavior, and some form of reproduction or impact.

For this migration set, the expected outcome is that every selected `docs/tasks/*.md` file maps to `Backlog Item`.

## 7. Issue body generation

Each migrated issue body will be generated from the matching template shape and prefilled with whatever is available from the task note.

Generation rules:

- The issue title comes from a normalized title derived from the file name or leading heading/sentence.
- The raw markdown note content is preserved in a structured section, not discarded.
- Sparse files may leave sections as placeholder prompts; this is acceptable.
- Every issue body includes `Source context` with the original path, for example `docs/tasks/dashboard.md`.

For richer notes such as `openapi-gaps.md`, the migration should preserve the original sections as supporting detail inside the generated body rather than collapsing them into a one-line summary.

## 8. GitHub creation flow

Migration is executed through `gh` against `atolis-hq/corum`.

Per-item flow:

1. Read one source file from `docs/tasks/`.
2. Classify it into one template type.
3. Generate a temporary issue body matching that template.
4. Run `gh issue create` with the generated title, body, and template-aligned labels.
5. Capture the created issue number and URL from command output.
6. Delete the source task file from disk.
7. Record the migration in a local verification artifact or console output for the run.

The key invariant is step ordering: **source deletion happens only after successful GitHub issue creation**.

## 9. Interrupt safety and failure handling

The user requirement is strict: if the migration stops at any point, issues that already exist in GitHub must no longer remain as backlog files on disk.

The design therefore uses **serial, one-file-at-a-time migration** instead of bulk generation followed by bulk deletion.

Rules:

- Never create issues for multiple files and postpone deletion until the end.
- If issue creation fails for a file, stop immediately and leave that source file untouched.
- If issue creation succeeds but source deletion fails, treat that as a high-severity inconsistency and resolve it before continuing.
- Re-runs must skip excluded files and already-deleted files naturally, so recovery is straightforward.

This gives the desired invariant:

- completed migration item -> GitHub issue exists, source file removed;
- unprocessed migration item -> source file still exists, no new issue created by this run.

## 10. Relationship to existing issue `#59`

The repository already has open issue `#59` titled `Configure issue templates`. This migration work should not create a duplicate issue for template configuration itself. Instead, the implementation should treat the actual template files in `.github/ISSUE_TEMPLATE/` as the direct completion of that need while separately migrating the backlog notes.

No automatic closure behavior is required by this design, but the implementation should at minimum avoid creating another issue for the same template-setup work.

## 11. Testing and verification

The implementation must verify both repository changes and GitHub side effects.

Minimum verification:

- confirm template files exist and are readable under `.github/ISSUE_TEMPLATE/`;
- confirm each selected task file creates exactly one GitHub issue;
- confirm each successfully created issue's title/body includes the expected source context;
- confirm each successfully created issue's source task file is deleted;
- confirm excluded files remain untouched:
  - `docs/tasks/index.md`
  - `docs/tasks/mcpwritetools.md`
  - `docs/tasks/renaminganddeletion.md`

Practical verification can include:

- `gh issue view <number>`
- `git diff -- .github docs/tasks`
- a final file listing of `docs/tasks/`

## 12. Future work

- Add richer label routing such as `area:web`, `area:mcp`, or `priority:*`.
- Add automated deduplication checks against existing GitHub issues by title similarity.
- Upgrade markdown templates to issue forms if stronger field enforcement becomes valuable after backlog normalization.
- Add a follow-up refinement workflow that moves migrated issues to a "ready" state.
