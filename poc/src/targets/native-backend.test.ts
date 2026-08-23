import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  compilePortableModule,
  compilePortableWasm,
  decodePortableModuleArtifact,
  encodePortableModuleArtifact,
  executePortableTypeScript,
  executePortableWasm,
  type PortableEnvironment,
  type PortableModuleIR,
  type PortableWasmBuild
} from "./portable-backend.ts"
import {
  compilePortableNative,
  emitPortableLlvmIr,
  executePortableNative,
  type PortableNativeBuild
} from "./native-backend.ts"
import { digest } from "../durable/ir.ts"

/**
 * The acceptance bar for the native backend is THREE-WAY differential
 * agreement, so the comparison is the harness itself rather than a set of
 * hand-written expected values: for every scenario the TypeScript evaluator,
 * the real Wasm build, and the real native executable must produce identical
 * `PortableExecution` values — canonical exit AND wire digest AND contract
 * digest. A native result that merely "looks right" is not evidence.
 *
 * Nothing here is skipped when a toolchain is missing. `wat2wasm` and `clang`
 * must both be present; if either is absent these tests FAIL, loudly, because a
 * green suite that never compiled anything is exactly the failure mode this
 * project has already been burned by.
 */

interface Scenario {
  readonly name: string
  readonly input: Record<string, unknown>
  readonly environment?: PortableEnvironment
}

interface Trio {
  readonly module: PortableModuleIR
  readonly wasm: PortableWasmBuild
  readonly native: PortableNativeBuild
}

const buildTrio = async (moduleId: string, source: string): Promise<Trio> => {
  const module = compilePortableModule({ moduleId, source })
  const wasm = await compilePortableWasm(module)
  const native = await compilePortableNative(module)
  // A real compile really happened: `clang` identified itself and produced a
  // non-trivial executable from the emitted IR text.
  expect(native.toolVersion.toLowerCase()).toContain("clang")
  expect(native.binary.byteLength).toBeGreaterThan(1024)
  expect(native.llvmIr).toBe(emitPortableLlvmIr(module))
  return { module, wasm, native }
}

/** Run one scenario through all three runtimes and require exact agreement. */
const agree = async (trio: Trio, scenario: Scenario): Promise<void> => {
  const label = `${trio.module.moduleId}#${scenario.name}(${JSON.stringify(scenario.input)})`
  const host = executePortableTypeScript(trio.module, scenario.name, scenario.input, scenario.environment)
  const wasm = await executePortableWasm(trio.wasm, scenario.name, scenario.input, scenario.environment)
  const native = await executePortableNative(trio.native, scenario.name, scenario.input, scenario.environment)
  expect({ label, ...wasm }).toEqual({ label, ...host })
  expect({ label, ...native }).toEqual({ label, ...host })
  expect(`${label} ${native.wireDigest}`).toBe(`${label} ${host.wireDigest}`)
  expect(`${label} ${native.wireDigest}`).toBe(`${label} ${wasm.wireDigest}`)
  expect(`${label} ${native.contractDigest}`).toBe(`${label} ${host.contractDigest}`)
}

const agreeAll = async (trio: Trio, scenarios: readonly Scenario[]): Promise<void> => {
  for (const scenario of scenarios) await agree(trio, scenario)
}

/** Re-seal a build around a swapped binary, so digest validation still passes. */
const withBinary = (build: PortableNativeBuild, binary: Uint8Array): PortableNativeBuild => {
  const binaryDigest = createHash("sha256").update(binary).digest("hex")
  return {
    ...build,
    binary,
    binaryDigest,
    digest: digest({
      formatVersion: build.formatVersion,
      moduleDigest: build.module.digest,
      tool: build.tool,
      toolVersion: build.toolVersion,
      llvmIrDigest: build.llvmIrDigest,
      binaryDigest
    })
  }
}

const rehashModule = (module: Record<string, any>): void => {
  for (const fn of module.functions) {
    const contract = { name: fn.name, parameters: fn.parameters, requirements: fn.requirements, result: fn.result }
    fn.contractDigest = digest(contract)
    fn.digest = digest({ ...contract, contractDigest: fn.contractDigest, locals: fn.locals, body: fn.body })
  }
  module.digest = digest({
    formatVersion: module.formatVersion,
    moduleId: module.moduleId,
    capabilities: module.capabilities,
    functions: module.functions
  })
}

// ---------------------------------------------------------------------------
// Fixtures, reused verbatim from the portable backend's own corpus so the
// native backend is measured against exactly the cases the other two runtimes
// already agree on.
// ---------------------------------------------------------------------------

const SOURCE = `
class Negative extends Error {}
class TooLarge extends Error {}

export function affine(value: number, offset: number): number {
  return value * 2 + offset
}

export function maybeHalf(value: number): Optional<number> {
  if (value < 0) return null
  return value / 2
}

export function checkedScale(value: number, enabled: boolean): Result<number, Negative | TooLarge> {
  if (value < 0) throw new Negative()
  if (value > 10) throw new TooLarge()
  return enabled ? value * 3 : value
}

export function both(active: boolean, ready: boolean): boolean {
  return active && ready
}

export function maybeBoolean(active: boolean): Optional<boolean> {
  if (!active) return null
  return active
}

export function checkedBoolean(active: boolean): Result<boolean, Negative> {
  if (!active) throw new Negative()
  return active
}

export function identity(value: number): number {
  return value
}

export function divisionIsNan(value: number): boolean {
  return value / value !== value / value
}

export function maybeShadow(undefined: number): Optional<number> {
  return undefined
}
`

const FEATURE_SOURCE = `
class Alpha extends Error {}
class Negative extends Error {}
class TooLarge extends Error {
  constructor(readonly limit: number, readonly actual: number) { super() }
}

export function double(value: number): number {
  return value * 2
}

export function quadruple(value: number): number {
  return double(double(value))
}

export function half(value: number): Result<number, Negative> {
  if (value < 0) throw new Negative()
  return value / 2
}

export function remapped(value: number, wide: boolean): Result<number, Alpha | Negative> {
  if (!wide) throw new Alpha()
  const h = half(value).unwrap()
  return h
}

export function clamp(value: number, strict: boolean): Result<number, Negative | TooLarge> {
  const h = half(value).unwrap()
  if (strict && h > 10) throw new TooLarge(10, h)
  return h
}

export function clampCaller(value: number): Result<number, Negative | TooLarge> {
  return clamp(value, true)
}

export function tailHalf(value: number): Result<number, Negative> {
  return half(value)
}

export function maybeHalf(value: number): Optional<number> {
  if (value < 0) return null
  return value / 2
}

export function maybeQuarter(value: number): Optional<number> {
  const h = maybeHalf(value).unwrap()
  return maybeHalf(h)
}

export function sumTo(limit: number): number {
  let total = 0
  for (let index = 0; index < limit; index++) {
    total += index
    if (total > 1000) break
    if (index === 3) continue
  }
  return total
}

export function spin(flag: boolean): number {
  let count = 0
  while (flag) {
    count = count + 1
    if (count < 0) break
  }
  return count
}

export function countTo(limit: number): number {
  let index = 0
  while (index < limit) {
    index = index + 1
  }
  return index
}

export function loopedCallee(value: number): number {
  let total = value
  let steps = 0
  while (steps < 3) {
    total = double(total)
    steps++
  }
  return total
}

export function nanThroughCall(value: number): boolean {
  const r = double(value / value)
  return r !== r
}
`

const STRING_SOURCE = `
class Missing extends Error {}

export function label(flag: boolean): string {
  if (flag) return "on"
  return "off"
}

export function pickName(value: number): Result<string, Missing> {
  if (value < 0) throw new Missing()
  return value > 1 ? "many" : "one"
}

export function maybeLabel(flag: boolean): Optional<string> {
  if (!flag) return null
  return "ready"
}

export function shortLabel(flag: boolean): boolean {
  const text = label(flag)
  return text.length < 3
}

export function sameLabel(left: boolean, right: boolean): boolean {
  return label(left) === label(right)
}

export function pickCaller(value: number): Result<string, Missing> {
  const name = pickName(value).unwrap()
  return name
}

export function emptyLength(): number {
  const empty = ""
  return empty.length
}

export function loopLabel(limit: number): string {
  let count = 0
  while (count < limit) {
    count = count + 1
  }
  return count > 3 ? "big" : "small"
}
`

const STRING_RUNTIME_SOURCE = `
class Blank extends Error {
  constructor(readonly given: string, readonly size: number) { super() }
}

export function greet(name: string): string {
  return "hi " + name
}

export function shout(name: string, loud: boolean): string {
  let text = name
  if (loud) {
    text += "!"
  }
  return text
}

export function sameText(left: string, right: string): boolean {
  return left === right
}

export function beforeText(left: string, right: string): boolean {
  return left < right
}

export function sizeOf(text: string): number {
  return text.length
}

export function greetCaller(name: string): string {
  return greet(greet(name))
}

export function requireName(name: string): Result<string, Blank> {
  if (name.length === 0) throw new Blank(name, name.length)
  return "hi " + name
}

export function growLength(steps: number): number {
  let text = "x"
  let index = 0
  while (index < steps) {
    text += text
    index = index + 1
  }
  return text.length
}
`

const CAPABILITY_SOURCE = `
import { Context } from "smthrs/context"

abstract class Config extends Context {
  abstract readonly label: string
  abstract readonly retries: number
  abstract readonly verbose: boolean
}

abstract class Locale extends Context {
  abstract readonly suffix: string
}

class TooMany extends Error {
  constructor(readonly limit: number, readonly reason: string) { super() }
}

export function greet(name: string): string {
  const config = Config.context()
  return config.label + name
}

export function retries(): number {
  return Config.context().retries
}

export function verbose(): boolean {
  return Config.context().verbose
}

export function labelSize(): number {
  return Config.context().label.length
}

export function decorated(name: string): string {
  return greet(name) + Locale.context().suffix
}

export function bounded(step: number): number {
  let total = 0
  for (let index = 0; index < Config.context().retries; index++) {
    total += step
  }
  return total
}

export function checked(amount: number): Result<number, TooMany> {
  const config = Config.context()
  if (amount > config.retries) throw new TooMany(config.retries, config.label)
  return amount
}

export function maybeRetries(active: boolean): Optional<number> {
  if (!active) return null
  return Config.context().retries
}

export function pure(value: number): number {
  return value * 2
}
`

// ---------------------------------------------------------------------------
// Three-way agreement
// ---------------------------------------------------------------------------

test("clang -x ir turns emitted LLVM IR into a real, running executable", async () => {
  const module = compilePortableModule({
    moduleId: "example/affine",
    source: `export function affine(value: number, offset: number): number { return value * 2 + offset }`
  })
  const build = await compilePortableNative(module)

  expect(build.formatVersion).toBe(4)
  expect(build.tool).toBe("clang")
  expect(build.toolVersion.toLowerCase()).toContain("clang")
  expect(build.llvmIrDigest).toBe(digest(build.llvmIr))
  expect(build.binaryDigest).toBe(createHash("sha256").update(build.binary).digest("hex"))
  // The emitted text really is LLVM IR, and really was the compiler's input.
  expect(build.llvmIr).toContain("define internal { i32, double } @__impl_affine(double %arg.value, double %arg.offset)")
  expect(build.llvmIr).toContain("define i32 @main(i32 %argc, ptr %argv)")

  const host = executePortableTypeScript(module, "affine", { value: 4, offset: 3 })
  const native = await executePortableNative(build, "affine", { value: 4, offset: 3 })
  expect(native.exit).toEqual({ kind: "success", value: 11 })
  expect(native).toEqual(host)
}, 120_000)

test("scalars, Optional, Result, and boolean exits agree across all three runtimes", async () => {
  const trio = await buildTrio("example/math", SOURCE)
  await agreeAll(trio, [
    { name: "affine", input: { value: 4, offset: 3 } },
    { name: "both", input: { active: true, ready: false } },
    { name: "both", input: { active: true, ready: true } },
    { name: "maybeBoolean", input: { active: true } },
    { name: "maybeBoolean", input: { active: false } },
    { name: "checkedBoolean", input: { active: true } },
    { name: "checkedBoolean", input: { active: false } },
    { name: "maybeHalf", input: { value: 8 } },
    { name: "maybeHalf", input: { value: -1 } },
    { name: "checkedScale", input: { value: 4, enabled: true } },
    { name: "checkedScale", input: { value: -2, enabled: true } },
    { name: "checkedScale", input: { value: 11, enabled: false } },
    // Subnormal, max-finite, and large-magnitude doubles must survive the argv
    // and stdout encodings bit-for-bit, not merely to printed precision.
    { name: "identity", input: { value: 5e-324 } },
    { name: "identity", input: { value: 1.7976931348623157e308 } },
    { name: "identity", input: { value: 1e21 } },
    { name: "identity", input: { value: 0.1 } },
    { name: "identity", input: { value: -0.30000000000000004 } },
    // NaN must compare unordered identically in all three runtimes.
    { name: "divisionIsNan", input: { value: 0 } },
    { name: "divisionIsNan", input: { value: 2 } },
    { name: "maybeShadow", input: { undefined: 7 } }
  ])
}, 120_000)

test("intra-module calls, propagation, tail returns, locals, loops, and payloads agree across all three runtimes", async () => {
  const trio = await buildTrio("example/features", FEATURE_SOURCE)
  await agreeAll(trio, [
    { name: "double", input: { value: 21 } },
    { name: "quadruple", input: { value: 3 } },
    { name: "half", input: { value: 10 } },
    { name: "half", input: { value: -1 } },
    { name: "remapped", input: { value: -4, wide: true } },
    { name: "remapped", input: { value: 8, wide: true } },
    { name: "remapped", input: { value: 8, wide: false } },
    { name: "clamp", input: { value: 30, strict: true } },
    { name: "clamp", input: { value: 30, strict: false } },
    { name: "clamp", input: { value: -2, strict: true } },
    // A payload set at the throw site inside `clamp` must survive propagation
    // through `clampCaller`, including the native payload globals.
    { name: "clampCaller", input: { value: 26 } },
    { name: "tailHalf", input: { value: 12 } },
    { name: "tailHalf", input: { value: -3 } },
    { name: "maybeQuarter", input: { value: 8 } },
    { name: "maybeQuarter", input: { value: -8 } },
    { name: "sumTo", input: { limit: 10 } },
    { name: "sumTo", input: { limit: 100 } },
    { name: "spin", input: { flag: false } },
    { name: "loopedCallee", input: { value: 2 } },
    { name: "nanThroughCall", input: { value: 0 } },
    { name: "nanThroughCall", input: { value: 5 } }
  ])

  expect((await executePortableNative(trio.native, "clampCaller", { value: 26 })).exit).toEqual({
    kind: "failure",
    error: {
      identity: "smithers.error:example/features#TooLarge@1",
      payload: { limit: 10, actual: 13 }
    }
  })
}, 120_000)

test("fuel-bounded loops defect canonically and reset per invocation in all three runtimes", async () => {
  const trio = await buildTrio("example/features", FEATURE_SOURCE)
  // 999_999 iterations consume exactly the 1_000_000-condition budget; one more
  // exhausts it. All three runtimes must turn at exactly the same operation.
  await agreeAll(trio, [
    { name: "countTo", input: { limit: 999_999 } },
    { name: "countTo", input: { limit: 1_000_000 } },
    { name: "spin", input: { flag: true } },
    // The budget belongs to the invocation, not the process or the instance.
    { name: "countTo", input: { limit: 999_999 } }
  ])

  expect((await executePortableNative(trio.native, "countTo", { limit: 1_000_000 })).exit).toEqual({
    kind: "defect",
    defect: "fuel-exhausted"
  })
  expect((await executePortableNative(trio.native, "spin", { flag: true })).exit).toEqual({
    kind: "defect",
    defect: "fuel-exhausted"
  })
  // A native defect is a canonical exit, never a crash or a trap: the process
  // exits cleanly and the wire digest matches the evaluator's exactly.
  const host = executePortableTypeScript(trio.module, "spin", { flag: true })
  const native = await executePortableNative(trio.native, "spin", { flag: true })
  expect(native.wireDigest).toBe(host.wireDigest)
}, 120_000)

test("error payloads stay in the canonical wire domain in all three runtimes", async () => {
  const trio = await buildTrio("example/payload", `
class Flagged extends Error {
  constructor(readonly limit: number, readonly strict: boolean) { super() }
}
export function check(value: number, strict: boolean): Result<number, Flagged> {
  if (value > 10) throw new Flagged(value * 2, strict)
  return value
}
export function nanPayload(value: number): Result<number, Flagged> {
  if (value !== value) throw new Flagged(value, true)
  return value
}
export function negativeZeroPayload(value: number): Result<number, Flagged> {
  if (value < 1) throw new Flagged(value * 0, false)
  return value
}
`)
  await agreeAll(trio, [
    { name: "check", input: { value: 12, strict: true } },
    { name: "check", input: { value: 12, strict: false } },
    { name: "check", input: { value: 3, strict: true } },
    { name: "nanPayload", input: { value: 3 } },
    { name: "negativeZeroPayload", input: { value: 5 } }
  ])

  expect((await executePortableNative(trio.native, "check", { value: 12, strict: true })).exit).toEqual({
    kind: "failure",
    error: { identity: "smithers.error:example/payload#Flagged@1", payload: { limit: 24, strict: true } }
  })

  // A payload that leaves the canonical domain is rejected by the native host
  // for the same reason as by the other two, rather than travelling on the wire.
  // `-1 * 0` is negative zero, which is a legal double but not a legal wire
  // value, so all three must refuse it at the same boundary.
  const negativeZero = { value: -1 }
  expect(() => executePortableTypeScript(trio.module, "negativeZeroPayload", negativeZero))
    .toThrow("outside the canonical scalar wire domain")
  await expect(executePortableWasm(trio.wasm, "negativeZeroPayload", negativeZero))
    .rejects.toThrow("outside the canonical scalar wire domain")
  await expect(executePortableNative(trio.native, "negativeZeroPayload", negativeZero))
    .rejects.toThrow("outside the canonical scalar wire domain")
}, 120_000)

test("interned ASCII string literals agree across all three runtimes", async () => {
  const trio = await buildTrio("example/strings", STRING_SOURCE)
  await agreeAll(trio, [
    { name: "label", input: { flag: true } },
    { name: "label", input: { flag: false } },
    { name: "pickName", input: { value: 5 } },
    { name: "pickName", input: { value: 1 } },
    { name: "pickName", input: { value: -1 } },
    { name: "maybeLabel", input: { flag: true } },
    { name: "maybeLabel", input: { flag: false } },
    { name: "shortLabel", input: { flag: true } },
    { name: "shortLabel", input: { flag: false } },
    { name: "sameLabel", input: { left: true, right: true } },
    { name: "sameLabel", input: { left: true, right: false } },
    { name: "pickCaller", input: { value: 9 } },
    { name: "pickCaller", input: { value: -9 } },
    { name: "emptyLength", input: {} },
    { name: "loopLabel", input: { limit: 10 } },
    { name: "loopLabel", input: { limit: 2 } },
    { name: "loopLabel", input: { limit: 2_000_000 } }
  ])
}, 120_000)

test("string parameters, concatenation, ordering, and string payloads agree across all three runtimes", async () => {
  const trio = await buildTrio("example/string-runtime", STRING_RUNTIME_SOURCE)
  await agreeAll(trio, [
    { name: "greet", input: { name: "ada" } },
    { name: "greet", input: { name: "" } },
    { name: "shout", input: { name: "ada", loud: true } },
    { name: "shout", input: { name: "ada", loud: false } },
    // Equality must be CONTENT, not pointer identity: host-written arguments
    // live in the input region and are never interned, so two equal empty
    // strings sit at two different offsets.
    { name: "sameText", input: { left: "hi", right: "hi" } },
    { name: "sameText", input: { left: "hi", right: "ho" } },
    { name: "sameText", input: { left: "", right: "" } },
    { name: "sameText", input: { left: "a", right: "ab" } },
    { name: "sameText", input: { left: "ab", right: "a" } },
    // Byte-lexicographic ordering, including prefix and boundary bytes.
    { name: "beforeText", input: { left: "a", right: "b" } },
    { name: "beforeText", input: { left: "b", right: "a" } },
    { name: "beforeText", input: { left: "a", right: "a" } },
    { name: "beforeText", input: { left: "ab", right: "b" } },
    { name: "beforeText", input: { left: "", right: "a" } },
    { name: "beforeText", input: { left: "a", right: "" } },
    { name: "beforeText", input: { left: "Z", right: "a" } },
    { name: "beforeText", input: { left: "a~", right: "b " } },
    { name: "sizeOf", input: { text: "" } },
    { name: "sizeOf", input: { text: "hello" } },
    { name: "greetCaller", input: { name: "ada" } },
    { name: "requireName", input: { name: "ada" } },
    { name: "requireName", input: { name: "" } },
    { name: "growLength", input: { steps: 0 } },
    { name: "growLength", input: { steps: 18 } },
    // The string heap budget is charged as 4 + left + right per concat, so
    // step 19 exhausts it at exactly the same allocation in all three.
    { name: "growLength", input: { steps: 19 } }
  ])

  expect((await executePortableNative(trio.native, "growLength", { steps: 19 })).exit).toEqual({
    kind: "defect",
    defect: "string-memory-exhausted"
  })
  expect((await executePortableNative(trio.native, "requireName", { name: "" })).exit).toEqual({
    kind: "failure",
    error: { identity: "smithers.error:example/string-runtime#Blank@1", payload: { given: "", size: 0 } }
  })
}, 120_000)

test("computed strings leaving the canonical domain are rejected in all three runtimes", async () => {
  const trio = await buildTrio("example/wide", `export function wide(steps: number): string {
  let text = "x"
  let index = 0
  while (index < steps) {
    text += text
    index = index + 1
  }
  return text
}`)
  await agree(trio, { name: "wide", input: { steps: 12 } })
  expect(executePortableTypeScript(trio.module, "wide", { steps: 12 }).exit).toEqual({
    kind: "success",
    value: "x".repeat(4_096)
  })
  // 8_192 bytes is a legal heap allocation but an illegal wire value; all three
  // reject it at the wire boundary rather than truncating or shipping it.
  expect(() => executePortableTypeScript(trio.module, "wide", { steps: 13 })).toThrow("outside the canonical scalar wire domain")
  await expect(executePortableWasm(trio.wasm, "wide", { steps: 13 })).rejects.toThrow("outside the canonical scalar wire domain")
  await expect(executePortableNative(trio.native, "wide", { steps: 13 })).rejects.toThrow("outside the canonical scalar wire domain")
}, 120_000)

test("Context capabilities lower to a host environment with three-way agreement", async () => {
  const trio = await buildTrio("example/capability", CAPABILITY_SOURCE)
  const config = { label: "hi-", retries: 3, verbose: true }
  const locale = { suffix: "!" }
  await agreeAll(trio, [
    { name: "greet", input: { name: "ada" }, environment: { Config: config } },
    { name: "greet", input: { name: "" }, environment: { Config: { ...config, label: "" } } },
    { name: "retries", input: {}, environment: { Config: config } },
    { name: "verbose", input: {}, environment: { Config: { ...config, verbose: false } } },
    { name: "labelSize", input: {}, environment: { Config: config } },
    // Transitive rows: `decorated` inherits Config from `greet` and adds Locale.
    { name: "decorated", input: { name: "ada" }, environment: { Config: config, Locale: locale } },
    { name: "bounded", input: { step: 5 }, environment: { Config: config } },
    { name: "bounded", input: { step: 5 }, environment: { Config: { ...config, retries: 0 } } },
    { name: "checked", input: { amount: 2 }, environment: { Config: config } },
    { name: "checked", input: { amount: 9 }, environment: { Config: config } },
    { name: "maybeRetries", input: { active: false }, environment: { Config: config } },
    { name: "maybeRetries", input: { active: true }, environment: { Config: config } },
    // A requirement-free function takes — and demands — the empty environment.
    { name: "pure", input: { value: 4 }, environment: {} }
  ])

  expect((await executePortableNative(trio.native, "checked", { amount: 9 }, { Config: config })).exit).toEqual({
    kind: "failure",
    error: {
      identity: "smithers.error:example/capability#TooMany@1",
      payload: { limit: 3, reason: "hi-" }
    }
  })
  // The environment belongs to the invocation: two calls on the same build see
  // exactly the values they were handed.
  const first = await executePortableNative(trio.native, "retries", {}, { Config: { ...config, retries: 7 } })
  const second = await executePortableNative(trio.native, "retries", {}, { Config: { ...config, retries: 1 } })
  expect(first.exit).toEqual({ kind: "success", value: 7 })
  expect(second.exit).toEqual({ kind: "success", value: 1 })
}, 120_000)

test("capability-fed string growth exhausts the same budget in all three runtimes", async () => {
  const trio = await buildTrio("example/capability-budget", `import { Context } from "smthrs/context"
abstract class Config extends Context { abstract readonly chunk: string }
export function grow(times: number): string {
  const config = Config.context()
  let out = ""
  let index = 0
  while (index < times) { out += config.chunk; index = index + 1 }
  return out
}`)
  const environment = { Config: { chunk: "aaaaaaaaaa" } }
  await agree(trio, { name: "grow", input: { times: 400_000 }, environment })
  expect((await executePortableNative(trio.native, "grow", { times: 400_000 }, environment)).exit).toEqual({
    kind: "defect",
    defect: "string-memory-exhausted"
  })
}, 120_000)

test("scalar-only and unread capability slots agree across all three runtimes", async () => {
  const scalars = await buildTrio("example/capability-scalars", `import { Context } from "smthrs/context"
abstract class Flags extends Context { abstract readonly enabled: boolean; abstract readonly scale: number }
export function value(input: number): number { const f = Flags.context(); return f.enabled ? input * f.scale : input }`)
  await agreeAll(scalars, [
    { name: "value", input: { input: 4 }, environment: { Flags: { enabled: true, scale: 3 } } },
    { name: "value", input: { input: 4 }, environment: { Flags: { enabled: false, scale: 3 } } }
  ])

  // A declared-but-never-read slot is still installed, and still carries no
  // influence over the result.
  const unread = await buildTrio("example/capability-unread", `import { Context } from "smthrs/context"
abstract class Config extends Context { abstract readonly label: string; abstract readonly retries: number }
export function value(input: number): number { return Config.context().retries + input }`)
  await agree(unread, { name: "value", input: { input: 1 }, environment: { Config: { label: "never read", retries: 2 } } })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("emitted LLVM IR is byte-identical across runs and carries nothing host-specific", async () => {
  const module = compilePortableModule({ moduleId: "example/features", source: FEATURE_SOURCE })
  const first = emitPortableLlvmIr(module)
  const second = emitPortableLlvmIr(module)
  expect(second).toBe(first)

  // Re-deriving the module through the canonical artifact encoding rebuilds
  // every internal table from scratch, so an emitter that leaked object
  // identity or map-iteration order would diverge here.
  const roundTripped = decodePortableModuleArtifact(encodePortableModuleArtifact(module))
  expect(emitPortableLlvmIr(roundTripped)).toBe(first)

  // No target triple DIRECTIVE and no datalayout directive, so the host clang
  // supplies both and the text itself is identical on every machine. (The
  // header comment mentions them by name, hence the line-anchored match.)
  expect(first.split("\n").filter((line) => /^\s*target\s+(triple|datalayout)\s*=/.test(line))).toEqual([])
  // No absolute paths, no timestamps.
  expect(first).not.toContain(tmpdir())
  expect(first).not.toContain(homedir())
  // `toolVersion` is machine-specific and deliberately lives only in the BUILD
  // digest, never in the emitted text.
  expect(first.toLowerCase()).not.toContain("clang version")

  // Strings and capabilities exercise the pool and the environment layout,
  // which are the two tables most at risk of iteration-order leakage.
  const capability = compilePortableModule({ moduleId: "example/capability", source: CAPABILITY_SOURCE })
  expect(emitPortableLlvmIr(capability)).toBe(emitPortableLlvmIr(capability))
  expect(emitPortableLlvmIr(decodePortableModuleArtifact(encodePortableModuleArtifact(capability))))
    .toBe(emitPortableLlvmIr(capability))

  // "Across runs" means across PROCESSES, not merely across calls: a fresh
  // interpreter re-deriving the module from its artifact bytes must produce the
  // same text, which no in-process memoization could fake.
  const directory = await mkdtemp(join(tmpdir(), "smithers-native-determinism-"))
  try {
    const artifactPath = join(directory, "module.artifact")
    const scriptPath = join(directory, "emit.ts")
    await writeFile(artifactPath, encodePortableModuleArtifact(capability))
    await writeFile(scriptPath, [
      `import { readFileSync } from "node:fs"`,
      `import { decodePortableModuleArtifact } from ${JSON.stringify(join(import.meta.dir, "portable-backend.ts"))}`,
      `import { emitPortableLlvmIr } from ${JSON.stringify(join(import.meta.dir, "native-backend.ts"))}`,
      `import { digest } from ${JSON.stringify(join(import.meta.dir, "..", "durable", "ir.ts"))}`,
      `const decoded = decodePortableModuleArtifact(new Uint8Array(readFileSync(${JSON.stringify(artifactPath)})))`,
      `process.stdout.write(digest(emitPortableLlvmIr(decoded)))`
    ].join("\n"), "utf8")
    const child = Bun.spawnSync([process.execPath, "run", scriptPath])
    expect(child.stderr.toString("utf8")).toBe("")
    expect(child.exitCode).toBe(0)
    expect(child.stdout.toString("utf8")).toBe(digest(emitPortableLlvmIr(capability)))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 120_000)

// ---------------------------------------------------------------------------
// Fail-closed behaviour
// ---------------------------------------------------------------------------

test("a missing or broken toolchain fails closed with a specific diagnostic", async () => {
  if (process.platform === "win32") return
  const module = compilePortableModule({
    moduleId: "example/affine",
    source: `export function affine(value: number, offset: number): number { return value * 2 + offset }`
  })

  // Absent binary: an honest, named diagnostic — never a silent skip, and never
  // a success that compiled nothing.
  await expect(compilePortableNative(module, { clang: join(tmpdir(), "definitely-not-a-real-clang-binary") }))
    .rejects.toThrow("SMITHERS5103")
  await expect(compilePortableNative(module, { clang: join(tmpdir(), "definitely-not-a-real-clang-binary") }))
    .rejects.toThrow("requires a working")

  const directory = await mkdtemp(join(tmpdir(), "smithers-native-tool-test-"))
  try {
    // A driver that exists but refuses to identify itself.
    const refuses = join(directory, "refusing-clang")
    await writeFile(refuses, "#!/bin/sh\necho 'no thanks' >&2\nexit 3\n", "utf8")
    await chmod(refuses, 0o755)
    await expect(compilePortableNative(module, { clang: refuses })).rejects.toThrow("SMITHERS5103")

    // A driver that identifies itself but cannot compile: the failure surfaces
    // with the compiler's own stderr rather than as a silent empty artifact.
    const broken = join(directory, "broken-clang")
    await writeFile(broken, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'clang version 0.0.0'; exit 0; fi\necho 'cannot lower that' >&2\nexit 1\n", "utf8")
    await chmod(broken, 0o755)
    await expect(compilePortableNative(module, { clang: broken })).rejects.toThrow("SMITHERS5104")
    await expect(compilePortableNative(module, { clang: broken })).rejects.toThrow("cannot lower that")

    // A driver that claims success but produces nothing.
    const empty = join(directory, "empty-clang")
    await writeFile(empty, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'clang version 0.0.0'; exit 0; fi\nexit 0\n", "utf8")
    await chmod(empty, 0o755)
    await expect(compilePortableNative(module, { clang: empty })).rejects.toThrow("did not produce its output file")

    // A driver that never returns is bounded by the deadline, not left hanging.
    const hangs = join(directory, "hanging-clang")
    await writeFile(hangs, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'clang version 0.0.0'; exit 0; fi\nsleep 120\n", "utf8")
    await chmod(hangs, 0o755)
    await expect(compilePortableNative(module, { clang: hangs, timeoutMs: 2_000 })).rejects.toThrow("timed out after 2000ms")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }

  // Option validation is itself fail-closed.
  await expect(compilePortableNative(module, { clang: "" })).rejects.toThrow("SMITHERS5102")
  await expect(compilePortableNative(module, { timeoutMs: 0 })).rejects.toThrow("SMITHERS5102")
  await expect(compilePortableNative(module, { maxOutputBytes: 1 })).rejects.toThrow("SMITHERS5102")
}, 120_000)

test("forged IR never reaches emission", async () => {
  const module = compilePortableModule({ moduleId: "example/capability", source: CAPABILITY_SOURCE })

  // A module that keeps a requirement row while dropping the capability it
  // names is exactly the forgery the Wasm path rejects; the native emitter runs
  // the same `validatePortableModule` trust boundary and rejects it too.
  const stripped: Record<string, any> = JSON.parse(JSON.stringify(module))
  stripped.capabilities = stripped.capabilities.filter((capability: any) => capability.name !== "Locale")
  rehashModule(stripped)
  expect(() => emitPortableLlvmIr(stripped as PortableModuleIR)).toThrow()

  // A tampered digest is rejected before a single line of IR is produced.
  const misdigested = { ...JSON.parse(JSON.stringify(module)), digest: "0".repeat(64) }
  expect(() => emitPortableLlvmIr(misdigested as PortableModuleIR)).toThrow()

  // And a capability field whose type is quietly widened re-hashes cleanly but
  // still must not be lowered, because the digest covers the declaration.
  const retyped: Record<string, any> = JSON.parse(JSON.stringify(module))
  retyped.capabilities[0].fields[0].valueType = "number"
  expect(() => emitPortableLlvmIr(retyped as PortableModuleIR)).toThrow()
}, 120_000)

test("forged native builds are rejected before execution", async () => {
  const trio = await buildTrio("example/affine", `export function affine(value: number, offset: number): number { return value * 2 + offset }`)
  const other = await compilePortableNative(compilePortableModule({
    moduleId: "example/other",
    source: `export function affine(value: number, offset: number): number { return value * 100 + offset }`
  }))

  // Baseline: the honest build runs.
  expect((await executePortableNative(trio.native, "affine", { value: 4, offset: 3 })).exit)
    .toEqual({ kind: "success", value: 11 })

  // A build whose IR text does not re-emit from its own module.
  await expect(executePortableNative({ ...trio.native, llvmIr: `${trio.native.llvmIr}\n; tampered` }, "affine", { value: 4, offset: 3 }))
    .rejects.toThrow("SMITHERS5105")

  // A build whose binary digest does not match its bytes.
  await expect(executePortableNative({ ...trio.native, binaryDigest: "0".repeat(64) }, "affine", { value: 4, offset: 3 }))
    .rejects.toThrow("SMITHERS5105")

  // A build carrying an extra field, or missing one.
  await expect(executePortableNative({ ...trio.native, extra: 1 } as never, "affine", { value: 4, offset: 3 }))
    .rejects.toThrow("SMITHERS5105")

  // A DIFFERENT module's executable, re-sealed so every digest is internally
  // consistent. Digest checks alone cannot catch this — the running binary's
  // attestation of the module digest it was built from is what does.
  const swapped = withBinary(trio.native, other.binary)
  await expect(executePortableNative(swapped, "affine", { value: 4, offset: 3 }))
    .rejects.toThrow("SMITHERS5112")
  await expect(executePortableNative(swapped, "affine", { value: 4, offset: 3 }))
    .rejects.toThrow("did not attest the module digest")

  // A binary that is not an executable at all fails as an invocation error, not
  // as a plausible-looking result.
  const garbage = withBinary(trio.native, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
  await expect(executePortableNative(garbage, "affine", { value: 4, offset: 3 })).rejects.toThrow()

  // An unknown function name is named, not silently dispatched.
  await expect(executePortableNative(trio.native, "nope", { value: 1, offset: 1 }))
    .rejects.toThrow("SMITHERS5111")
}, 120_000)

test("inputs and environments are rejected for the same reason in all three runtimes", async () => {
  const trio = await buildTrio("example/environment", `import { Context } from "smthrs/context"
abstract class Config extends Context {
  abstract readonly label: string
  abstract readonly retries: number
  abstract readonly verbose: boolean
}
export function value(input: number): number { return Config.context().retries + input }
export function pure(input: number): number { return input }`)
  const good = { Config: { label: "x", retries: 1, verbose: true } }

  const rejectedBy = async (
    name: string,
    input: Record<string, unknown>,
    environment: unknown,
    expected: string
  ): Promise<void> => {
    const reasons: string[] = []
    for (const run of [
      async () => executePortableTypeScript(trio.module, name, input, environment as never),
      async () => executePortableWasm(trio.wasm, name, input, environment as never),
      async () => executePortableNative(trio.native, name, input, environment as never)
    ]) {
      try {
        await run()
        reasons.push("accepted")
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error))
      }
    }
    // Not merely all-rejected: every runtime must give the SAME reason. The
    // native diagnostics carry their own subsystem code and prefix, so the
    // shared, load-bearing part of the message is what is compared.
    for (const reason of reasons) expect(`${name} :: ${reason}`).toContain(expected)
  }

  await rejectedBy("value", { input: 1 }, {}, `does not match its requirement row ["Config"]; missing ["Config"]`)
  await rejectedBy("value", { input: 1 }, undefined, `does not match its requirement row ["Config"]`)
  await rejectedBy("value", { input: 1 }, { Config: good.Config, Extra: {} }, `unknown ["Extra"]`)
  // An environment richer than the row is as fatal as one that is too poor.
  await rejectedBy("pure", { input: 1 }, good, `does not match its requirement row []`)
  await rejectedBy("value", { input: 1 }, { Config: { label: "x", retries: 1 } }, "missing or unknown fields")
  await rejectedBy("value", { input: 1 }, { Config: { ...good.Config, extra: 1 } }, "missing or unknown fields")
  await rejectedBy("value", { input: 1 }, { Config: { ...good.Config, retries: "1" } }, "Config.retries must be number")
  await rejectedBy("value", { input: 1 }, { Config: { ...good.Config, verbose: 1 } }, "Config.verbose must be boolean")
  await rejectedBy("value", { input: 1 }, { Config: { ...good.Config, label: "café" } }, "printable ASCII string")
  await rejectedBy("value", { input: 1 }, { Config: { ...good.Config, label: "a".repeat(4097) } }, "printable ASCII string")
  await rejectedBy("value", { input: 1 }, { Config: null }, "must be an object of its declared fields")
  await rejectedBy("value", { input: 1 }, "nope", "must be an object of capability records")
  await rejectedBy("value", { input: 1 }, [good], "must be an object of capability records")
  await rejectedBy("value", { input: 1 }, { Config: { ...good.Config, retries: Number.NaN } }, "non-finite number")
  await rejectedBy("value", { input: 1 }, { Config: { ...good.Config, retries: -0 } }, "negative zero")

  // Input-side rejection is likewise shared.
  await rejectedBy("value", {}, good, "missing or unknown fields")
  await rejectedBy("value", { input: "1" }, good, "must be number")
  await rejectedBy("value", { input: Number.NaN }, good, "non-finite number")
  await rejectedBy("value", { input: 1, extra: 2 }, good, "missing or unknown fields")
}, 120_000)
