/**
 * Structural extraction of assistant replies from message arrays.
 *
 * Deliberately accepts `unknown`: the same helper runs over the server's session context
 * and the TUI's message cache, and both are external data that must be narrowed at runtime.
 */

export interface Reply {
  id: string
  text: string
  created: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type !== "text") continue
    if (typeof part.text === "string") parts.push(part.text)
  }
  return parts.join("\n").trim()
}

/** Chronological, text-bearing assistant replies only. */
export function assistantReplies(messages: readonly unknown[]): Reply[] {
  const replies: Reply[] = []
  for (const message of messages) {
    if (!isRecord(message)) continue
    if (message.type !== "assistant") continue
    const id = typeof message.id === "string" ? message.id : ""
    if (!id) continue
    const text = textOf(message.content)
    if (text.length === 0) continue
    const time = isRecord(message.time) ? message.time.created : undefined
    replies.push({ id, text, created: typeof time === "number" ? time : 0 })
  }

  return replies.sort((a, b) => {
    if (a.created !== b.created) return a.created - b.created
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function findReply(messages: readonly unknown[], id: string): Reply | undefined {
  return assistantReplies(messages).find((reply) => reply.id === id)
}
