/**
 * Typed contract between the server half and the TUI half.
 *
 * JSON Schema keeps the contract dependency-free; values arrive as `unknown` and are
 * narrowed by `src/core/validate.ts` on both ends.
 */
import { Rpc } from "@opencode/plugin/rpc"

const annotation = {
  type: "object",
  properties: {
    id: { type: "string" },
    span: { type: "string" },
    comment: { type: "string" },
    messageID: { type: "string" },
    messageHash: { type: "string" },
    responseIndex: { type: "number" },
    createdAt: { type: "number" },
  },
  required: ["id", "span", "comment", "messageID", "messageHash", "responseIndex", "createdAt"],
  additionalProperties: false,
}

const record = {
  type: "object",
  properties: {
    version: { type: "number" },
    consumed: { type: "boolean" },
    invalidReason: { type: "string" },
    items: { type: "array", items: annotation },
  },
  required: ["version", "consumed", "invalidReason", "items"],
  additionalProperties: false,
}

const sessionID = {
  type: "object",
  properties: { sessionID: { type: "string" } },
  required: ["sessionID"],
  additionalProperties: false,
}

const recordResult = {
  type: "object",
  properties: { present: { type: "boolean" }, record: record },
  required: ["present", "record"],
  additionalProperties: false,
}

export const SpansRpc = Rpc.define({
  id: "spans",
  methods: {
    /** Read the staged record for a session. */
    snapshot: { input: sessionID, output: recordResult },
    /** Replace the staged record for a session. */
    stage: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, record },
        required: ["sessionID", "record"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, count: { type: "number" } },
        required: ["ok", "count"],
        additionalProperties: false,
      },
    },
    /** Discard the staged record for a session. */
    drop: {
      input: sessionID,
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    /** Atomically remove and return the staged record, so a send cannot duplicate it. */
    take: { input: sessionID, output: recordResult },
  },
  events: {},
})
