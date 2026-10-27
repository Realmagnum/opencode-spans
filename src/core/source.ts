/**
 * Turn an assistant reply (markdown) into selectable words while keeping every word's
 * exact byte range in the original text.
 *
 * The panel shows cleaned-up words, but a quote is taken with `source.slice(...)`, so
 * markdown syntax stays intact and the annotation always quotes what the user actually
 * saw in the session, not a flattened rewrite.
 */

export interface SourceWord {
  /** Position in `SourceDoc.words`. */
  index: number
  /** Text shown in the panel: inline markdown removed. */
  display: string
  /** Inclusive character offset in `SourceDoc.source`. */
  start: number
  /** Exclusive character offset in `SourceDoc.source`. */
  end: number
  /** 0-based line number. */
  line: number
  /** Position of the word inside its line. */
  lineIndex: number
}

export interface SourceDoc {
  source: string
  words: SourceWord[]
  lineCount: number
  /** Word indices per line; empty lines have empty arrays. */
  lineWords: number[][]
}

const FENCE = /^ {0,3}(?:```|~~~)/
const BLOCK_PREFIX = /^ {0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/

const INLINE_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^!\[([^\]]*)\]\([^)]*\)$/, 1], // image -> alt
  [/^\[([^\]]*)\]\([^)]*\)$/, 1], // link -> label
  [/^(\*\*|__)(.+)\1$/, 2], // bold
  [/^(\*|_)(.+)\1$/, 2], // italic
  [/^~~(.+)~~$/, 1], // strikethrough
  [/^`(.+)`$/, 1], // inline code
]

/** Remove inline markdown from a single whitespace-delimited token. */
export function stripInline(token: string): string {
  let out = token
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const [pattern, group] of INLINE_RULES) {
      const match = pattern.exec(out)
      const inner = match?.[group]
      if (match && inner !== undefined && inner.length < out.length) {
        out = inner
        changed = true
        break
      }
    }
    if (!changed) break
  }
  return out
}

export function parseSource(source: string): SourceDoc {
  const words: SourceWord[] = []
  const lineWords: number[][] = []
  const lines = source.split("\n")
  let offset = 0
  let inFence = false

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line] ?? ""
    const lineStart = offset
    offset += raw.length + 1
    const indices: number[] = []

    if (FENCE.test(raw)) {
      inFence = !inFence
      lineWords.push(indices)
      continue
    }

    const contentStart = inFence ? 0 : (BLOCK_PREFIX.exec(raw)?.[0].length ?? 0)
    const content = raw.slice(contentStart)
    const pattern = /\S+/g
    let match: RegExpExecArray | null

    while ((match = pattern.exec(content)) !== null) {
      const start = lineStart + contentStart + match.index
      const end = start + match[0].length
      const index = words.length
      words.push({
        index,
        display: stripInline(match[0]),
        start,
        end,
        line,
        lineIndex: indices.length,
      })
      indices.push(index)
    }

    lineWords.push(indices)
  }

  return { source, words, lineCount: lines.length, lineWords }
}

export function emptyDoc(source = ""): SourceDoc {
  return { source, words: [], lineCount: 1, lineWords: [[]] }
}

/** Exact original text covered by the inclusive word range. */
export function spanFor(doc: SourceDoc, lo: number, hi: number): string {
  const first = doc.words[lo]
  const last = doc.words[hi]
  if (!first || !last) return ""
  return doc.source.slice(first.start, last.end)
}

/** Display text of the inclusive word range, single-spaced. */
export function displayFor(doc: SourceDoc, lo: number, hi: number): string {
  return doc.words
    .slice(lo, hi + 1)
    .map((word) => word.display)
    .join(" ")
}
