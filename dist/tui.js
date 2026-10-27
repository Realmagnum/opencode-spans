// src/tui.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { Plugin, usePlugin } from "@opencode/plugin/tui";

// src/core/prompt.ts
var INTRO = "The user annotated parts of your earlier replies. Every item below quotes the exact text the user selected, followed by their comment. Address each item.";
function quoteLines(span) {
  return span.split(/\r?\n/).map((line) => line.length > 0 ? `> ${line}` : ">").join("\n");
}
function buildBlock(items) {
  const sections = items.map((item, index) => {
    const label = item.responseIndex > 0 ? `reply #${item.responseIndex}` : "earlier reply";
    const lines = [`### ${index + 1}. ${label} (message ${item.messageID})`, "", quoteLines(item.span), ""];
    lines.push(`**Comment:** ${item.comment}`);
    return lines.join("\n");
  });
  return [INTRO, "", ...sections.map((section) => `${section}
`)].join("\n").trimEnd();
}

// src/core/hash.ts
function hashText(text) {
  let a = 2166136261;
  let b = 16777619;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b + code, 2246822507) ^ b >>> 13;
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${text.length}`;
}

// src/core/messages.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function textOf(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type !== "text") continue;
    if (typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n").trim();
}
function assistantReplies(messages) {
  const replies = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (message.type !== "assistant") continue;
    const id = typeof message.id === "string" ? message.id : "";
    if (!id) continue;
    const text = textOf(message.content);
    if (text.length === 0) continue;
    const time = isRecord(message.time) ? message.time.created : void 0;
    replies.push({ id, text, created: typeof time === "number" ? time : 0 });
  }
  return replies.sort((a, b) => {
    if (a.created !== b.created) return a.created - b.created;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// src/core/source.ts
var FENCE = /^ {0,3}(?:```|~~~)/;
var BLOCK_PREFIX = /^ {0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/;
var INLINE_RULES = [
  [/^!\[([^\]]*)\]\([^)]*\)$/, 1],
  // image -> alt
  [/^\[([^\]]*)\]\([^)]*\)$/, 1],
  // link -> label
  [/^(\*\*|__)(.+)\1$/, 2],
  // bold
  [/^(\*|_)(.+)\1$/, 2],
  // italic
  [/^~~(.+)~~$/, 1],
  // strikethrough
  [/^`(.+)`$/, 1]
  // inline code
];
function stripInline(token) {
  let out = token;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const [pattern, group] of INLINE_RULES) {
      const match = pattern.exec(out);
      const inner = match?.[group];
      if (match && inner !== void 0 && inner.length < out.length) {
        out = inner;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return out;
}
function parseSource(source) {
  const words = [];
  const lineWords = [];
  const lines = source.split("\n");
  let offset = 0;
  let inFence = false;
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line] ?? "";
    const lineStart = offset;
    offset += raw.length + 1;
    const indices = [];
    if (FENCE.test(raw)) {
      inFence = !inFence;
      lineWords.push(indices);
      continue;
    }
    const contentStart = inFence ? 0 : BLOCK_PREFIX.exec(raw)?.[0].length ?? 0;
    const content = raw.slice(contentStart);
    const pattern = /\S+/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const start = lineStart + contentStart + match.index;
      const end = start + match[0].length;
      const index = words.length;
      words.push({
        index,
        display: stripInline(match[0]),
        start,
        end,
        line,
        lineIndex: indices.length
      });
      indices.push(index);
    }
    lineWords.push(indices);
  }
  return { source, words, lineCount: lines.length, lineWords };
}
function spanFor(doc, lo, hi) {
  const first = doc.words[lo];
  const last = doc.words[hi];
  if (!first || !last) return "";
  return doc.source.slice(first.start, last.end);
}
function displayFor(doc, lo, hi) {
  return doc.words.slice(lo, hi + 1).map((word) => word.display).join(" ");
}

// src/core/selection.ts
function normalizeRange(anchor, focus) {
  return { lo: Math.min(anchor, focus), hi: Math.max(anchor, focus) };
}
function inRange(range, index) {
  return range !== null && index >= range.lo && index <= range.hi;
}
function stepWord(doc, index, direction, count = 1) {
  if (doc.words.length === 0) return 0;
  const next = index + direction * count;
  return Math.max(0, Math.min(doc.words.length - 1, next));
}
function stepLine(doc, index, direction, count = 1) {
  const word = doc.words[index];
  if (!word) return 0;
  let target = word.line + direction * count;
  while (target >= 0 && target < doc.lineCount) {
    const ids = doc.lineWords[target];
    if (ids && ids.length > 0) {
      const sameColumn = ids[Math.min(word.lineIndex, ids.length - 1)];
      if (sameColumn !== void 0) return sameColumn;
    }
    target += direction;
  }
  return index;
}
function findPhrase(doc, phrase, fromWord = 0) {
  const needle = phrase.trim().toLowerCase();
  if (needle.length === 0 || doc.words.length === 0) return null;
  const displays = doc.words.map((word) => word.display);
  const haystack = displays.join(" ").toLowerCase();
  const startChar = doc.words[fromWord] ? displays.slice(0, fromWord).join(" ").length + (fromWord > 0 ? 1 : 0) : 0;
  const at = haystack.indexOf(needle, Math.max(0, startChar));
  if (at < 0) return null;
  const offsets = [];
  let cursor = 0;
  for (const display of displays) {
    offsets.push(cursor);
    cursor += display.length + 1;
  }
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < offsets.length; i++) {
    const from = offsets[i] ?? 0;
    const to = from + (displays[i]?.length ?? 0);
    if (lo < 0 && at >= from && at <= to) lo = i;
    const end = at + needle.length - 1;
    if (end >= from && end <= to) {
      hi = i;
      break;
    }
  }
  if (lo < 0 || hi < 0) return null;
  return { lo, hi };
}

// src/core/types.ts
function emptyRecord() {
  return { version: 1, consumed: false, invalidReason: "", items: [] };
}

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var annotation = {
  type: "object",
  properties: {
    id: { type: "string" },
    span: { type: "string" },
    comment: { type: "string" },
    messageID: { type: "string" },
    messageHash: { type: "string" },
    responseIndex: { type: "number" },
    createdAt: { type: "number" }
  },
  required: ["id", "span", "comment", "messageID", "messageHash", "responseIndex", "createdAt"],
  additionalProperties: false
};
var record = {
  type: "object",
  properties: {
    version: { type: "number" },
    consumed: { type: "boolean" },
    invalidReason: { type: "string" },
    items: { type: "array", items: annotation }
  },
  required: ["version", "consumed", "invalidReason", "items"],
  additionalProperties: false
};
var sessionID = {
  type: "object",
  properties: { sessionID: { type: "string" } },
  required: ["sessionID"],
  additionalProperties: false
};
var recordResult = {
  type: "object",
  properties: { present: { type: "boolean" }, record },
  required: ["present", "record"],
  additionalProperties: false
};
var SpansRpc = Rpc.define({
  id: "spans",
  methods: {
    /** Read the staged record for a session. */
    snapshot: { input: sessionID, output: recordResult },
    /** Replace the staged record for a session. */
    stage: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, record },
        required: ["sessionID", "record"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, count: { type: "number" } },
        required: ["ok", "count"],
        additionalProperties: false
      }
    },
    /** Discard the staged record for a session. */
    drop: {
      input: sessionID,
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false
      }
    },
    /** Atomically remove and return the staged record, so a send cannot duplicate it. */
    take: { input: sessionID, output: recordResult }
  },
  events: {}
});

// src/tui.tsx
var PANEL = "spans.panel";
var [recordRevision, setRecordRevision] = createSignal(0);
var bumpRecordRevision = () => setRecordRevision((value) => value + 1);
function clip(value, max) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}\u2026` : flat;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function useRecord(context, sessionID2) {
  const rpc = context.client.rpc(SpansRpc);
  const [record2, setRecord] = createSignal(null);
  const [ready, setReady] = createSignal(false);
  const refresh = async () => {
    const id = sessionID2();
    if (!id) return;
    try {
      const result = await rpc.snapshot({
        sessionID: id
      });
      setRecord(result.present ? result.record : null);
    } catch {
    } finally {
      setReady(true);
    }
  };
  const stage = async (next) => {
    const id = sessionID2();
    if (!id) return;
    await rpc.stage({
      sessionID: id,
      record: next
    });
    bumpRecordRevision();
  };
  const drop = async () => {
    const id = sessionID2();
    if (!id) return;
    await rpc.drop({
      sessionID: id
    });
    bumpRecordRevision();
  };
  const take = async () => {
    const id = sessionID2();
    if (!id) return null;
    const result = await rpc.take({
      sessionID: id
    });
    bumpRecordRevision();
    return result.present ? result.record : null;
  };
  createEffect(() => {
    sessionID2();
    recordRevision();
    void refresh();
  });
  let off;
  try {
    off = context.data.on("session.inbox.enqueued", (event) => {
      const id = isRecord2(event) && isRecord2(event.data) ? event.data.sessionID : void 0;
      if (typeof id === "string" && id === sessionID2()) void refresh();
    });
  } catch {
    off = void 0;
  }
  onCleanup(() => off?.());
  return {
    record: record2,
    ready,
    refresh,
    stage,
    drop,
    take,
    rpc
  };
}
function useStaleRecord(context, sessionID2, record2) {
  return createMemo(() => {
    const current = record2();
    if (!current || current.items.length === 0) return "";
    const replies = new Map(assistantReplies(context.data.session.message.list(sessionID2()) ?? []).map((reply) => [reply.id, reply]));
    for (const item of current.items) {
      const reply = replies.get(item.messageID);
      if (!reply) return "the annotated reply is no longer in view";
      if (hashText(reply.text) !== item.messageHash) return "the annotated reply changed \u2014 the comment no longer matches the text";
    }
    return "";
  });
}
function upsertItem(record2, item) {
  const base = record2 ?? emptyRecord();
  return {
    version: 1,
    consumed: false,
    invalidReason: "",
    items: [...base.items, item]
  };
}
function replaceItem(record2, index, item) {
  const base = record2 ?? emptyRecord();
  const items = base.items.map((existing, at) => at === index ? item : existing);
  return {
    version: 1,
    consumed: false,
    invalidReason: "",
    items
  };
}
function removeItem(record2, index) {
  const base = record2 ?? emptyRecord();
  return {
    version: 1,
    consumed: false,
    invalidReason: "",
    items: base.items.filter((_, at) => at !== index)
  };
}
function SpansPanel(props) {
  const context = usePlugin();
  const theme = () => context.theme;
  const {
    record: record2,
    stage,
    drop
  } = useRecord(context, () => props.panel.sessionID);
  const [history, setHistory] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal("");
  const [selectedID, setSelectedID] = createSignal("");
  const [anchor, setAnchor] = createSignal(null);
  const [focus, setFocus] = createSignal(null);
  const [dragging, setDragging] = createSignal(false);
  const [activeItem, setActiveItem] = createSignal(0);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  onMount(async () => {
    try {
      const messages = [];
      let cursor;
      const seen = /* @__PURE__ */ new Set();
      do {
        const page = await context.client.message.list({
          sessionID: props.panel.sessionID,
          limit: 200,
          ...cursor ? {
            cursor
          } : {
            order: "asc"
          }
        });
        if (disposed) return;
        messages.push(...page.data);
        cursor = page.cursor.next ?? void 0;
        if (cursor && seen.has(cursor)) break;
        if (cursor) seen.add(cursor);
      } while (cursor);
      setHistory(messages);
    } catch (error) {
      if (disposed) return;
      setLoadError(String(error));
      context.ui.toast.show({
        title: "Could not load reply history",
        message: `${String(error)}. Reopen /spans to retry.`,
        variant: "error"
      });
    } finally {
      if (!disposed) setLoading(false);
    }
  });
  const replies = createMemo(() => {
    const merged = /* @__PURE__ */ new Map();
    for (const message of history()) {
      if (isRecord2(message) && typeof message.id === "string") merged.set(message.id, message);
    }
    for (const message of context.data.session.message.list(props.panel.sessionID) ?? []) {
      if (isRecord2(message) && typeof message.id === "string") merged.set(message.id, message);
    }
    return assistantReplies([...merged.values()]);
  });
  const index = createMemo(() => {
    const found = replies().findIndex((reply) => reply.id === selectedID());
    return found >= 0 ? found : replies().length - 1;
  });
  const current = createMemo(() => replies()[index()]);
  const doc = createMemo(() => parseSource(current()?.text ?? ""));
  const range = createMemo(() => {
    const from = anchor();
    const to = focus();
    return from === null || to === null ? null : normalizeRange(from, to);
  });
  const selectedSpan = createMemo(() => {
    const currentRange = range();
    return currentRange === null ? "" : spanFor(doc(), currentRange.lo, currentRange.hi);
  });
  const selectedDisplay = createMemo(() => {
    const currentRange = range();
    return currentRange === null ? "" : displayFor(doc(), currentRange.lo, currentRange.hi);
  });
  const items = createMemo(() => record2()?.items ?? []);
  const invalidReason = createMemo(() => record2()?.invalidReason ?? "");
  const stale = useStaleRecord(context, () => props.panel.sessionID, record2);
  createEffect(() => {
    if (activeItem() > items().length - 1) setActiveItem(Math.max(0, items().length - 1));
  });
  const clearSelection = () => {
    setAnchor(null);
    setFocus(null);
    setDragging(false);
  };
  const gotReply = (next) => {
    const list = replies();
    const target = list[Math.max(0, Math.min(list.length - 1, next))];
    if (!target || target.id === current()?.id) return;
    clearSelection();
    wordRefs.clear();
    setSelectedID(target.id);
    scroll?.scrollTo(0);
  };
  const wordRefs = /* @__PURE__ */ new Map();
  const wordAt = (x, y) => {
    for (const [wordIndex, box] of wordRefs) {
      if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) return wordIndex;
    }
    return null;
  };
  const extendTo = (event) => {
    if (!dragging() || !event) return;
    if (typeof event.x !== "number" || typeof event.y !== "number") return;
    const found = wordAt(event.x, event.y);
    if (found !== null) setFocus(found);
  };
  const startSelection = (wordIndex) => {
    setAnchor(wordIndex);
    setFocus(wordIndex);
    setDragging(true);
  };
  const extendBy = (kind, direction) => {
    const document = doc();
    if (document.words.length === 0) return;
    const from = focus() ?? anchor();
    if (from === null) {
      const seed = direction > 0 ? 0 : document.words.length - 1;
      setAnchor(seed);
      setFocus(seed);
      return;
    }
    const next = kind === "word" ? stepWord(document, from, direction) : stepLine(document, from, direction);
    if (focus() === null) setAnchor(from);
    setFocus(next);
  };
  const moveSelectionTo = (found) => {
    setAnchor(found.lo);
    setFocus(found.hi);
  };
  const requireSelection = () => {
    const currentRange = range();
    if (currentRange === null) {
      context.ui.toast.show({
        message: "Select a span first: drag, or shift+arrows.",
        variant: "warning"
      });
      return null;
    }
    return currentRange;
  };
  const addAnnotation = async () => {
    const reply = current();
    if (!reply) {
      context.ui.toast.show({
        message: "No assistant reply to annotate yet.",
        variant: "warning"
      });
      return;
    }
    const currentRange = requireSelection();
    if (currentRange === null) return;
    const span = spanFor(doc(), currentRange.lo, currentRange.hi);
    if (span.length === 0) return;
    const duplicate = items().find((item2) => item2.messageID === reply.id && item2.span === span && item2.comment.length > 0);
    if (duplicate) {
      context.ui.toast.show({
        message: "This span is already annotated.",
        variant: "info"
      });
      return;
    }
    const comment = await context.ui.dialog.prompt({
      title: "Comment on span",
      description: clip(span, 120),
      placeholder: "Your question or comment about this span"
    });
    if (!comment?.trim()) return;
    const item = {
      id: crypto.randomUUID(),
      span,
      comment: comment.trim(),
      messageID: reply.id,
      messageHash: hashText(reply.text),
      responseIndex: index() + 1,
      createdAt: Date.now()
    };
    await stage(upsertItem(record2(), item));
    clearSelection();
  };
  const editActive = async () => {
    const item = items()[activeItem()];
    if (!item) return;
    const comment = await context.ui.dialog.prompt({
      title: `Edit annotation ${activeItem() + 1}`,
      description: clip(item.span, 120),
      placeholder: "Your question or comment about this span",
      value: item.comment
    });
    if (!comment?.trim()) return;
    await stage(replaceItem(record2(), activeItem(), {
      ...item,
      comment: comment.trim()
    }));
  };
  const deleteActive = async () => {
    if (!items()[activeItem()]) return;
    await stage(removeItem(record2(), activeItem()));
  };
  const undoLast = async () => {
    if (items().length === 0) return;
    await stage(removeItem(record2(), items().length - 1));
  };
  const cycleActive = () => {
    if (items().length === 0) return;
    setActiveItem((activeItem() + 1) % items().length);
  };
  const copySelection = async (whole) => {
    const text = whole ? current()?.text ?? "" : selectedSpan();
    if (text.length === 0) {
      context.ui.toast.show({
        message: "Nothing to copy.",
        variant: "warning"
      });
      return;
    }
    const ok = context.renderer.copyToClipboardOSC52(text);
    context.ui.toast.show({
      message: ok ? `Copied ${text.length} characters.` : "Clipboard unavailable in this terminal.",
      variant: ok ? "success" : "warning"
    });
  };
  const search = async () => {
    const query = await context.ui.dialog.prompt({
      title: "Find in replies",
      placeholder: "text to find"
    });
    if (!query?.trim()) return;
    const list = replies();
    if (list.length === 0) return;
    for (let offset = 0; offset < list.length; offset++) {
      const at = (index() + offset) % list.length;
      const reply = list[at];
      if (!reply) continue;
      const found = findPhrase(parseSource(reply.text), query);
      if (!found) continue;
      if (reply.id !== current()?.id) {
        wordRefs.clear();
        setSelectedID(reply.id);
        scroll?.scrollTo(0);
      }
      moveSelectionTo(found);
      return;
    }
    context.ui.toast.show({
      message: `No match for "${query}".`,
      variant: "warning"
    });
  };
  const done = () => {
    clearSelection();
    props.panel.close();
  };
  const discard = async () => {
    if (items().length === 0) {
      clearSelection();
      props.panel.close();
      return;
    }
    const confirmed = await context.ui.dialog.confirm({
      title: "Discard annotations?",
      message: `${items().length} annotation(s) will be removed and not sent.`,
      label: {
        confirm: "Discard",
        cancel: "Keep"
      }
    });
    if (confirmed !== true) return;
    await drop();
    clearSelection();
    props.panel.close();
  };
  let scroll;
  context.keymap.layer(() => ({
    commands: [{
      id: "spans.panel.discard",
      title: "Discard annotations and close",
      bind: "escape",
      run: () => void discard()
    }, {
      id: "spans.panel.done",
      title: "Done (keep staged) and close",
      bind: "return",
      run: done
    }, {
      id: "spans.panel.older",
      title: "Previous reply",
      bind: "up",
      run: () => gotReply(index() - 1)
    }, {
      id: "spans.panel.newer",
      title: "Next reply",
      bind: "down",
      run: () => gotReply(index() + 1)
    }, {
      id: "spans.panel.first",
      title: "First reply",
      bind: "home",
      run: () => gotReply(0)
    }, {
      id: "spans.panel.last",
      title: "Latest reply",
      bind: "end",
      run: () => gotReply(replies().length - 1)
    }, {
      id: "spans.panel.add",
      title: "Annotate selection",
      bind: "a",
      run: () => void addAnnotation()
    }, {
      id: "spans.panel.undo",
      title: "Remove last annotation",
      bind: "u",
      run: () => void undoLast()
    }, {
      id: "spans.panel.next-item",
      title: "Next staged annotation",
      bind: "tab",
      run: cycleActive
    }, {
      id: "spans.panel.edit",
      title: "Edit staged annotation",
      bind: "e",
      run: () => void editActive()
    }, {
      id: "spans.panel.delete",
      title: "Delete staged annotation",
      bind: "d",
      run: () => void deleteActive()
    }, {
      id: "spans.panel.copy-span",
      title: "Copy selected span",
      bind: "y",
      run: () => void copySelection(false)
    }, {
      id: "spans.panel.copy-reply",
      title: "Copy whole reply",
      bind: "shift+y",
      run: () => void copySelection(true)
    }, {
      id: "spans.panel.find",
      title: "Find in replies",
      bind: "/",
      run: () => void search()
    }, {
      id: "spans.panel.wider",
      title: "Extend selection by word",
      bind: "shift+right",
      run: () => extendBy("word", 1)
    }, {
      id: "spans.panel.narrower",
      title: "Shrink selection by word",
      bind: "shift+left",
      run: () => extendBy("word", -1)
    }, {
      id: "spans.panel.down-line",
      title: "Extend selection by line",
      bind: "shift+down",
      run: () => extendBy("line", 1)
    }, {
      id: "spans.panel.up-line",
      title: "Shrink selection by line",
      bind: "shift+up",
      run: () => extendBy("line", -1)
    }, {
      id: "spans.panel.fullscreen",
      title: "Toggle fullscreen",
      bind: "f",
      run: props.panel.toggleFullscreen
    }]
  }));
  const hint = (key, label) => (() => {
    var _el$ = _$createElement("text"), _el$2 = _$createElement("span"), _el$3 = _$createTextNode(` `);
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$setProp(_el$, "selectable", false);
    _$insert(_el$2, key);
    _$insert(_el$, label, null);
    _$effect((_p$) => {
      var _v$ = theme().text.subdued, _v$2 = {
        fg: theme().text.default,
        attributes: TextAttributes.BOLD
      };
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "style", _v$2, _p$.t));
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
  return (() => {
    var _el$4 = _$createElement("box"), _el$5 = _$createElement("box"), _el$6 = _$createElement("box"), _el$7 = _$createElement("text"), _el$9 = _$createElement("text"), _el$0 = _$createElement("box"), _el$1 = _$createElement("scrollbox"), _el$10 = _$createElement("box"), _el$19 = _$createElement("text"), _el$20 = _$createTextNode(`Annotations `), _el$22 = _$createElement("span"), _el$23 = _$createTextNode(`(`), _el$24 = _$createTextNode(`)`);
    _$insertNode(_el$4, _el$5);
    _$insertNode(_el$4, _el$1);
    _$insertNode(_el$4, _el$10);
    _$setProp(_el$4, "flexDirection", "column");
    _$setProp(_el$4, "flexGrow", 1);
    _$setProp(_el$4, "minHeight", 0);
    _$setProp(_el$4, "paddingLeft", 2);
    _$setProp(_el$4, "paddingRight", 2);
    _$setProp(_el$4, "paddingTop", 1);
    _$setProp(_el$4, "onMouseUp", () => setDragging(false));
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$0);
    _$setProp(_el$5, "flexShrink", 0);
    _$setProp(_el$5, "flexDirection", "column");
    _$setProp(_el$5, "paddingBottom", 1);
    _$setProp(_el$5, "border", ["bottom"]);
    _$insertNode(_el$6, _el$7);
    _$insertNode(_el$6, _el$9);
    _$setProp(_el$6, "flexDirection", "row");
    _$setProp(_el$6, "justifyContent", "space-between");
    _$insertNode(_el$7, _$createTextNode(`Spans`));
    _$setProp(_el$7, "selectable", false);
    _$setProp(_el$9, "selectable", false);
    _$insert(_el$9, (() => {
      var _c$ = _$memo(() => !!loading());
      return () => _c$() ? "Loading replies\u2026" : _$memo(() => !!loadError())() ? "History unavailable \u2014 reopen to retry" : _$memo(() => replies().length === 0)() ? "No replies yet" : `Reply ${index() + 1} of ${replies().length}${index() === replies().length - 1 ? " (latest)" : ""}`;
    })());
    _$setProp(_el$0, "flexDirection", "row");
    _$setProp(_el$0, "flexWrap", "wrap");
    _$setProp(_el$0, "columnGap", 2);
    _$setProp(_el$0, "paddingTop", 1);
    _$insert(_el$0, () => hint("drag", "select"), null);
    _$insert(_el$0, () => hint("shift+\u2190/\u2192", "word"), null);
    _$insert(_el$0, () => hint("shift+\u2191/\u2193", "line"), null);
    _$insert(_el$0, () => hint("\u2191/\u2193", "reply"), null);
    _$insert(_el$0, () => hint("a", "annotate"), null);
    _$insert(_el$0, () => hint("tab", "item"), null);
    _$insert(_el$0, () => hint("e/d", "edit/delete"), null);
    _$insert(_el$0, () => hint("y", "copy"), null);
    _$insert(_el$0, () => hint("/", "find"), null);
    _$insert(_el$0, () => hint("enter", "done"), null);
    _$insert(_el$0, () => hint("esc", "discard"), null);
    _$use((el) => {
      scroll = el;
    }, _el$1);
    _$setProp(_el$1, "flexGrow", 1);
    _$setProp(_el$1, "minHeight", 0);
    _$setProp(_el$1, "paddingTop", 1);
    _$setProp(_el$1, "paddingBottom", 1);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return doc().words.length > 0;
      },
      get fallback() {
        return (() => {
          var _el$27 = _$createElement("text");
          _$insertNode(_el$27, _$createTextNode(`No assistant reply in this session yet.`));
          _$setProp(_el$27, "selectable", false);
          _$effect((_$p) => _$setProp(_el$27, "fg", theme().text.subdued, _$p));
          return _el$27;
        })();
      },
      get children() {
        return _$createComponent(For, {
          get each() {
            return doc().lineWords;
          },
          children: (ids) => _$createComponent(Show, {
            get when() {
              return ids.length > 0;
            },
            get fallback() {
              return (() => {
                var _el$30 = _$createElement("box");
                _$setProp(_el$30, "width", "100%");
                _$setProp(_el$30, "height", 1);
                return _el$30;
              })();
            },
            get children() {
              var _el$29 = _$createElement("box");
              _$setProp(_el$29, "flexDirection", "row");
              _$setProp(_el$29, "flexWrap", "wrap");
              _$insert(_el$29, _$createComponent(For, {
                each: ids,
                children: (wordIndex) => {
                  const word = doc().words[wordIndex];
                  return (() => {
                    var _el$31 = _$createElement("text"), _el$32 = _$createTextNode(` `);
                    _$insertNode(_el$31, _el$32);
                    _$use((el) => {
                      wordRefs.set(wordIndex, el);
                    }, _el$31);
                    _$setProp(_el$31, "selectable", false);
                    _$setProp(_el$31, "onMouseDown", (event) => {
                      event?.preventDefault?.();
                      startSelection(wordIndex);
                    });
                    _$setProp(_el$31, "onMouseDrag", (event) => extendTo(event));
                    _$setProp(_el$31, "onMouseDragEnd", (event) => {
                      extendTo(event);
                      setDragging(false);
                    });
                    _$setProp(_el$31, "onMouseUp", (event) => {
                      extendTo(event);
                      setDragging(false);
                    });
                    _$insert(_el$31, () => word.display, _el$32);
                    _$effect((_p$) => {
                      var _v$12 = inRange(range(), wordIndex) ? theme().text.action.primary.focused : theme().text.default, _v$13 = inRange(range(), wordIndex) ? theme().background.action.primary.focused : void 0;
                      _v$12 !== _p$.e && (_p$.e = _$setProp(_el$31, "fg", _v$12, _p$.e));
                      _v$13 !== _p$.t && (_p$.t = _$setProp(_el$31, "bg", _v$13, _p$.t));
                      return _p$;
                    }, {
                      e: void 0,
                      t: void 0
                    });
                    return _el$31;
                  })();
                }
              }));
              return _el$29;
            }
          })
        });
      }
    }));
    _$insertNode(_el$10, _el$19);
    _$setProp(_el$10, "flexShrink", 0);
    _$setProp(_el$10, "flexDirection", "column");
    _$setProp(_el$10, "paddingTop", 1);
    _$setProp(_el$10, "border", ["top"]);
    _$insert(_el$10, _$createComponent(Show, {
      get when() {
        return selectedDisplay();
      },
      get children() {
        var _el$11 = _$createElement("box"), _el$12 = _$createElement("text"), _el$14 = _$createElement("text"), _el$15 = _$createTextNode(`\u201C`), _el$16 = _$createTextNode(`\u201D`);
        _$insertNode(_el$11, _el$12);
        _$insertNode(_el$11, _el$14);
        _$setProp(_el$11, "flexDirection", "row");
        _$setProp(_el$11, "gap", 1);
        _$setProp(_el$11, "paddingBottom", 1);
        _$insertNode(_el$12, _$createTextNode(`Selected`));
        _$setProp(_el$12, "selectable", false);
        _$insertNode(_el$14, _el$15);
        _$insertNode(_el$14, _el$16);
        _$setProp(_el$14, "selectable", false);
        _$insert(_el$14, () => clip(selectedDisplay(), 90), _el$16);
        _$effect((_p$) => {
          var _v$3 = theme().text.feedback.info.default, _v$4 = TextAttributes.BOLD, _v$5 = theme().text.feedback.info.default;
          _v$3 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$3, _p$.e));
          _v$4 !== _p$.t && (_p$.t = _$setProp(_el$12, "attributes", _v$4, _p$.t));
          _v$5 !== _p$.a && (_p$.a = _$setProp(_el$14, "fg", _v$5, _p$.a));
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0
        });
        return _el$11;
      }
    }), _el$19);
    _$insert(_el$10, _$createComponent(Show, {
      get when() {
        return invalidReason() || stale();
      },
      get children() {
        var _el$17 = _$createElement("text"), _el$18 = _$createTextNode(`! `);
        _$insertNode(_el$17, _el$18);
        _$setProp(_el$17, "selectable", false);
        _$insert(_el$17, () => invalidReason() || stale(), null);
        _$effect((_$p) => _$setProp(_el$17, "fg", theme().text.feedback.info.default, _$p));
        return _el$17;
      }
    }), _el$19);
    _$insertNode(_el$19, _el$20);
    _$insertNode(_el$19, _el$22);
    _$setProp(_el$19, "selectable", false);
    _$insertNode(_el$22, _el$23);
    _$insertNode(_el$22, _el$24);
    _$insert(_el$22, () => items().length, _el$24);
    _$insert(_el$10, _$createComponent(Show, {
      get when() {
        return items().length === 0;
      },
      get children() {
        var _el$25 = _$createElement("text");
        _$insertNode(_el$25, _$createTextNode(`Select a span, then press a.`));
        _$setProp(_el$25, "selectable", false);
        _$effect((_$p) => _$setProp(_el$25, "fg", theme().text.subdued, _$p));
        return _el$25;
      }
    }), null);
    _$insert(_el$10, _$createComponent(For, {
      get each() {
        return items();
      },
      children: (item, position) => (() => {
        var _el$33 = _$createElement("box"), _el$34 = _$createElement("text"), _el$35 = _$createElement("span"), _el$36 = _$createTextNode(`.`), _el$37 = _$createTextNode(` [reply `), _el$39 = _$createTextNode(`] \u201C`), _el$40 = _$createTextNode(`\u201D`), _el$41 = _$createElement("box"), _el$42 = _$createElement("text"), _el$43 = _$createTextNode(`\u2192 `);
        _$insertNode(_el$33, _el$34);
        _$insertNode(_el$33, _el$41);
        _$setProp(_el$33, "flexDirection", "column");
        _$setProp(_el$33, "paddingTop", 1);
        _$insertNode(_el$34, _el$35);
        _$insertNode(_el$34, _el$37);
        _$insertNode(_el$34, _el$39);
        _$insertNode(_el$34, _el$40);
        _$setProp(_el$34, "selectable", false);
        _$insertNode(_el$35, _el$36);
        _$insert(_el$35, () => position() + 1, _el$36);
        _$insert(_el$34, () => item.responseIndex, _el$39);
        _$insert(_el$34, () => clip(item.span, 60), _el$40);
        _$insertNode(_el$41, _el$42);
        _$setProp(_el$41, "paddingLeft", 3);
        _$insertNode(_el$42, _el$43);
        _$setProp(_el$42, "selectable", false);
        _$insert(_el$42, () => item.comment, null);
        _$effect((_p$) => {
          var _v$14 = theme().text.subdued, _v$15 = {
            fg: position() === activeItem() ? theme().text.action.primary.focused : theme().text.default,
            attributes: TextAttributes.BOLD
          }, _v$16 = theme().text.default;
          _v$14 !== _p$.e && (_p$.e = _$setProp(_el$34, "fg", _v$14, _p$.e));
          _v$15 !== _p$.t && (_p$.t = _$setProp(_el$35, "style", _v$15, _p$.t));
          _v$16 !== _p$.a && (_p$.a = _$setProp(_el$42, "fg", _v$16, _p$.a));
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0
        });
        return _el$33;
      })()
    }), null);
    _$effect((_p$) => {
      var _v$6 = theme().border.default, _v$7 = theme().text.default, _v$8 = TextAttributes.BOLD, _v$9 = theme().text.subdued, _v$0 = theme().border.default, _v$1 = theme().text.default, _v$10 = TextAttributes.BOLD, _v$11 = {
        fg: theme().text.subdued,
        attributes: TextAttributes.NONE
      };
      _v$6 !== _p$.e && (_p$.e = _$setProp(_el$5, "borderColor", _v$6, _p$.e));
      _v$7 !== _p$.t && (_p$.t = _$setProp(_el$7, "fg", _v$7, _p$.t));
      _v$8 !== _p$.a && (_p$.a = _$setProp(_el$7, "attributes", _v$8, _p$.a));
      _v$9 !== _p$.o && (_p$.o = _$setProp(_el$9, "fg", _v$9, _p$.o));
      _v$0 !== _p$.i && (_p$.i = _$setProp(_el$10, "borderColor", _v$0, _p$.i));
      _v$1 !== _p$.n && (_p$.n = _$setProp(_el$19, "fg", _v$1, _p$.n));
      _v$10 !== _p$.s && (_p$.s = _$setProp(_el$19, "attributes", _v$10, _p$.s));
      _v$11 !== _p$.h && (_p$.h = _$setProp(_el$22, "style", _v$11, _p$.h));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0
    });
    return _el$4;
  })();
}
function ComposerStrip(props) {
  const context = usePlugin();
  const theme = () => context.theme;
  const {
    record: record2,
    ready,
    refresh,
    take,
    drop,
    rpc
  } = useRecord(context, () => props.sessionID);
  const [sending, setSending] = createSignal(false);
  const visible = createMemo(() => {
    const current = record2();
    if (!current) return null;
    if (current.consumed) return null;
    return current;
  });
  const items = createMemo(() => visible()?.items ?? []);
  const invalidReason = createMemo(() => record2()?.invalidReason ?? "");
  const stale = useStaleRecord(context, () => props.sessionID, record2);
  const show = createMemo(() => ready() && (items().length > 0 || invalidReason().length > 0));
  const sendOnly = async () => {
    if (sending() || items().length === 0) return;
    setSending(true);
    const taken = await take();
    if (!taken || taken.items.length === 0) {
      setSending(false);
      return;
    }
    try {
      await context.client.session.prompt({
        sessionID: props.sessionID,
        text: buildBlock(taken.items),
        metadata: {
          spans: "sent"
        },
        delivery: "steer"
      });
    } catch (error) {
      await rpc.stage({
        sessionID: props.sessionID,
        record: taken
      });
      await refresh();
      context.ui.toast.show({
        message: `Could not send spans: ${String(error)}`,
        variant: "error"
      });
    } finally {
      setSending(false);
    }
  };
  const clear = async () => {
    if (items().length === 0) return;
    await drop();
  };
  context.keymap.layer(() => ({
    enabled: show,
    commands: [{
      id: "spans.send",
      title: "Send staged spans",
      description: "Send the staged annotations without a composer message",
      group: "Spans",
      palette: true,
      bind: "ctrl+alt+enter",
      enabled: show,
      run: () => void sendOnly()
    }, {
      id: "spans.clear",
      title: "Discard staged spans",
      group: "Spans",
      palette: true,
      bind: "ctrl+alt+backspace",
      enabled: show,
      run: () => void clear()
    }]
  }));
  return _$createComponent(Show, {
    get when() {
      return show();
    },
    get children() {
      var _el$44 = _$createElement("box"), _el$45 = _$createElement("box"), _el$46 = _$createElement("text"), _el$47 = _$createTextNode(` span`), _el$48 = _$createTextNode(` staged`), _el$49 = _$createElement("span"), _el$50 = _$createTextNode(` \u2014 attached to your next message \xB7 ctrl+alt+enter to send now \xB7 ctrl+alt+backspace to clear`);
      _$insertNode(_el$44, _el$45);
      _$setProp(_el$44, "flexDirection", "column");
      _$setProp(_el$44, "marginBottom", 1);
      _$setProp(_el$44, "paddingLeft", 1);
      _$setProp(_el$44, "paddingRight", 1);
      _$setProp(_el$44, "border", ["left"]);
      _$insertNode(_el$45, _el$46);
      _$setProp(_el$45, "flexDirection", "row");
      _$setProp(_el$45, "gap", 1);
      _$insertNode(_el$46, _el$47);
      _$insertNode(_el$46, _el$48);
      _$insertNode(_el$46, _el$49);
      _$setProp(_el$46, "selectable", false);
      _$insert(_el$46, () => items().length, _el$47);
      _$insert(_el$46, () => items().length === 1 ? "" : "s", _el$48);
      _$insertNode(_el$49, _el$50);
      _$insert(_el$44, _$createComponent(Show, {
        get when() {
          return invalidReason() || stale();
        },
        get children() {
          var _el$52 = _$createElement("text"), _el$53 = _$createTextNode(`! `), _el$54 = _$createTextNode(` \u2014 they will not be attached.`);
          _$insertNode(_el$52, _el$53);
          _$insertNode(_el$52, _el$54);
          _$setProp(_el$52, "selectable", false);
          _$insert(_el$52, () => invalidReason() || stale(), _el$54);
          _$effect((_$p) => _$setProp(_el$52, "fg", theme().text.feedback.info.default, _$p));
          return _el$52;
        }
      }), null);
      _$insert(_el$44, _$createComponent(For, {
        get each() {
          return items();
        },
        children: (item, position) => (() => {
          var _el$55 = _$createElement("text"), _el$56 = _$createElement("span"), _el$57 = _$createTextNode(`.`), _el$58 = _$createTextNode(` [reply `), _el$59 = _$createTextNode(`] \u201C`), _el$60 = _$createTextNode(`\u201D `), _el$62 = _$createElement("span"), _el$63 = _$createTextNode(`\u2192 `);
          _$insertNode(_el$55, _el$56);
          _$insertNode(_el$55, _el$58);
          _$insertNode(_el$55, _el$59);
          _$insertNode(_el$55, _el$60);
          _$insertNode(_el$55, _el$62);
          _$setProp(_el$55, "selectable", false);
          _$insertNode(_el$56, _el$57);
          _$insert(_el$56, () => position() + 1, _el$57);
          _$insert(_el$55, () => item.responseIndex, _el$59);
          _$insert(_el$55, () => clip(item.span, 40), _el$60);
          _$insertNode(_el$62, _el$63);
          _$insert(_el$62, () => clip(item.comment, 50), null);
          _$effect((_p$) => {
            var _v$21 = theme().text.subdued, _v$22 = {
              fg: theme().text.default
            }, _v$23 = {
              fg: theme().text.default
            };
            _v$21 !== _p$.e && (_p$.e = _$setProp(_el$55, "fg", _v$21, _p$.e));
            _v$22 !== _p$.t && (_p$.t = _$setProp(_el$56, "style", _v$22, _p$.t));
            _v$23 !== _p$.a && (_p$.a = _$setProp(_el$62, "style", _v$23, _p$.a));
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0
          });
          return _el$55;
        })()
      }), null);
      _$effect((_p$) => {
        var _v$17 = theme().text.feedback.info.default, _v$18 = theme().text.feedback.info.default, _v$19 = TextAttributes.BOLD, _v$20 = {
          fg: theme().text.subdued,
          attributes: TextAttributes.NONE
        };
        _v$17 !== _p$.e && (_p$.e = _$setProp(_el$44, "borderColor", _v$17, _p$.e));
        _v$18 !== _p$.t && (_p$.t = _$setProp(_el$46, "fg", _v$18, _p$.t));
        _v$19 !== _p$.a && (_p$.a = _$setProp(_el$46, "attributes", _v$19, _p$.a));
        _v$20 !== _p$.o && (_p$.o = _$setProp(_el$49, "style", _v$20, _p$.o));
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0,
        o: void 0
      });
      return _el$44;
    }
  });
}
var tui_default = Plugin.define({
  id: "spans.tui",
  setup(context) {
    const offPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => _$createComponent(Show, {
        get when() {
          return panel.name === PANEL;
        },
        get children() {
          return _$createComponent(SpansPanel, {
            panel
          });
        }
      })
    });
    const offStrip = context.ui.slot({
      append: "session.composer.top",
      render: (input) => _$createComponent(ComposerStrip, {
        get sessionID() {
          return input.sessionID;
        }
      })
    });
    const offApp = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "spans.open",
            title: "Annotate replies",
            description: "Select spans of earlier replies and attach comments to your next prompt",
            group: "Spans",
            palette: true,
            slash: {
              name: "spans"
            },
            bind: "ctrl+alt+s",
            run: () => {
              if (!context.ui.panel.open(PANEL)) {
                context.ui.toast.show({
                  message: "Open a session first.",
                  variant: "warning"
                });
              }
            }
          }]
        }));
        return null;
      }
    });
    return () => {
      offPanel();
      offStrip();
      offApp();
    };
  }
});
export {
  tui_default as default
};
