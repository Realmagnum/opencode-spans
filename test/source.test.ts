import test from "node:test"
import assert from "node:assert/strict"
import { displayFor, parseSource, spanFor, stripInline } from "../src/core/source.ts"

test("stripInline removes wrappers without touching the words", () => {
  assert.equal(stripInline("**bold**"), "bold")
  assert.equal(stripInline("_italic_"), "italic")
  assert.equal(stripInline("~~gone~~"), "gone")
  assert.equal(stripInline("`const x`"), "const x")
  assert.equal(stripInline("[label](https://example.com)"), "label")
  assert.equal(stripInline("![alt](img.png)"), "alt")
  assert.equal(stripInline("plain"), "plain")
  assert.equal(stripInline("a**b**c"), "a**b**c")
})

test("words keep exact source offsets around markdown syntax", () => {
  const source = "## Heading\n\nUse **bold** and a [link](https://x.dev) here."
  const doc = parseSource(source)
  const displays = doc.words.map((word) => word.display)
  assert.deepEqual(displays, ["Heading", "Use", "bold", "and", "a", "link", "here."])

  const bold = doc.words.find((word) => word.display === "bold")
  assert.ok(bold)
  assert.equal(source.slice(bold.start, bold.end), "**bold**")

  const link = doc.words.find((word) => word.display === "link")
  assert.ok(link)
  assert.equal(source.slice(link.start, link.end), "[link](https://x.dev)")
})

test("spanFor returns the original markdown, not the flattened text", () => {
  const source = "Try **this** now"
  const doc = parseSource(source)
  const span = spanFor(doc, 1, 1)
  assert.equal(span, "**this**")
  assert.equal(displayFor(doc, 1, 1), "this")
})

test("multi-line spans keep the newline and the original indentation", () => {
  const source = "first line\n  second **line**"
  const doc = parseSource(source)
  const span = spanFor(doc, 0, doc.words.length - 1)
  assert.equal(span, "first line\n  second **line**")
})

test("fenced code keeps backticks and hashes as literal text", () => {
  const source = ["```ts", "const x = 1 # not a heading", "```", "", "# real heading"].join("\n")
  const doc = parseSource(source)
  const displays = doc.words.map((word) => word.display)
  assert.ok(displays.includes("#"))
  assert.ok(displays.includes("const"))
  assert.ok(displays.includes("heading"))
  const hashWord = doc.words.find((word) => word.display === "#")
  assert.ok(hashWord)
  assert.equal(source.slice(hashWord.start, hashWord.end), "#")
})

test("empty input yields an empty document", () => {
  const doc = parseSource("")
  assert.equal(doc.words.length, 0)
  assert.equal(spanFor(doc, 0, 0), "")
})
