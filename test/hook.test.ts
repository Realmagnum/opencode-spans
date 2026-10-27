import test from "node:test"
import assert from "node:assert/strict"
import { handlePrompt, type HookDeps, type PromptEventLike } from "../src/core/hook.ts"
import { hashText } from "../src/core/hash.ts"
import { buildBlock } from "../src/core/prompt.ts"
import { emptyRecord, type SpanRecord } from "../src/core/types.ts"

const REPLY = { id: "m1", type: "assistant", time: { created: 1 }, content: [{ type: "text", text: "the answer is 42" }] }

function state(record: SpanRecord | null, replies: readonly unknown[] = [REPLY]) {
  const store = new Map<string, SpanRecord>()
  if (record) store.set("s1", record)
  const deps: HookDeps = {
    read: async (id) => store.get(id) ?? null,
    write: async (id, next) => void store.set(id, next),
    remove: async (id) => void store.delete(id),
    replies: async () => replies,
  }
  return { deps, store }
}

function recordWith(overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {
    ...emptyRecord(),
    items: [
      {
        id: "a1",
        span: "42",
        comment: "why 42?",
        messageID: "m1",
        messageHash: hashText("the answer is 42"),
        responseIndex: 1,
        createdAt: 1,
      },
    ],
    ...overrides,
  }
}

function event(overrides: Partial<PromptEventLike> = {}): PromptEventLike {
  return { sessionID: "s1", prompt: { text: "and then?" }, ...overrides }
}

test("attaches annotations, shifts mention offsets, and marks the record consumed", async () => {
  const { deps, store } = state(recordWith())
  const draft = "@reviewer look at @src/main.ts"
  const prompt = {
    text: draft,
    files: [{ mention: { start: 23, end: 35, text: "@src/main.ts" } }],
    agents: [{ mention: { start: 0, end: 10, text: "@reviewer" } }],
  }
  const target = event({ prompt })

  await handlePrompt(deps, target)

  const delta = target.prompt.text.length - draft.length
  assert.ok(delta > 0)
  assert.equal(target.prompt.text, `${buildBlock(recordWith().items)}\n\n${draft}`)
  assert.equal(prompt.files[0]?.mention?.start, 23 + delta)
  assert.equal(prompt.files[0]?.mention?.end, 35 + delta)
  assert.equal(prompt.agents[0]?.mention?.start, 0 + delta)
  assert.equal(target.metadata?.spans, "attached")
  assert.equal(target.metadata?.spansCount, 1)
  assert.equal(store.get("s1")?.consumed, true)
})

test("quotes the exact source text, markdown included", async () => {
  const replies = [
    { id: "m1", type: "assistant", time: { created: 1 }, content: [{ type: "text", text: "Use **this** instead" }] },
  ]
  const record = recordWith({
    items: [
      {
        id: "a1",
        span: "**this**",
        comment: "why bold?",
        messageID: "m1",
        messageHash: hashText("Use **this** instead"),
        responseIndex: 1,
        createdAt: 1,
      },
    ],
  })
  const { deps } = state(record, replies)
  const target = event()
  await handlePrompt(deps, target)
  assert.match(target.prompt.text, /^> \*\*this\*\*$/m)
})

test("does not attach and explains why when the reply changed", async () => {
  const replies = [
    { id: "m1", type: "assistant", time: { created: 1 }, content: [{ type: "text", text: "the answer is 43" }] },
  ]
  const { deps, store } = state(recordWith(), replies)
  const target = event()
  const before = target.prompt.text

  await handlePrompt(deps, target)

  assert.equal(target.prompt.text, before)
  assert.equal(store.get("s1")?.invalidReason, "the annotated reply changed after these annotations were staged")
  assert.equal(store.get("s1")?.consumed, false)
})

test("does not attach when the annotated reply disappeared", async () => {
  const { deps, store } = state(recordWith(), [])
  const target = event()
  await handlePrompt(deps, target)
  assert.equal(target.prompt.text, "and then?")
  assert.equal(store.get("s1")?.invalidReason, "the annotated reply no longer exists in this session")
})

test("an already-consumed record never attaches twice and is cleaned up", async () => {
  const { deps, store } = state(recordWith({ consumed: true }))
  const target = event()
  await handlePrompt(deps, target)
  assert.equal(target.prompt.text, "and then?")
  assert.equal(store.has("s1"), false)
})

test("a prompt the plugin itself built is left untouched", async () => {
  const { deps } = state(recordWith())
  const target = event({ metadata: { spans: "sent" } })
  await handlePrompt(deps, target)
  assert.equal(target.prompt.text, "and then?")
})

test("detection is metadata-based, so a user draft that looks like the block still gets annotations", async () => {
  const { deps } = state(recordWith())
  const draft = "The user annotated parts of your earlier replies. Every item below quotes the exact text"
  const target = event({ prompt: { text: draft } })
  await handlePrompt(deps, target)
  assert.ok(target.prompt.text.includes(buildBlock(recordWith().items)))
  assert.ok(target.prompt.text.endsWith(draft))
})

test("no staged record means the prompt is untouched", async () => {
  const { deps } = state(null)
  const target = event()
  await handlePrompt(deps, target)
  assert.equal(target.prompt.text, "and then?")
  assert.equal(target.metadata, undefined)
})

test("an invalid record is left alone without re-writing it", async () => {
  const { deps, store } = state(recordWith({ invalidReason: "gone" }))
  const target = event()
  await handlePrompt(deps, target)
  assert.equal(target.prompt.text, "and then?")
  assert.equal(store.get("s1")?.invalidReason, "gone")
})

test("annotations across several replies are validated per message", async () => {
  const replies = [
    { id: "m1", type: "assistant", time: { created: 1 }, content: [{ type: "text", text: "first" }] },
    { id: "m2", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "second" }] },
  ]
  const record = recordWith({
    items: [
      { id: "a1", span: "first", comment: "one", messageID: "m1", messageHash: hashText("first"), responseIndex: 1, createdAt: 1 },
      { id: "a2", span: "second", comment: "two", messageID: "m2", messageHash: hashText("second"), responseIndex: 2, createdAt: 2 },
    ],
  })
  const { deps } = state(record, replies)
  const target = event()
  await handlePrompt(deps, target)
  assert.match(target.prompt.text, /^> first$/m)
  assert.match(target.prompt.text, /^> second$/m)
  assert.equal(target.metadata?.spansCount, 2)
})
