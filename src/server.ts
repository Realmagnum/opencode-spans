/**
 * Server half of opencode-spans.
 *
 * Owns the durable state and the only write into the model's input: the `prompt`
 * admission hook. The TUI never edits prompts directly; it stages annotations through
 * RPC, and this hook attaches them exactly once.
 */
import { Plugin } from "@opencode/plugin"
import { handlePrompt } from "./core/hook.ts"
import { emptyRecord, type SpanRecord } from "./core/types.ts"
import { parseRecord, parseSessionID } from "./core/validate.ts"
import { SpansRpc } from "./rpc.ts"

type Definition = Parameters<typeof Plugin.define>[0]
type Ctx = Parameters<Definition["setup"]>[0]
type Json = Parameters<Ctx["storage"]["set"]>[1]

const key = (sessionID: string) => `spans:${sessionID}`

function asJson(value: SpanRecord): Json {
  return value as unknown as Json
}

async function readRecord(ctx: Ctx, sessionID: string): Promise<SpanRecord | null> {
  const raw = await ctx.storage.get(key(sessionID))
  if (raw === undefined) return null
  return parseRecord(raw)
}

async function writeRecord(ctx: Ctx, sessionID: string, record: SpanRecord): Promise<void> {
  await ctx.storage.set(key(sessionID), asJson(record))
}

export default Plugin.define({
  id: "spans",
  async setup(ctx) {
    const rpc = await ctx.rpc.register(SpansRpc, {
      async snapshot(input) {
        const sessionID = parseSessionID((input as { sessionID?: unknown })?.sessionID)
        if (sessionID === null) return { present: false, record: emptyRecord() }
        const record = await readRecord(ctx, sessionID)
        return { present: record !== null, record: record ?? emptyRecord() }
      },

      async stage(input) {
        const body = input as { sessionID?: unknown; record?: unknown }
        const sessionID = parseSessionID(body?.sessionID)
        const record = parseRecord(body?.record)
        if (sessionID === null || record === null) return { ok: false, count: 0 }
        await writeRecord(ctx, sessionID, record)
        return { ok: true, count: record.items.length }
      },

      async drop(input) {
        const sessionID = parseSessionID((input as { sessionID?: unknown })?.sessionID)
        if (sessionID === null) return { ok: false }
        await ctx.storage.remove(key(sessionID))
        return { ok: true }
      },

      async take(input) {
        const sessionID = parseSessionID((input as { sessionID?: unknown })?.sessionID)
        if (sessionID === null) return { present: false, record: emptyRecord() }
        const record = await readRecord(ctx, sessionID)
        if (record === null) return { present: false, record: emptyRecord() }
        await ctx.storage.remove(key(sessionID))
        return { present: true, record }
      },
    })

    const hook = await ctx.session.hook("prompt", async (event) => {
      await handlePrompt(
        {
          read: (sessionID) => readRecord(ctx, sessionID),
          write: (sessionID, record) => writeRecord(ctx, sessionID, record),
          remove: (sessionID) => ctx.storage.remove(key(sessionID)),
          replies: (sessionID) => ctx.session.context({ sessionID }),
        },
        event,
      )
    })

    return async () => {
      await hook.dispose()
      await rpc.dispose()
    }
  },
})
