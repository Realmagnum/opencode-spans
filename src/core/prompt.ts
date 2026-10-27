/**
 * Prompt construction and the one rewrite rule the plugin applies to user prompts.
 *
 * Inserted text always goes to the very start of the draft, so every mention offset
 * grows by the inserted length. OpenCode documents mention offsets as character
 * offsets into `prompt.text` and requires a rewrite to keep them valid.
 */
import type { SpanAnnotation } from "./types.ts"

export const INTRO =
  "The user annotated parts of your earlier replies. Every item below quotes the exact text the user selected, followed by their comment. Address each item."

/** Marker value written to `event.metadata.spans`. Lets the hook recognise its own output. */
export const METADATA_KEY = "spans"
export const METADATA_SENT = "sent"
export const METADATA_ATTACHED = "attached"

export interface Mention {
  start: number
  end: number
  text: string
}

export interface MentionCarrier {
  files?: ReadonlyArray<{ mention?: Mention }> | undefined
  agents?: ReadonlyArray<{ mention?: Mention }> | undefined
  skills?: ReadonlyArray<{ mention?: Mention }> | undefined
}

function quoteLines(span: string): string {
  return span
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n")
}

/** Render the annotation block without any user draft. */
export function buildBlock(items: readonly SpanAnnotation[]): string {
  const sections = items.map((item, index) => {
    const label = item.responseIndex > 0 ? `reply #${item.responseIndex}` : "earlier reply"
    const lines = [`### ${index + 1}. ${label} (message ${item.messageID})`, "", quoteLines(item.span), ""]
    lines.push(`**Comment:** ${item.comment}`)
    return lines.join("\n")
  })
  return [INTRO, "", ...sections.map((section) => `${section}\n`)].join("\n").trimEnd()
}

/**
 * Prefix `draft` with the annotation block.
 *
 * Returns the exact number of characters inserted so callers can shift mentions.
 */
export function applyAnnotations(
  draft: string,
  items: readonly SpanAnnotation[],
): { text: string; delta: number } {
  const block = buildBlock(items)
  const text = draft.trim().length > 0 ? `${block}\n\n${draft}` : block
  return { text, delta: text.length - draft.length }
}

/** Shift every present mention offset right by `delta`. Insertion is at offset 0. */
export function shiftMentions(carrier: MentionCarrier, delta: number): void {
  if (delta === 0) return
  for (const list of [carrier.files, carrier.agents, carrier.skills]) {
    if (!list) continue
    for (const item of list) {
      const mention = item.mention
      if (!mention) continue
      mention.start += delta
      mention.end += delta
    }
  }
}

/** Number of mention offsets present on a prompt, for tests and diagnostics. */
export function countMentions(carrier: MentionCarrier): number {
  let total = 0
  for (const list of [carrier.files, carrier.agents, carrier.skills]) {
    if (!list) continue
    for (const item of list) if (item.mention) total += 1
  }
  return total
}
