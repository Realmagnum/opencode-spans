/**
 * Runtime validation for everything crossing the RPC boundary.
 *
 * The RPC contract uses JSON Schema, which types values as `unknown`; these parsers are
 * the single place where untrusted shapes become domain types.
 */
import type { SpanAnnotation, SpanRecord } from "./types.ts"

export const MAX_SPAN_CHARS = 20_000
export const MAX_COMMENT_CHARS = 20_000
export const MAX_ITEMS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function parseSessionID(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (value.length === 0 || value.length > 200) return null
  return value
}

function parseAnnotation(value: unknown): SpanAnnotation | null {
  if (!isRecord(value)) return null
  const id = str(value.id, 200)
  const span = str(value.span, MAX_SPAN_CHARS)
  const comment = str(value.comment, MAX_COMMENT_CHARS)
  const messageID = str(value.messageID, 200)
  const messageHash = str(value.messageHash, 200)
  const responseIndex = num(value.responseIndex)
  const createdAt = num(value.createdAt)
  if (id === null || span === null || comment === null) return null
  if (messageID === null || messageHash === null) return null
  if (responseIndex === null || createdAt === null) return null
  return {
    id,
    span,
    comment,
    messageID,
    messageHash,
    responseIndex,
    createdAt,
  }
}

export function parseRecord(value: unknown): SpanRecord | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS) return null
  if (typeof value.consumed !== "boolean") return null
  const invalidReason = str(value.invalidReason, 500)
  if (invalidReason === null) return null

  const items: SpanAnnotation[] = []
  for (const item of value.items) {
    const parsed = parseAnnotation(item)
    if (parsed === null) return null
    items.push(parsed)
  }

  return { version: 1, consumed: value.consumed, invalidReason, items }
}
