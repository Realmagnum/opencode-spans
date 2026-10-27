import test from "node:test"
import assert from "node:assert/strict"
import { parseSource } from "../src/core/source.ts"
import { edgeWord, findPhrase, inRange, normalizeRange, stepLine, stepWord } from "../src/core/selection.ts"

const doc = parseSource("alpha beta gamma\ndelta epsilon\n\nzeta eta theta")

test("normalizeRange sorts the anchor and focus", () => {
  assert.deepEqual(normalizeRange(5, 2), { lo: 2, hi: 5 })
  assert.deepEqual(normalizeRange(2, 5), { lo: 2, hi: 5 })
})

test("inRange covers the inclusive bounds", () => {
  assert.equal(inRange({ lo: 1, hi: 3 }, 0), false)
  assert.equal(inRange({ lo: 1, hi: 3 }, 1), true)
  assert.equal(inRange({ lo: 1, hi: 3 }, 3), true)
  assert.equal(inRange({ lo: 1, hi: 3 }, 4), false)
  assert.equal(inRange(null, 1), false)
})

test("stepWord clamps at both ends", () => {
  assert.equal(stepWord(doc, 0, -1), 0)
  assert.equal(stepWord(doc, 1, 1), 2)
  assert.equal(stepWord(doc, doc.words.length - 1, 1), doc.words.length - 1)
  assert.equal(stepWord(doc, 0, 1, 2), 2)
})

test("stepLine keeps the column and skips empty lines", () => {
  // "gamma" is word 2, line 0, column 2. Line 1 has only two words.
  assert.equal(stepLine(doc, 2, 1), 4)
  // Walking down from line 1 skips the empty line and lands on line 2.
  assert.equal(stepLine(doc, 4, 1), 6)
  assert.equal(stepLine(doc, 6, -1), 4)
  assert.equal(stepLine(doc, 0, -1), 0)
})

test("edgeWord points at the first and last word", () => {
  assert.equal(edgeWord(doc, "start"), 0)
  assert.equal(edgeWord(doc, "end"), doc.words.length - 1)
})

test("findPhrase is case-insensitive and returns the covering words", () => {
  assert.deepEqual(findPhrase(doc, "EPSILON zeta"), { lo: 4, hi: 5 })
  assert.deepEqual(findPhrase(doc, "theta"), { lo: 7, hi: 7 })
  assert.equal(findPhrase(doc, "missing"), null)
  assert.equal(findPhrase(doc, "   "), null)
})

test("findPhrase can resume from a word index", () => {
  const repeated = parseSource("match one match two match")
  const first = findPhrase(repeated, "match")
  assert.deepEqual(first, { lo: 0, hi: 0 })
  const second = findPhrase(repeated, "match", 1)
  assert.deepEqual(second, { lo: 2, hi: 2 })
})
