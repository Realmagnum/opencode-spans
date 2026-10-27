---
status: done
created: 2026-10-28T00:00:00Z
updated: 2026-10-28T02:05:00Z
---

# opencode-spans — annotate spans of agent replies

## Goal

Ship a self-contained OpenCode V2 plugin that lets a user select spans of earlier
assistant replies, attach a comment to each span, and have those annotations attached
verbatim to their next prompt — with exact quoting, correct mention-offset handling,
durable server-side state, keyboard-only selection, and edit/delete of staged items.

## Non-goals

- Web/GUI surfaces, plan review, diff annotation, image annotation.
- Multiline comment editor (single-line dialog in v0.1.0).
- Publishing to npm (git install only in v0.1.0).
- Annotating tool output, reasoning parts, or non-assistant messages.
- i18n beyond a single locale-agnostic English prompt format.

## Context

- Host: OpenCode V2, verified locally at `opencode v2.0.29` (`~/.local/bin/opencode`).
- SDK: `@opencode/plugin@2.0.29` (V2). Server part: `Plugin.define({ id, setup })` with
  `ctx.session.hook("prompt")`, `ctx.storage.get/set/remove`, `ctx.rpc.register`.
- TUI part: `@opencode/plugin/tui` with slots `session.panel` and `session.composer.top`,
  `context.ui.dialog`, `context.ui.toast`, `context.ui.panel`, `context.keymap.layer`,
  `context.storage.store/memory`, `context.client`, `context.data`.
- `Prompt.agents[].mention`, `Prompt.files[].mention`, `Prompt.skills[].mention` are
  `{ start, end, text }` character offsets into `prompt.text`; V2 docs state a text
  rewrite must update offsets that no longer match.
- `session.prompt` accepts `metadata` (`Record<string, JsonValue>`) — usable as a
  self-identification channel instead of matching prompt text.
- `renderer.copyToClipboardOSC52(text)` exists in `@opentui/core@0.7.0`.
- Prior art exists (`prestonlogan/opencode2-annotate-plugin`) but has no license, so no
  code is copied; this implementation is written from the SDK typings. Attribution to the
  inspiration is a later, separate change requested by the user.

## Plan

- [x] **S1** Scaffold repository: `package.json`, `tsconfig.json`, MIT `LICENSE`,
      `.gitignore`, `build.mjs` (esbuild + babel-solid for the TUI half).
  - Owner: implementer
  - Evidence: `npm run build` produces `dist/tui.js`
- [x] **S2** Implement pure core: types, prompt builder with mention-offset shifting,
      message hashing, source-exact markdown-to-words mapping, selection helpers.
  - Owner: implementer
  - Evidence: `npm test` green on `test/core.*.test.ts`
- [x] **S3** Implement the RPC contract and server half: durable per-session record,
      `spans` RPC methods, prompt hook that attaches annotations, shifts mention offsets,
      consumes the record, and never silently drops stale spans.
  - Owner: implementer
  - Evidence: `test/server.test.ts` drives the hook with a fake context and asserts
    rewritten text plus shifted mentions
- [x] **S4** Implement the TUI half: panel with mouse + keyboard selection, search/jump,
      edit/delete/undo, copy, fullscreen; composer strip; `/spans` and palette commands.
  - Owner: implementer
  - Evidence: `npm run typecheck` and `npm run build` clean; plugin loads in a local install
- [x] **S5** Wire CI: typecheck, tests, build, and a dist-drift check so the committed
      bundle cannot diverge from source.
  - Owner: implementer
  - Evidence: `.github/workflows/ci.yml` present; local `npm run ci` green
- [x] **S6** Install the plugin into the local OpenCode config and verify it loads without
      errors in a headless session; verify the server half through its RPC.
  - Owner: verifier
  - Evidence: `opencode.log` shows no plugin error; RPC call round-trips
- [x] **S7** Publish the repository on GitHub with README, topics, and a `v0.1.0` tag;
      record results in `Result`.
  - Owner: implementer
  - Evidence: remote URL, pushed `main`, tag `v0.1.0`

## Guardrails

- Do not copy source text from `prestonlogan/opencode2-annotate-plugin`; it has no license.
- Never commit credentials, tokens, or machine-specific paths.
- Do not attach annotations to a reply whose text hash changed after staging.
- Do not mutate `prompt.text` without shifting every present mention offset.
- Do not push to an existing remote other than the new repository created for this task.
- Keep runtime network access at zero: no telemetry, no outbound calls.

## Acceptance criteria

- **AC1** Given a staged annotation on assistant message `m1` and a draft containing an
  `@file` mention When the prompt hook runs Then the mention `start`/`end` are shifted by
  the exact length of the inserted prefix and the quoted span appears verbatim in
  `prompt.text`.
- **AC2** Given a staged annotation whose target reply text changed after staging When the
  prompt hook runs Then `prompt.text` is left unmodified and the record is marked
  `invalid` instead of being deleted.
- **AC3** Given a user draft that begins with the same sentence the plugin uses in its
  prompt prefix When the prompt hook runs Then the plugin still attaches annotations,
  because self-detection uses `metadata`, not text.
- **AC4** Given a markdown reply containing bold text, a link, a code fence, and a list
  When the user selects a span Then the quoted string equals `source.slice(start, end)`
  of the rendered words, with original markdown characters preserved.
- **AC5** Given staged annotations and an empty composer When `spans.send` runs Then the
  RPC reports the record consumed and the next plain prompt is not rewritten again.
- **AC6** Given a fresh install at a local path When OpenCode starts Then the server part
  loads with no error and registers the `spans` RPC.
- **AC7** Given the repository is pushed When CI runs Then typecheck, tests, build, and the
  dist-drift check all pass.

## Result

<!-- Append-only journal. Filled only during /microspec.execute. -->

## Result

- S1 — repository scaffolded; `npm run build` emits `dist/tui.js` (44 KB, esbuild + babel-preset-solid).
- S2 — `npm test` drives 36 assertions across `test/prompt`, `test/source`, `test/selection`, `test/core`, `test/hook`; all pass on Node 22 with `--experimental-strip-types`.
- S3 — `src/core/hook.ts` owns the prompt rule behind an injected dependency surface; `test/hook.test.ts` asserts the exact rewritten prompt, the shifted `files`/`agents` mention offsets, the per-message staleness check, the consumed-once path, and metadata-based self-detection.
- S4 — `src/tui.tsx` typechecks against `@opencode/plugin@2.0.29` and builds; the server half loads from a git install (`loading plugin id=github:Realmagnum/opencode-spans#main entrypoint=.../src/server.ts`) with no error in the log.
- S5 — `.github/workflows/ci.yml` runs typecheck, tests, build, `scripts/check-dist.mjs`, and `git diff --exit-code -- dist`; the run on `main` completed successfully in 21 s.
- S6 — installed through `opencode plugin add github:Realmagnum/opencode-spans`; the server part registers and the log shows no plugin error. Reaching the TUI panel itself needs an interactive session, so `/spans` is verified by typecheck + build, not by an automated keystroke test.
- S7 — https://github.com/Realmagnum/opencode-spans, branch `main`, tag `v0.1.0`, topics set.

Notes:
- `@types/node` in devDependencies made `opencode plugin add` fail inside its bundled npm ("git dep preparation failed") while a plain `npm install` of the same commit succeeded; dropping it and typechecking sources only (tests execute, they are not typechecked) made the git install reproducible. `npm run typecheck` still covers `src/`, both entry shims, and the RPC contract.
- Local directory installs resolve entry files by name at the package root, so `server.ts`, `tui.tsx`, and `rpc.ts` exist as one-line re-export shims next to `src/`.
- Attribution to the plugin that inspired this one is intentionally left out for now, per the user's instruction to add it later.
