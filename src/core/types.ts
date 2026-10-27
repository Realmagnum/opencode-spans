/**
 * Serializable shapes shared by the server half, the TUI half, and the RPC contract.
 * Everything here must survive a JSON round-trip through plugin storage.
 */

/** One annotation: an exact span of an assistant reply plus the user's comment. */
export interface SpanAnnotation {
  id: string
  /** Exact source text of the selected span, markdown preserved. */
  span: string
  comment: string
  /** Assistant message the span belongs to. */
  messageID: string
  /** Hash of that message's text at staging time; detects later edits/regenerations. */
  messageHash: string
  /** 1-based position of the reply in the session, for human-readable prompt labels. */
  responseIndex: number
  createdAt: number
}

/**
 * Staged annotations for one session.
 *
 * Flat and JSON-Schema friendly on purpose: the RPC contract validates this shape,
 * so avoid nested unions or nullable fields.
 */
export interface SpanRecord {
  version: 1
  /** Set once the annotations were attached to an admitted prompt. */
  consumed: boolean
  /** Non-empty when the annotations can no longer be trusted; the text explains why. */
  invalidReason: string
  items: SpanAnnotation[]
}

export function emptyRecord(): SpanRecord {
  return { version: 1, consumed: false, invalidReason: "", items: [] }
}

/** Distinct messages referenced by a record. */
export function messageIDs(record: SpanRecord): string[] {
  return [...new Set(record.items.map((item) => item.messageID))]
}
