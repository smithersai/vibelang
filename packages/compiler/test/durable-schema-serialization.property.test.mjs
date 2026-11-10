import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const { Context, Effect, Exit, Layer, Schema } = require("effect")
const RpcSerialization = require("effect/rpc/RpcSerialization")
const rule = "Each row is written from the TypeScript type, as VIP-15's mapping is."
assert.ok(readFileSync(join(repo, "docs/design/vips/0044-durable-values.md"), "utf8").includes(rule))

const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const serializers = [
  ["json", RpcSerialization.json],
  ["ndjson", RpcSerialization.ndjson],
  ["jsonRpc", RpcSerialization.jsonRpc()],
  ["ndJsonRpc", RpcSerialization.ndJsonRpc()],
  ...[false, true].map(fingerprintPayloads => [
    fingerprintPayloads ? "binary-fingerprint" : "binary",
    Effect.runSync(Effect.scoped(Effect.map(
      Layer.build(RpcSerialization.layerSchemaBinary({ fingerprintPayloads })),
      context => Context.get(context, RpcSerialization.RpcSerialization),
    ))),
  ]),
]

// VIP-44: "All six serializers round-trip Rpc `Exit` frames, and four of
// them fail on a bare record." Check both the successful and typed-error slots.
function roundTrip(serializer, schema, value, slot) {
  const payload = slot === "payload"
  const codec = serializer.codecFor(payload ? schema : Schema.Exit(schema, schema, Schema.Defect()))
  const encoded = Schema.encodeSync(codec)(payload ? value : slot === "error" ? Exit.fail(value) : Exit.succeed(value))
  const frame = payload
    ? { _tag: "Request", id: "0", tag: "Call", payload: encoded, headers: [] }
    : { _tag: "Exit", requestId: "0", exit: encoded }
  const bytes = serializer.makeUnsafe().encode(frame)
  assert.ok(bytes !== undefined, "serializer must emit a frame")
  const frames = serializer.makeUnsafe().decode(typeof bytes === "string" ? bytes : bytes.slice())
  assert.equal(frames.length, 1)
  assert.equal(frames[0]._tag, frame._tag)
  const decoded = Schema.decodeUnknownSync(codec)(payload ? frames[0].payload : frames[0].exit)
  if (payload) return decoded
  assert.equal(decoded._tag, slot === "error" ? "Failure" : "Success")
  return slot === "error" ? decoded.cause.reasons[0].error : decoded.value
}

function semantic(value) {
  if (value instanceof Error) return { error: value.name, message: value.message, ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "stack").map(([key, item]) => [key, semantic(item)])) }
  if (value instanceof Date) return { date: value.toISOString() }
  if (value instanceof URL) return { url: value.href }
  if (value instanceof RegExp) return { regexp: value.source, flags: value.flags }
  if (value instanceof Uint8Array) return { bytes: [...value] }
  if (value instanceof Set) return { set: [...value].map(semantic) }
  if (value instanceof Map) return { map: [...value].map(([key, item]) => [semantic(key), semantic(item)]) }
  if (Array.isArray(value)) return value.map(semantic)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, semantic(item)]))
  return value
}

test("generated durable schemas round-trip each mapping through every RpcSerialization", { timeout: 120_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-durable-"))
  try {
    cpSync(join(repo, "typescript/vibelang/cases/schema-durable-serialization"), root, { recursive: true })
    const modules = join(root, "node_modules")
    mkdirSync(modules)
    symlinkSync(fileURLToPath(new URL("../../runtime/node_modules/effect", import.meta.url)), join(modules, "effect"), "dir")
    symlinkSync(join(repo, "packages/runtime"), join(modules, "vibelang-runtime"), "dir")
    execFileSync(binary, ["-p", root, "--pretty", "false"], { encoding: "utf8", timeout: 90_000 })
    const generated = await import(pathToFileURL(join(root, "out/main.js")).href)
    const date = fc.integer({ min: -2208988800000, max: 4102444800000 }).map(ms => new Date(ms))
    const big = fc.bigInt({ min: -(1n << 128n), max: 1n << 128n })
    const rows = [
      ["Big", big],
      ["Missing", fc.constant(undefined)],
      ["When", date],
      ["Address", fc.string().map(text => new URL("https://x.dev/" + encodeURIComponent(text)))],
      ["Pattern", fc.tuple(fc.string(), fc.constantFrom("", "g", "im", "gimsuy")).map(([text, flags]) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags))],
      ["Bytes", fc.uint8Array({ maxLength: 40 })],
      ["Failure", fc.string().map(message => new Error(message))],
      ["Tags", fc.array(fc.string(), { maxLength: 8 }).map(items => new Set(items))],
      ["Counts", fc.array(fc.tuple(fc.string(), big), { maxLength: 8 }).map(items => new Map(items))],
      ["Nested", fc.tuple(fc.array(date, { maxLength: 5 }), fc.array(fc.tuple(fc.string(), fc.array(big, { maxLength: 5 })), { maxLength: 5 })).map(([dates, values]) => ({
        dates: new Set(dates), values: new Map(values.map(([key, items]) => [key, new Set(items)])),
      }))],
      ["Declined", fc.tuple(date, fc.string()).map(([at, reason]) => new generated.Declined({ at, reason }))],
    ]
    for (const [name, arbitrary] of rows) {
      await t.test(name, () => {
        for (const [label, serializer] of serializers) {
          fc.assert(fc.property(arbitrary, value => {
            for (const slot of ["payload", "success", "error"]) {
              const decoded = roundTrip(serializer, generated[name], value, slot)
              assert.equal(Schema.is(generated[name])(decoded), true, name + "/" + label + "/" + slot)
              assert.deepEqual(semantic(decoded), semantic(value), name + "/" + label + "/" + slot)
            }
          }), { seed: 44, numRuns: 40 })
        }
      })
    }
    await t.test("the schema mapping has the declared JSON representation", () => {
      for (const [name, value, json] of [
        ["Big", 12345n, "12345"],
        ["Missing", undefined, null],
        ["When", new Date(0), "1970-01-01T00:00:00.000Z"],
        ["Address", new URL("https://x.dev/a"), "https://x.dev/a"],
        ["Pattern", /a.b/gi, { source: "a.b", flags: "gi" }],
        ["Bytes", new Uint8Array([1, 2]), "AQI="],
        ["Tags", new Set(["a", "b"]), ["a", "b"]],
        ["Counts", new Map([["a", 1n]]), [["a", "1"]]],
      ]) assert.deepEqual(Schema.encodeSync(Schema.toCodecJson(generated[name]))(value), json, name)
      const error = Schema.encodeSync(Schema.toCodecJson(generated.Failure))(new Error("boom"))
      assert.equal(error.name, "Error")
      assert.equal(error.message, "boom")
    })
    await t.test("invalid Date has no durable encoding", () => {
      for (const [, serializer] of serializers)
        assert.throws(() => Schema.encodeSync(serializer.codecFor(generated.When))(new Date(NaN)))
    })
    await t.test("the oracle detects a missing mapping", () => {
      assert.throws(() => {
        const value = new Date(0)
        assert.deepEqual(semantic(roundTrip(RpcSerialization.json, Schema.Unknown, value, "success")), semantic(value))
      })
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
