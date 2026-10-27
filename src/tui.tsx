/**
 * TUI half of opencode-spans.
 *
 * Two contributions:
 *  - `session.panel`  — browse replies, select spans, manage staged annotations.
 *  - `session.composer.top` — a strip showing what will be attached to the next prompt.
 *
 * All state lives on the server (see `src/server.ts`); this half only reads snapshots and
 * stages edits through RPC, so a TUI restart or a second window cannot desync it.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { applyAnnotations, buildBlock } from "./core/prompt.ts"
import { hashText } from "./core/hash.ts"
import { assistantReplies, type Reply } from "./core/messages.ts"
import { displayFor, parseSource, spanFor, type SourceDoc, type SourceWord } from "./core/source.ts"
import { findPhrase, inRange, normalizeRange, stepLine, stepWord } from "./core/selection.ts"
import { emptyRecord, type SpanAnnotation, type SpanRecord } from "./core/types.ts"
import { SpansRpc } from "./rpc.ts"

const PANEL = "spans.panel"

type Ctx = ReturnType<typeof usePlugin>

type PanelProps = {
  panel: {
    readonly name: string
    readonly sessionID: string
    readonly close: () => void
    readonly toggleFullscreen: () => void
  }
}

type RecordResult = { present: boolean; record: SpanRecord }

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// ───────────────────────────── server-backed state ─────────────────────────────

function useRecord(context: Ctx, sessionID: () => string) {
  const rpc = context.client.rpc(SpansRpc)
  const [record, setRecord] = createSignal<SpanRecord | null>(null)
  const [ready, setReady] = createSignal(false)

  const refresh = async () => {
    const id = sessionID()
    if (!id) return
    try {
      const result = (await rpc.snapshot({ sessionID: id })) as RecordResult
      setRecord(result.present ? result.record : null)
    } catch {
      // The server half may still be starting; keep the last known state.
    } finally {
      setReady(true)
    }
  }

  const stage = async (next: SpanRecord) => {
    const id = sessionID()
    if (!id) return
    await rpc.stage({ sessionID: id, record: next })
    await refresh()
  }

  const drop = async () => {
    const id = sessionID()
    if (!id) return
    await rpc.drop({ sessionID: id })
    await refresh()
  }

  const take = async (): Promise<SpanRecord | null> => {
    const id = sessionID()
    if (!id) return null
    const result = (await rpc.take({ sessionID: id })) as RecordResult
    await refresh()
    return result.present ? result.record : null
  }

  onMount(() => void refresh())
  createEffect(() => {
    sessionID()
    void refresh()
  })

  // A prompt was admitted: the server may have consumed the staged record.
  let off: (() => void) | undefined
  try {
    off = context.data.on("session.inbox.enqueued", (event) => {
      const id = isRecord(event) && isRecord(event.data) ? event.data.sessionID : undefined
      if (typeof id === "string" && id === sessionID()) void refresh()
    })
  } catch {
    off = undefined
  }
  onCleanup(() => off?.())

  return { record, ready, refresh, stage, drop, take, rpc }
}

/** Live staleness: compare staged hashes against the current message cache. */
function useStaleRecord(context: Ctx, sessionID: () => string, record: () => SpanRecord | null) {
  return createMemo(() => {
    const current = record()
    if (!current || current.items.length === 0) return ""
    const replies = new Map(
      assistantReplies(context.data.session.message.list(sessionID()) ?? []).map((reply) => [reply.id, reply]),
    )
    for (const item of current.items) {
      const reply = replies.get(item.messageID)
      if (!reply) return "the annotated reply is no longer in view"
      if (hashText(reply.text) !== item.messageHash) return "the annotated reply changed — the comment no longer matches the text"
    }
    return ""
  })
}

// ───────────────────────────── annotation editing ─────────────────────────────

function upsertItem(record: SpanRecord | null, item: SpanAnnotation): SpanRecord {
  const base = record ?? emptyRecord()
  return { version: 1, consumed: false, invalidReason: "", items: [...base.items, item] }
}

function replaceItem(record: SpanRecord | null, index: number, item: SpanAnnotation): SpanRecord {
  const base = record ?? emptyRecord()
  const items = base.items.map((existing, at) => (at === index ? item : existing))
  return { version: 1, consumed: false, invalidReason: "", items }
}

function removeItem(record: SpanRecord | null, index: number): SpanRecord {
  const base = record ?? emptyRecord()
  return { version: 1, consumed: false, invalidReason: "", items: base.items.filter((_, at) => at !== index) }
}

// ────────────────────────────────── panel ──────────────────────────────────

function SpansPanel(props: PanelProps) {
  const context = usePlugin()
  const theme = () => context.theme
  const { record, stage, drop } = useRecord(context, () => props.panel.sessionID)

  const [history, setHistory] = createSignal<unknown[]>([])
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal("")
  const [selectedID, setSelectedID] = createSignal("")
  const [anchor, setAnchor] = createSignal<number | null>(null)
  const [focus, setFocus] = createSignal<number | null>(null)
  const [dragging, setDragging] = createSignal(false)
  const [activeItem, setActiveItem] = createSignal(0)

  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  onMount(async () => {
    try {
      const messages: unknown[] = []
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const page = await context.client.message.list({
          sessionID: props.panel.sessionID,
          limit: 200,
          ...(cursor ? { cursor } : { order: "asc" as const }),
        })
        if (disposed) return
        messages.push(...page.data)
        cursor = page.cursor.next ?? undefined
        if (cursor && seen.has(cursor)) break
        if (cursor) seen.add(cursor)
      } while (cursor)
      setHistory(messages)
    } catch (error) {
      if (disposed) return
      setLoadError(String(error))
      context.ui.toast.show({
        title: "Could not load reply history",
        message: `${String(error)}. Reopen /spans to retry.`,
        variant: "error",
      })
    } finally {
      if (!disposed) setLoading(false)
    }
  })

  const replies = createMemo<Reply[]>(() => {
    const merged = new Map<string, unknown>()
    for (const message of history()) {
      if (isRecord(message) && typeof message.id === "string") merged.set(message.id, message)
    }
    for (const message of context.data.session.message.list(props.panel.sessionID) ?? []) {
      if (isRecord(message) && typeof message.id === "string") merged.set(message.id, message)
    }
    return assistantReplies([...merged.values()])
  })

  const index = createMemo(() => {
    const found = replies().findIndex((reply) => reply.id === selectedID())
    return found >= 0 ? found : replies().length - 1
  })

  const current = createMemo<Reply | undefined>(() => replies()[index()])

  const doc = createMemo<SourceDoc>(() => parseSource(current()?.text ?? ""))

  const range = createMemo(() => {
    const from = anchor()
    const to = focus()
    return from === null || to === null ? null : normalizeRange(from, to)
  })

  const selectedSpan = createMemo(() => {
    const currentRange = range()
    return currentRange === null ? "" : spanFor(doc(), currentRange.lo, currentRange.hi)
  })

  const selectedDisplay = createMemo(() => {
    const currentRange = range()
    return currentRange === null ? "" : displayFor(doc(), currentRange.lo, currentRange.hi)
  })

  const items = createMemo(() => record()?.items ?? [])
  const invalidReason = createMemo(() => record()?.invalidReason ?? "")
  const stale = useStaleRecord(context, () => props.panel.sessionID, record)

  createEffect(() => {
    if (activeItem() > items().length - 1) setActiveItem(Math.max(0, items().length - 1))
  })

  const clearSelection = () => {
    setAnchor(null)
    setFocus(null)
    setDragging(false)
  }

  const gotReply = (next: number) => {
    const list = replies()
    const target = list[Math.max(0, Math.min(list.length - 1, next))]
    if (!target || target.id === current()?.id) return
    clearSelection()
    wordRefs.clear()
    setSelectedID(target.id)
    scroll?.scrollTo(0)
  }

  // Mouse selection: OpenTUI routes drag events to the renderable where the press began,
  // so we hit-test the pointer against every word box instead of relying on hover.
  const wordRefs = new Map<number, { x: number; y: number; width: number; height: number }>()
  const wordAt = (x: number, y: number): number | null => {
    for (const [wordIndex, box] of wordRefs) {
      if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) return wordIndex
    }
    return null
  }

  const extendTo = (event: { x?: number; y?: number } | undefined) => {
    if (!dragging() || !event) return
    if (typeof event.x !== "number" || typeof event.y !== "number") return
    const found = wordAt(event.x, event.y)
    if (found !== null) setFocus(found)
  }

  const startSelection = (wordIndex: number) => {
    setAnchor(wordIndex)
    setFocus(wordIndex)
    setDragging(true)
  }

  const extendBy = (kind: "word" | "line", direction: -1 | 1) => {
    const document = doc()
    if (document.words.length === 0) return
    const from = focus() ?? anchor()
    if (from === null) {
      const seed = direction > 0 ? 0 : document.words.length - 1
      setAnchor(seed)
      setFocus(seed)
      return
    }
    const next = kind === "word" ? stepWord(document, from, direction) : stepLine(document, from, direction)
    if (focus() === null) setAnchor(from)
    setFocus(next)
  }

  const moveSelectionTo = (found: { lo: number; hi: number }) => {
    setAnchor(found.lo)
    setFocus(found.hi)
  }

  const requireSelection = (): { lo: number; hi: number } | null => {
    const currentRange = range()
    if (currentRange === null) {
      context.ui.toast.show({ message: "Select a span first: drag, or shift+arrows.", variant: "warning" })
      return null
    }
    return currentRange
  }

  const addAnnotation = async () => {
    const reply = current()
    if (!reply) {
      context.ui.toast.show({ message: "No assistant reply to annotate yet.", variant: "warning" })
      return
    }
    const currentRange = requireSelection()
    if (currentRange === null) return
    const span = spanFor(doc(), currentRange.lo, currentRange.hi)
    if (span.length === 0) return

    const duplicate = items().find(
      (item) => item.messageID === reply.id && item.span === span && item.comment.length > 0,
    )
    if (duplicate) {
      context.ui.toast.show({ message: "This span is already annotated.", variant: "info" })
      return
    }

    const comment = await context.ui.dialog.prompt({
      title: "Comment on span",
      description: clip(span, 120),
      placeholder: "Your question or comment about this span",
    })
    if (!comment?.trim()) return

    const item: SpanAnnotation = {
      id: crypto.randomUUID(),
      span,
      comment: comment.trim(),
      messageID: reply.id,
      messageHash: hashText(reply.text),
      responseIndex: index() + 1,
      createdAt: Date.now(),
    }
    await stage(upsertItem(record(), item))
    clearSelection()
  }

  const editActive = async () => {
    const item = items()[activeItem()]
    if (!item) return
    const comment = await context.ui.dialog.prompt({
      title: `Edit annotation ${activeItem() + 1}`,
      description: clip(item.span, 120),
      placeholder: "Your question or comment about this span",
      value: item.comment,
    })
    if (!comment?.trim()) return
    await stage(replaceItem(record(), activeItem(), { ...item, comment: comment.trim() }))
  }

  const deleteActive = async () => {
    if (!items()[activeItem()]) return
    await stage(removeItem(record(), activeItem()))
  }

  const undoLast = async () => {
    if (items().length === 0) return
    await stage(removeItem(record(), items().length - 1))
  }

  const cycleActive = () => {
    if (items().length === 0) return
    setActiveItem((activeItem() + 1) % items().length)
  }

  const copySelection = async (whole: boolean) => {
    const text = whole ? (current()?.text ?? "") : selectedSpan()
    if (text.length === 0) {
      context.ui.toast.show({ message: "Nothing to copy.", variant: "warning" })
      return
    }
    const ok = context.renderer.copyToClipboardOSC52(text)
    context.ui.toast.show({
      message: ok ? `Copied ${text.length} characters.` : "Clipboard unavailable in this terminal.",
      variant: ok ? "success" : "warning",
    })
  }

  const search = async () => {
    const query = await context.ui.dialog.prompt({
      title: "Find in replies",
      placeholder: "text to find",
    })
    if (!query?.trim()) return
    const list = replies()
    if (list.length === 0) return
    for (let offset = 0; offset < list.length; offset++) {
      const at = (index() + offset) % list.length
      const reply = list[at]
      if (!reply) continue
      const found = findPhrase(parseSource(reply.text), query)
      if (!found) continue
      if (reply.id !== current()?.id) {
        wordRefs.clear()
        setSelectedID(reply.id)
        scroll?.scrollTo(0)
      }
      moveSelectionTo(found)
      return
    }
    context.ui.toast.show({ message: `No match for "${query}".`, variant: "warning" })
  }

  const done = () => {
    clearSelection()
    props.panel.close()
  }

  const discard = async () => {
    if (items().length === 0) {
      clearSelection()
      props.panel.close()
      return
    }
    const confirmed = await context.ui.dialog.confirm({
      title: "Discard annotations?",
      message: `${items().length} annotation(s) will be removed and not sent.`,
      label: { confirm: "Discard", cancel: "Keep" },
    })
    if (confirmed !== true) return
    await drop()
    clearSelection()
    props.panel.close()
  }

  let scroll: { scrollTo: (value: number) => void } | undefined

  context.keymap.layer(() => ({
    commands: [
      { id: "spans.panel.discard", title: "Discard annotations and close", bind: "escape", run: () => void discard() },
      { id: "spans.panel.done", title: "Done (keep staged) and close", bind: "return", run: done },
      { id: "spans.panel.older", title: "Previous reply", bind: "up", run: () => gotReply(index() - 1) },
      { id: "spans.panel.newer", title: "Next reply", bind: "down", run: () => gotReply(index() + 1) },
      { id: "spans.panel.first", title: "First reply", bind: "home", run: () => gotReply(0) },
      { id: "spans.panel.last", title: "Latest reply", bind: "end", run: () => gotReply(replies().length - 1) },
      { id: "spans.panel.add", title: "Annotate selection", bind: "a", run: () => void addAnnotation() },
      { id: "spans.panel.undo", title: "Remove last annotation", bind: "u", run: () => void undoLast() },
      { id: "spans.panel.next-item", title: "Next staged annotation", bind: "tab", run: cycleActive },
      { id: "spans.panel.edit", title: "Edit staged annotation", bind: "e", run: () => void editActive() },
      { id: "spans.panel.delete", title: "Delete staged annotation", bind: "d", run: () => void deleteActive() },
      { id: "spans.panel.copy-span", title: "Copy selected span", bind: "y", run: () => void copySelection(false) },
      { id: "spans.panel.copy-reply", title: "Copy whole reply", bind: "shift+y", run: () => void copySelection(true) },
      { id: "spans.panel.find", title: "Find in replies", bind: "/", run: () => void search() },
      { id: "spans.panel.wider", title: "Extend selection by word", bind: "shift+right", run: () => extendBy("word", 1) },
      { id: "spans.panel.narrower", title: "Shrink selection by word", bind: "shift+left", run: () => extendBy("word", -1) },
      { id: "spans.panel.down-line", title: "Extend selection by line", bind: "shift+down", run: () => extendBy("line", 1) },
      { id: "spans.panel.up-line", title: "Shrink selection by line", bind: "shift+up", run: () => extendBy("line", -1) },
      { id: "spans.panel.fullscreen", title: "Toggle fullscreen", bind: "f", run: props.panel.toggleFullscreen },
    ],
  }))

  const hint = (key: string, label: string) => (
    <text selectable={false} fg={theme().text.subdued}>
      <span style={{ fg: theme().text.default, attributes: TextAttributes.BOLD }}>{key}</span> {label}
    </text>
  )

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      onMouseUp={() => setDragging(false)}
    >
      <box flexShrink={0} flexDirection="column" paddingBottom={1} border={["bottom"]} borderColor={theme().border.default}>
        <box flexDirection="row" justifyContent="space-between">
          <text selectable={false} fg={theme().text.default} attributes={TextAttributes.BOLD}>
            Spans
          </text>
          <text selectable={false} fg={theme().text.subdued}>
            {loading()
              ? "Loading replies…"
              : loadError()
                ? "History unavailable — reopen to retry"
                : replies().length === 0
                  ? "No replies yet"
                  : `Reply ${index() + 1} of ${replies().length}${index() === replies().length - 1 ? " (latest)" : ""}`}
          </text>
        </box>
        <box flexDirection="row" flexWrap="wrap" columnGap={2} paddingTop={1}>
          {hint("drag", "select")}
          {hint("shift+←/→", "word")}
          {hint("shift+↑/↓", "line")}
          {hint("↑/↓", "reply")}
          {hint("a", "annotate")}
          {hint("tab", "item")}
          {hint("e/d", "edit/delete")}
          {hint("y", "copy")}
          {hint("/", "find")}
          {hint("enter", "done")}
          {hint("esc", "discard")}
        </box>
      </box>

      <scrollbox
        ref={(el: unknown) => {
          scroll = el as { scrollTo: (value: number) => void }
        }}
        flexGrow={1}
        minHeight={0}
        paddingTop={1}
        paddingBottom={1}
      >
        <Show
          when={doc().words.length > 0}
          fallback={<text selectable={false} fg={theme().text.subdued}>No assistant reply in this session yet.</text>}
        >
          <For each={doc().lineWords}>
            {(ids) => (
              <Show when={ids.length > 0} fallback={<box width="100%" height={1} />}>
                <box flexDirection="row" flexWrap="wrap">
                  <For each={ids}>
                    {(wordIndex) => {
                      const word = doc().words[wordIndex] as SourceWord
                      return (
                        <text
                          ref={(el: unknown) => {
                            wordRefs.set(wordIndex, el as { x: number; y: number; width: number; height: number })
                          }}
                          selectable={false}
                          fg={inRange(range(), wordIndex) ? theme().text.action.primary.focused : theme().text.default}
                          bg={inRange(range(), wordIndex) ? theme().background.action.primary.focused : undefined}
                          onMouseDown={(event: { preventDefault?: () => void }) => {
                            event?.preventDefault?.()
                            startSelection(wordIndex)
                          }}
                          onMouseDrag={(event: { x?: number; y?: number }) => extendTo(event)}
                          onMouseDragEnd={(event: { x?: number; y?: number }) => {
                            extendTo(event)
                            setDragging(false)
                          }}
                          onMouseUp={(event: { x?: number; y?: number }) => {
                            extendTo(event)
                            setDragging(false)
                          }}
                        >
                          {word.display}{" "}
                        </text>
                      )
                    }}
                  </For>
                </box>
              </Show>
            )}
          </For>
        </Show>
      </scrollbox>

      <box flexShrink={0} flexDirection="column" paddingTop={1} border={["top"]} borderColor={theme().border.default}>
        <Show when={selectedDisplay()}>
          <box flexDirection="row" gap={1} paddingBottom={1}>
            <text selectable={false} fg={theme().text.feedback.info.default} attributes={TextAttributes.BOLD}>
              Selected
            </text>
            <text selectable={false} fg={theme().text.feedback.info.default}>
              “{clip(selectedDisplay(), 90)}”
            </text>
          </box>
        </Show>

        <Show when={invalidReason() || stale()}>
          <text selectable={false} fg={theme().text.feedback.info.default}>
            ! {invalidReason() || stale()}
          </text>
        </Show>

        <text selectable={false} fg={theme().text.default} attributes={TextAttributes.BOLD}>
          Annotations{" "}
          <span style={{ fg: theme().text.subdued, attributes: TextAttributes.NONE }}>({items().length})</span>
        </text>

        <Show when={items().length === 0}>
          <text selectable={false} fg={theme().text.subdued}>Select a span, then press a.</text>
        </Show>

        <For each={items()}>
          {(item, position) => (
            <box flexDirection="column" paddingTop={1}>
              <text selectable={false} fg={theme().text.subdued}>
                <span
                  style={{
                    fg: position() === activeItem() ? theme().text.action.primary.focused : theme().text.default,
                    attributes: TextAttributes.BOLD,
                  }}
                >
                  {position() + 1}.
                </span>{" "}
                [reply {item.responseIndex}] “{clip(item.span, 60)}”
              </text>
              <box paddingLeft={3}>
                <text selectable={false} fg={theme().text.default}>→ {item.comment}</text>
              </box>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

// ─────────────────────────────── composer strip ───────────────────────────────

function ComposerStrip(props: { sessionID: string }) {
  const context = usePlugin()
  const theme = () => context.theme
  const { record, ready, refresh, take, drop, rpc } = useRecord(context, () => props.sessionID)
  const [sending, setSending] = createSignal(false)

  const visible = createMemo(() => {
    const current = record()
    if (!current) return null
    if (current.consumed) return null
    return current
  })
  const items = createMemo(() => visible()?.items ?? [])
  const invalidReason = createMemo(() => record()?.invalidReason ?? "")
  const stale = useStaleRecord(context, () => props.sessionID, record)
  const show = createMemo(() => ready() && (items().length > 0 || invalidReason().length > 0))

  const sendOnly = async () => {
    if (sending() || items().length === 0) return
    setSending(true)
    const taken = await take()
    if (!taken || taken.items.length === 0) {
      setSending(false)
      return
    }
    try {
      await context.client.session.prompt({
        sessionID: props.sessionID,
        text: buildBlock(taken.items),
        metadata: { spans: "sent" },
        delivery: "steer",
      })
    } catch (error) {
      await rpc.stage({ sessionID: props.sessionID, record: taken })
      await refresh()
      context.ui.toast.show({ message: `Could not send spans: ${String(error)}`, variant: "error" })
    } finally {
      setSending(false)
    }
  }

  const clear = async () => {
    if (items().length === 0) return
    await drop()
  }

  context.keymap.layer(() => ({
    enabled: show,
    commands: [
      {
        id: "spans.send",
        title: "Send staged spans",
        description: "Send the staged annotations without a composer message",
        group: "Spans",
        palette: true,
        bind: "ctrl+alt+enter",
        enabled: show,
        run: () => void sendOnly(),
      },
      {
        id: "spans.clear",
        title: "Discard staged spans",
        group: "Spans",
        palette: true,
        bind: "ctrl+alt+backspace",
        enabled: show,
        run: () => void clear(),
      },
    ],
  }))

  return (
    <Show when={show()}>
      <box
        flexDirection="column"
        marginBottom={1}
        paddingLeft={1}
        paddingRight={1}
        border={["left"]}
        borderColor={theme().text.feedback.info.default}
      >
        <box flexDirection="row" gap={1}>
          <text selectable={false} fg={theme().text.feedback.info.default} attributes={TextAttributes.BOLD}>
            {items().length} span{items().length === 1 ? "" : "s"} staged
            <span style={{ fg: theme().text.subdued, attributes: TextAttributes.NONE }}>
              {" "}— attached to your next message · ctrl+alt+enter to send now · ctrl+alt+backspace to clear
            </span>
          </text>
        </box>
        <Show when={invalidReason() || stale()}>
          <text selectable={false} fg={theme().text.feedback.info.default}>
            ! {invalidReason() || stale()} — they will not be attached.
          </text>
        </Show>
        <For each={items()}>
          {(item, position) => (
            <text selectable={false} fg={theme().text.subdued}>
              <span style={{ fg: theme().text.default }}>{position() + 1}.</span> [reply {item.responseIndex}] “
              {clip(item.span, 40)}”{" "}
              <span style={{ fg: theme().text.default }}>→ {clip(item.comment, 50)}</span>
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

// ────────────────────────────────── plugin ──────────────────────────────────

export default Plugin.define({
  id: "spans.tui",
  setup(context) {
    const offPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => <Show when={panel.name === PANEL}>{<SpansPanel panel={panel} />}</Show>,
    })

    const offStrip = context.ui.slot({
      append: "session.composer.top",
      render: (input) => <ComposerStrip sessionID={input.sessionID} />,
    })

    const offApp = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "spans.open",
              title: "Annotate replies",
              description: "Select spans of earlier replies and attach comments to your next prompt",
              group: "Spans",
              palette: true,
              slash: { name: "spans" },
              bind: "ctrl+alt+s",
              run: () => {
                if (!context.ui.panel.open(PANEL)) {
                  context.ui.toast.show({ message: "Open a session first.", variant: "warning" })
                }
              },
            },
          ],
        }))
        return null
      },
    })

    return () => {
      offPanel()
      offStrip()
      offApp()
    }
  },
})
