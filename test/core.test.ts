import test from "node:test"
import assert from "node:assert/strict"
import { assistantReplies, findReply } from "../src/core/messages.ts"
import { hashText } from "../src/core/hash.ts"
import { emptyRecord, messageIDs } from "../src/core/types.ts"
import { parseRecord, parseSessionID } from "../src/core/validate.ts"

const messages = [
  { id: "m1", type: "assistant", time: { created: 3 }, content: [{ type: "text", text: "second" }] },
  { id: "m2", type: "user", time: { created: 1 }, content: [{ type: "text", text: "q" }] },
  { id: "m3", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "first" }] },
  { id: "m4", type: "assistant", time: { created: 4 }, content: [{ type: "reasoning", text: "thinking" }] },
  { id: "m5", type: "assistant", time: { created: 5 }, content: [{ type: "text", text: "part one" }, { type: "text", text: "part two" }] },
]

test("assistantReplies keeps only text-bearing assistant messages, chronologically", () => {
  assert.deepEqual(
    assistantReplies(messages).map((reply) => reply.id),
    ["m3", "m1", "m5"],
  )
})

test("assistantReplies joins text parts and ignores malformed input", () => {
  const replies = assistantReplies([...messages, null, 42, { type: "assistant" }])
  assert.equal(replies.find((reply) => reply.id === "m5")?.text, "part one\npart two")
})

test("findReply resolves by id", () => {
  assert.equal(findReply(messages, "m1")?.text, "second")
  assert.equal(findReply(messages, "nope"), undefined)
})

test("hashText changes when content changes and stays stable otherwise", () => {
  assert.equal(hashText("abc"), hashText("abc"))
  assert.notEqual(hashText("abc"), hashText("abd"))
  assert.notEqual(hashText("abc"), hashText("abc "))
})

test("messageIDs deduplicates the referenced messages", () => {
  const record = emptyRecord()
  record.items = [
    { id: "1", span: "a", comment: "c", messageID: "m1", messageHash: "h", responseIndex: 1, createdAt: 0 },
    { id: "2", span: "b", comment: "c", messageID: "m1", messageHash: "h", responseIndex: 1, createdAt: 1 },
    { id: "3", span: "c", comment: "c", messageID: "m2", messageHash: "h", responseIndex: 2, createdAt: 2 },
  ]
  assert.deepEqual(messageIDs(record), ["m1", "m2"])
})

test("parseRecord rejects malformed shapes and accepts a valid one", () => {
  const valid = {
    version: 1,
    consumed: false,
    invalidReason: "",
    items: [
      { id: "1", span: "a", comment: "c", messageID: "m1", messageHash: "h", responseIndex: 1, createdAt: 0 },
    ],
  }
  assert.deepEqual(parseRecord(valid), valid)

  assert.equal(parseRecord(null), null)
  assert.equal(parseRecord({}), null)
  assert.equal(parseRecord({ ...valid, version: 2 }), null)
  assert.equal(parseRecord({ ...valid, items: [{ ...valid.items[0], span: 5 }] }), null)
  assert.equal(parseRecord({ ...valid, items: "nope" }), null)
  assert.equal(parseRecord({ ...valid, consumed: "no" }), null)
  assert.equal(parseRecord({ ...valid, items: Array.from({ length: 201 }, () => valid.items[0]) }), null)
})

test("parseSessionID accepts reasonable ids only", () => {
  assert.equal(parseSessionID("ses_abc"), "ses_abc")
  assert.equal(parseSessionID(""), null)
  assert.equal(parseSessionID(5), null)
  assert.equal(parseSessionID("x".repeat(201)), null)
})
