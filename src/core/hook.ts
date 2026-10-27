/**
 * The prompt-admission rule, with no OpenCode types in sight.
 *
 * Keeping this pure and dependency-injected makes the risky part — rewriting a user
 * prompt and shifting mention offsets — directly testable.
 */
import { applyAnnotations, METADATA_ATTACHED, METADATA_KEY, METADATA_SENT, shiftMentions, type MentionCarrier } from "./prompt.ts"
import { hashText } from "./hash.ts"
import { assistantReplies } from "./messages.ts"
import { messageIDs, type SpanRecord } from "./types.ts"

export interface PromptEventLike {
  sessionID: string
  prompt: { text: string } & MentionCarrier
  metadata?: Record<string, unknown>
}

export interface HookDeps {
  read(sessionID: string): Promise<SpanRecord | null>
  write(sessionID: string, record: SpanRecord): Promise<void>
  remove(sessionID: string): Promise<void>
  /** Raw messages for the session; narrowed with `assistantReplies`. */
  replies(sessionID: string): Promise<readonly unknown[]>
}

function staleReason(record: SpanRecord, replies: readonly unknown[]): string {
  const byID = new Map(assistantReplies(replies).map((reply) => [reply.id, reply]))
  for (const id of messageIDs(record)) {
    const reply = byID.get(id)
    if (!reply) return "the annotated reply no longer exists in this session"
    const item = record.items.find((candidate) => candidate.messageID === id)
    if (!item || hashText(reply.text) !== item.messageHash) {
      return "the annotated reply changed after these annotations were staged"
    }
  }
  return ""
}

/**
 * Attach staged annotations to an admitted prompt, exactly once.
 *
 * Leaves the prompt untouched when an annotation can no longer be trusted, and records
 * why, so the UI can explain it instead of dropping the user's work silently.
 */
export async function handlePrompt(deps: HookDeps, event: PromptEventLike): Promise<void> {
  const metadata = event.metadata
  if (metadata?.[METADATA_KEY] === METADATA_SENT) return

  const record = await deps.read(event.sessionID)
  if (record === null) return

  // Attached to an earlier prompt: the text is part of that prompt now. Drop the copy.
  if (record.consumed) {
    await deps.remove(event.sessionID)
    return
  }

  if (record.items.length === 0 || record.invalidReason.length > 0) return

  const replies = await deps.replies(event.sessionID)
  const reason = staleReason(record, replies)
  if (reason.length > 0) {
    await deps.write(event.sessionID, { ...record, invalidReason: reason })
    return
  }

  const { text, delta } = applyAnnotations(event.prompt.text, record.items)
  event.prompt.text = text
  shiftMentions(event.prompt, delta)
  event.metadata = {
    ...(metadata ?? {}),
    [METADATA_KEY]: METADATA_ATTACHED,
    spansCount: record.items.length,
  }

  await deps.write(event.sessionID, { ...record, consumed: true })
}
