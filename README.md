# opencode-spans

Annotate spans of OpenCode agent replies and attach your comments to the next prompt — like a review comment in a document, but for the terminal.

Select a few words from any earlier assistant reply, write what you think about them, and the next message you send carries every annotation as a quoted block. The agent sees exactly the text you selected, with its markdown intact, and answers each comment.

```
      Spans ─────────────────────────────── Reply 3 of 7 (latest)
      drag select · shift+←/→ word · shift+↑/↓ line · ↑/↓ reply
      a annotate · tab item · e/d edit/delete · y copy · / find

      The handler retries the request three times before failing,
      which conflicts with the idempotency guarantee in the spec.
      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
      Selected “retries the request three times”

      Annotations (1)
      1. [reply 3] “retries the request three times”
         → is this still needed after the idempotency change?
```

## Install

Requires OpenCode 2 with the plugin SDK (`@opencode/plugin`). Tested against OpenCode `2.0.29`.

```sh
opencode plugin add github:Realmagnum/opencode-spans
```

Restart OpenCode, then run `/spans` in a session that has at least one assistant reply.

> Some OpenCode 2.0.x builds fail to install a git plugin pinned to a tag or commit
> (`#v0.1.0`) with `git dep preparation failed`, while the same plugin installs from
> `#main`. If you hit that, install `github:Realmagnum/opencode-spans#main`, or run
> `npm install github:Realmagnum/opencode-spans#v0.1.0` inside `~/.config/opencode` and
> add the package name to `plugins`.

### Local development

```sh
git clone https://github.com/Realmagnum/opencode-spans
cd opencode-spans
npm install
npm run build
```

Add the directory to `plugins` in `~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-spans"]
}
```

Local directories are resolved by file name at the package root (`server.ts`, `tui.tsx`,
`rpc.ts`), which is why those three shims exist next to `src/`. Published packages are
resolved through `exports` in `package.json`.

## Use

| Key | Action |
| --- | --- |
| drag | select words with the mouse |
| `shift+←` / `shift+→` | extend the selection by one word |
| `shift+↑` / `shift+↓` | extend the selection by one line |
| `↑` / `↓` | previous / next reply |
| `home` / `end` | first / latest reply |
| `/` | find a phrase in replies and preselect it |
| `a` | annotate the selection |
| `tab` | cycle staged annotations |
| `e` / `d` | edit / delete the highlighted annotation |
| `u` | remove the last annotation |
| `y` | copy the selected span |
| `shift+y` | copy the whole reply |
| `f` | toggle fullscreen |
| `enter` | close, keep annotations staged |
| `esc` | discard (asks first) |

Staged annotations appear in a strip above the composer. They ride along with whatever you
send next.

| Key | Action |
| --- | --- |
| `ctrl+alt+enter` | send the annotations without typing anything |
| `ctrl+alt+backspace` | discard the staged annotations |
| `ctrl+alt+s` | open the panel |

All three are normal plugin commands (`spans.send`, `spans.clear`, `spans.open`), so they can
be rebound under `keybinds` in `cli.json`.

## What gets sent

```text
The user annotated parts of your earlier replies. Every item below quotes the exact text
the user selected, followed by their comment. Address each item.

### 1. reply #3 (message msg_01H…)

> retries the request three times

**Comment:** is this still needed after the idempotency change?

<your draft>
```

The quote is taken with `source.slice(start, end)` over the original message, so `**bold**`,
`` `code` `` and link syntax are preserved instead of being flattened.

## How it works

- **The server owns the state.** Staged annotations live in `ctx.storage`, keyed per session.
  The TUI reads snapshots and stages edits over a typed RPC contract, so a TUI restart, a
  second window, or a remote server cannot desync them.
- **One write into the prompt.** The `prompt` admission hook prepends the annotation block and
  shifts every `files`/`agents`/`skills` mention offset by the inserted length. OpenCode
  documents those offsets as character offsets into `prompt.text`, and a rewrite that ignores
  them silently retargets `@file` and `@agent` mentions.
- **Self-detection by metadata.** Prompts the plugin builds for "send now" carry
  `metadata.spans = "sent"`; the hook recognises them there, never by matching prompt text.
- **Staleness is loud.** Each annotation stores a fingerprint of its reply. If the reply was
  regenerated or edited, the hook leaves your prompt untouched, records why, and the composer
  strip says so — instead of dropping your comments silently.
- **No network, no shell.** The plugin reads storage, calls the OpenCode client, and renders
  the TUI. Nothing else.

## Development

```sh
npm run typecheck   # tsc --noEmit against @opencode/plugin
npm test            # node:test over the pure core
npm run build       # dist/tui.js (esbuild + babel-preset-solid)
npm run ci          # typecheck + tests + build + dist drift check
```

`dist/tui.js` is committed because package installs load a compiled bundle. The dist-drift
check rebuilds it and fails if the committed file differs, so the bundle in a release is
provably the one built from that commit.

## Limits

- Annotations only target assistant text parts, not tool output, reasoning, or diffs.
- The comment field is single-line (`ui.dialog.prompt`).
- Reply history is loaded eagerly, 200 messages per page.
- Mouse hit-testing walks the rendered words; very long replies (thousands of words) are
  noticeably slower to drag than short ones.

## License

MIT
