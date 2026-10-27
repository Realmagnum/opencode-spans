import test from "node:test"
import assert from "node:assert/strict"
import { applyAnnotations, buildBlock, countMentions, shiftMentions } from "../src/core/prompt.ts"
import type { SpanAnnotation } from "../src/core/types.ts"

function annotation(overrides: Partial<SpanAnnotation> = {}): SpanAnnotation {
  return {
    id: "a1",
    span: "exact source text",
    comment: "why is this here?",
    messageID: "msg_1",
    messageHash: "h1",
    responseIndex: 2,
    createdAt: 1,
    ...overrides,
  }
}

test("buildBlock quotes each span line-by-line and labels the reply", () => {
  const block = buildBlock([annotation(), annotation({ id: "a2", span: "line one\nline two", comment: "second" })])
  assert.match(block, /### 1\. reply #2 \(message msg_1\)/)
  assert.match(block, /^> exact source text$/m)
  assert.match(block, /^> line one$/m)
  assert.match(block, /^> line two$/m)
  assert.match(block, /\*\*Comment:\*\* why is this here\?/)
})

test("applyAnnotations reports the exact number of inserted characters", () => {
  const draft = "and then what?"
  const result = applyAnnotations(draft, [annotation()])
  assert.ok(result.text.endsWith(draft))
  assert.equal(result.delta, result.text.length - draft.length)
  assert.equal(result.text.length, draft.length + result.delta)
})

test("applyAnnotations without a draft produces the block only", () => {
  const result = applyAnnotations("", [annotation()])
  assert.equal(result.text, buildBlock([annotation()]))
  assert.equal(result.delta, result.text.length)
})

test("mentions shift by the inserted length for files, agents and skills", () => {
  const prompt = {
    files: [{ mention: { start: 0, end: 5, text: "@src/" } }],
    agents: [{ mention: { start: 6, end: 10, text: "@rev" } }],
    skills: [{ mention: { start: 11, end: 15, text: "/doc" } }],
  }
  const draft = "@src/ @rev /doc please review"
  const { delta } = applyAnnotations(draft, [annotation()])
  shiftMentions(prompt, delta)

  assert.equal(prompt.files[0]?.mention?.start, delta)
  assert.equal(prompt.files[0]?.mention?.end, 5 + delta)
  assert.equal(prompt.agents[0]?.mention?.start, 6 + delta)
  assert.equal(prompt.skills[0]?.mention?.start, 11 + delta)
  assert.equal(countMentions(prompt), 3)
})

test("shiftMentions tolerates missing lists and missing mentions", () => {
  const prompt = { files: [{}, { mention: { start: 1, end: 2, text: "x" } }], agents: undefined }
  shiftMentions(prompt, 10)
  assert.equal(prompt.files[1]?.mention?.start, 11)
  assert.equal(countMentions(prompt), 1)
})

test("shiftMentions is a no-op for a zero delta", () => {
  const prompt = { files: [{ mention: { start: 3, end: 4, text: "x" } }] }
  shiftMentions(prompt, 0)
  assert.equal(prompt.files[0]?.mention?.start, 3)
})
