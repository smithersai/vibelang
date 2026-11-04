import { expect, test } from "bun:test"
import * as fc from "fast-check"
import * as Experimental from "vibelang-runtime/experimental"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import corpus from "./fixtures/foldkit-relay-location-scoped-ipv6.json"

const predicate = () => {
  expect(Experimental.NetAddress).toBeDefined()
  expect(typeof Experimental.NetAddress.isIPv6).toBe("function")
  return Experimental.NetAddress.isIPv6
}
const oracle = (inputs: ReadonlyArray<string>): Array<boolean> => {
  const path = fileURLToPath(new URL("./fixtures/ipv6-node-oracle.mjs", import.meta.url))
  const child = Bun.spawnSync(["node", path], {
    stdin: new TextEncoder().encode(JSON.stringify(inputs)), stdout: "pipe", stderr: "pipe", timeout: 15_000
  })
  expect(child.exitCode).toBe(0)
  expect(child.stderr.toString()).toBe("")
  const results = JSON.parse(child.stdout.toString())
  expect(results.length).toBe(inputs.length)
  expect(results.every((v: unknown) => typeof v === "boolean")).toBe(true)
  return results
}
const hex = fc.tuple(fc.integer({ min: 0, max: 0xffff }), fc.integer({ min: 1, max: 4 }))
  .map(([n, width]) => n.toString(16).padStart(width, "0"))
const segments = fc.array(hex, { minLength: 8, maxLength: 8 })
const full = segments.map((v) => v.join(":"))
const compressed = fc.tuple(segments, fc.integer({ min: 0, max: 7 }), fc.integer({ min: 1, max: 8 }))
  .map(([v, start, count]) => v.slice(0, start).join(":") + "::" + v.slice(start + Math.min(count, 8 - start)).join(":"))
const v4 = fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 4 }).map((v) => v.join("."))
const embedded = fc.oneof(
  fc.tuple(fc.array(hex, { minLength: 6, maxLength: 6 }), v4).map(([v, ip]) => v.join(":") + ":" + ip),
  fc.tuple(fc.constantFrom("", "ffff", "1:ffff", "2001:db8"), v4).map(([prefix, ip]) => prefix + "::" + ip)
)
const bare = fc.oneof(full, compressed, embedded, fc.constantFrom("::", "::1", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"))
const asciiZone = fc.oneof(
  fc.array(fc.constantFrom(..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-.:"), { minLength: 1, maxLength: 80 }).map((v) => v.join("")),
  fc.constantFrom("4294967296", "18446744073709551616", "0000004294967296", "-", ".", ":", "eth0:1-2.3")
)
const valid = fc.oneof(bare, fc.tuple(bare, asciiZone).map(([ip, zone]) => ip + "%" + zone))
const weirdZone = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.constantFrom("", "💩", "é", "eth_0", "%3", " eth0", "eth0\n", "eth0/3", "[eth0]", "\0", "\uD800")
)
const mutated = fc.tuple(bare, weirdZone, fc.integer({ min: 0, max: 6 })).map(([ip, zone, mode]) =>
  [ip + "%" + zone, "[" + ip + "]", ip + " ", ip + "\n", ip + "\0", ip.replace("::", ":::"), ip + "%" + zone + "%1"][mode]!
)
const neighbourhood = fc.oneof(valid, mutated, fc.string({ maxLength: 160 }), v4)

// VIP-33 section2: "What Effect lacks goes under Experimental.X".
// Node26 is the independent oracle, in actual Node child processes (not Bun's
// node:net compatibility layer). Only the missing zone grammar is new;
// Effect remains the address parser. No service/layer/platform read is needed.
test("NetAddress.isIPv6: consumed relay-location scoped-host corpus", () => {
  const isIPv6 = predicate()
  const inputs = corpus.cases.map((witness) => witness.input)
  const expected = oracle(inputs)
  expect(expected).toEqual(corpus.cases.map((witness) => witness.expected))
  expect(inputs.map(isIPv6)).toEqual(expected)
})

test("NetAddress.isIPv6: generated valid bare and scoped addresses match actual Node", () => {
  const isIPv6 = predicate()
  fc.assert(fc.property(fc.array(valid, { minLength: 1, maxLength: 64 }), (inputs) => {
    const expected = oracle(inputs)
    expect(expected.every(Boolean)).toBe(true) // Generator productivity, not a mostly-invalid oracle.
    expect(inputs.map(isIPv6)).toEqual(expected)
  }), { numRuns: 100, seed: 331560 })
}, 60_000)

test("NetAddress.isIPv6: generated malformed, Unicode and scoped neighbourhood matches Node", () => {
  const isIPv6 = predicate()
  fc.assert(fc.property(fc.array(neighbourhood, { minLength: 1, maxLength: 128 }), (inputs) => {
    expect(inputs.map(isIPv6)).toEqual(oracle(inputs))
  }), { numRuns: 150, seed: 331561 })
}, 60_000)

test("NetAddress.isIPv6: every ASCII zone boundary and oversized scope stays Node-compatible", () => {
  const isIPv6 = predicate()
  const inputs = Array.from({ length: 128 }, (_, code) => "::1%" + String.fromCharCode(code))
  inputs.push("::1%" + "9".repeat(4096), "::1%" + "0".repeat(4096), "::ffff:127.0.0.1%4294967296")
  expect(inputs.map(isIPv6)).toEqual(oracle(inputs))
})

test("NetAddress.isIPv6: browser bundle executes with no process, require or provider", async () => {
  const isIPv6 = predicate()
  const entry = fileURLToPath(new URL("./fixtures/ipv6-browser.ts", import.meta.url))
  const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife", minify: true })
  expect(result.success).toBe(true)
  expect(result.logs).toEqual([])
  const context: Record<string, unknown> = { TextEncoder, TextDecoder, URL, URLSearchParams }
  runInNewContext(await result.outputs[0]!.text(), context, { timeout: 15_000 })
  expect(context.noPlatform).toBe(true)
  expect(context.result).toEqual(["::1", "::1%4294967296", "::1%💩", "::ffff:127.0.0.1%eth0"].map(isIPv6))
}, 30_000)
