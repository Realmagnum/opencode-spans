/**
 * Pure selection helpers over `SourceDoc.words`.
 *
 * Mouse drag and keyboard extension both end up producing an anchor/focus pair of word
 * indices; everything else (quoting, highlighting) is derived from the normalised range.
 */
import type { SourceDoc } from "./source.ts"

export interface WordRange {
  lo: number
  hi: number
}

export function normalizeRange(anchor: number, focus: number): WordRange {
  return { lo: Math.min(anchor, focus), hi: Math.max(anchor, focus) }
}

export function inRange(range: WordRange | null, index: number): boolean {
  return range !== null && index >= range.lo && index <= range.hi
}

/** Move by whole words, clamped to the document. */
export function stepWord(doc: SourceDoc, index: number, direction: -1 | 1, count = 1): number {
  if (doc.words.length === 0) return 0
  const next = index + direction * count
  return Math.max(0, Math.min(doc.words.length - 1, next))
}

/**
 * Move to the nearest word on an adjacent non-empty line, keeping the column when the
 * target line has enough words.
 */
export function stepLine(doc: SourceDoc, index: number, direction: -1 | 1, count = 1): number {
  const word = doc.words[index]
  if (!word) return 0

  let target = word.line + direction * count
  while (target >= 0 && target < doc.lineCount) {
    const ids = doc.lineWords[target]
    if (ids && ids.length > 0) {
      const sameColumn = ids[Math.min(word.lineIndex, ids.length - 1)]
      if (sameColumn !== undefined) return sameColumn
    }
    target += direction
  }
  return index
}

/** First word of the document, or the last one when walking backwards. */
export function edgeWord(doc: SourceDoc, edge: "start" | "end"): number {
  if (doc.words.length === 0) return 0
  return edge === "start" ? 0 : doc.words.length - 1
}

/**
 * Find a case-insensitive phrase in the rendered words.
 *
 * Returns the word range covering the match, so a search can both jump to a reply and
 * preselect the hit.
 */
export function findPhrase(doc: SourceDoc, phrase: string, fromWord = 0): WordRange | null {
  const needle = phrase.trim().toLowerCase()
  if (needle.length === 0 || doc.words.length === 0) return null

  const displays = doc.words.map((word) => word.display)
  const haystack = displays.join(" ").toLowerCase()
  const startChar = doc.words[fromWord] ? displays.slice(0, fromWord).join(" ").length + (fromWord > 0 ? 1 : 0) : 0
  const at = haystack.indexOf(needle, Math.max(0, startChar))
  if (at < 0) return null

  const offsets: number[] = []
  let cursor = 0
  for (const display of displays) {
    offsets.push(cursor)
    cursor += display.length + 1
  }

  let lo = -1
  let hi = -1
  for (let i = 0; i < offsets.length; i++) {
    const from = offsets[i] ?? 0
    const to = from + (displays[i]?.length ?? 0)
    if (lo < 0 && at >= from && at <= to) lo = i
    const end = at + needle.length - 1
    if (end >= from && end <= to) {
      hi = i
      break
    }
  }

  if (lo < 0 || hi < 0) return null
  return { lo, hi }
}
