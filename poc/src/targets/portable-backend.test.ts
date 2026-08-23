import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  compilePortableModule,
  compilePortableWasm,
  decodePortableModuleArtifact,
  emitPortableWat,
  encodePortableModuleArtifact,
  executePortableTypeScript,
  executePortableWasm,
  PortableBackendError,
  validatePortableModule,
  type PortableWasmBuild,
  type PortableWireExit
} from "./portable-backend.ts"
import { digest, encodeCanonicalJson } from "../durable/ir.ts"

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

/** Calls, unwrap propagation, locals, loops, and payloads in one module. */
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

const withWasm = (build: PortableWasmBuild, wasm: Uint8Array): PortableWasmBuild => {
  const wasmDigest = createHash("sha256").update(wasm).digest("hex")
  return {
    ...build,
    wasm,
    wasmDigest,
    digest: digest({
      formatVersion: build.formatVersion,
      moduleDigest: build.module.digest,
      tool: build.tool,
      toolVersion: build.toolVersion,
      watDigest: build.watDigest,
      wasmDigest
    })
  }
}

interface DecodedU32 {
  readonly value: number
  readonly next: number
}

interface WasmExportEntry {
  readonly name: string
  readonly kind: number
  readonly index: number
  readonly nameStart: number
  readonly nameEnd: number
}

interface WasmExportSection {
  readonly sectionStart: number
  readonly payloadStart: number
  readonly payloadEnd: number
  readonly count: number
  readonly countEnd: number
  readonly entries: readonly WasmExportEntry[]
}

const decodeU32 = (bytes: Uint8Array, offset: number): DecodedU32 => {
  let value = 0
  let scale = 1
  for (let width = 0; width < 5; width += 1) {
    const byte = bytes[offset + width]
    if (byte === undefined) throw new TypeError("truncated Wasm u32")
    value += (byte & 0x7f) * scale
    if ((byte & 0x80) === 0) return { value, next: offset + width + 1 }
    scale *= 128
  }
  throw new TypeError("overlong Wasm u32")
}

const encodeU32 = (input: number): Uint8Array => {
  if (!Number.isSafeInteger(input) || input < 0 || input > 0xffff_ffff) {
    throw new TypeError("Wasm u32 is outside range")
  }
  const bytes: number[] = []
  let value = input
  do {
    const payload = value % 128
    value = Math.floor(value / 128)
    bytes.push(payload | (value === 0 ? 0 : 0x80))
  } while (value !== 0)
  return Uint8Array.from(bytes)
}

const joinBytes = (...chunks: readonly Uint8Array[]): Uint8Array => {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

/** Parse only enough of the binary format to identify the exact export vector. */
const wasmExportSection = (wasm: Uint8Array): WasmExportSection => {
  if (wasm.byteLength < 8 || Buffer.from(wasm.subarray(0, 8)).toString("hex") !== "0061736d01000000") {
    throw new TypeError("not a Wasm 1 binary")
  }
  let sectionStart = 8
  while (sectionStart < wasm.byteLength) {
    const id = wasm[sectionStart]!
    const size = decodeU32(wasm, sectionStart + 1)
    const payloadStart = size.next
    const payloadEnd = payloadStart + size.value
    if (payloadEnd > wasm.byteLength) throw new TypeError("truncated Wasm section")
    if (id !== 7) {
      sectionStart = payloadEnd
      continue
    }

    const count = decodeU32(wasm, payloadStart)
    let cursor = count.next
    const entries: WasmExportEntry[] = []
    for (let entry = 0; entry < count.value; entry += 1) {
      const nameLength = decodeU32(wasm, cursor)
      const nameStart = nameLength.next
      const nameEnd = nameStart + nameLength.value
      if (nameEnd >= payloadEnd) throw new TypeError("truncated Wasm export name")
      const name = new TextDecoder("utf-8", { fatal: true }).decode(wasm.subarray(nameStart, nameEnd))
      const kind = wasm[nameEnd]!
      const index = decodeU32(wasm, nameEnd + 1)
      entries.push({ name, kind, index: index.value, nameStart, nameEnd })
      cursor = index.next
    }
    if (cursor !== payloadEnd) throw new TypeError("Wasm export section has trailing bytes")
    return {
      sectionStart,
      payloadStart,
      payloadEnd,
      count: count.value,
      countEnd: count.next,
      entries
    }
  }
  throw new TypeError("Wasm binary has no export section")
}

/** Rename one export without changing any section length or non-export byte. */
const renameWasmExport = (wasm: Uint8Array, name: string, replacement: string): Uint8Array => {
  const entry = wasmExportSection(wasm).entries.find((candidate) => candidate.name === name)
  if (!entry) throw new TypeError(`Wasm export ${name} is absent`)
  const encoded = new TextEncoder().encode(replacement)
  if (encoded.byteLength !== entry.nameEnd - entry.nameStart) {
    throw new TypeError("replacement Wasm export name must preserve its encoded length")
  }
  const patched = Uint8Array.from(wasm)
  patched.set(encoded, entry.nameStart)
  return patched
}

/** Add a second name for a real function while preserving a valid Wasm module. */
const addBogusWasmExport = (wasm: Uint8Array, name: string): Uint8Array => {
  const section = wasmExportSection(wasm)
  if (section.entries.some((entry) => entry.name === name)) throw new TypeError("bogus export already exists")
  const target = section.entries.find((entry) => entry.kind === 0)
  if (!target) throw new TypeError("Wasm binary has no function to alias")
  const encodedName = new TextEncoder().encode(name)
  const added = joinBytes(encodeU32(encodedName.byteLength), encodedName, Uint8Array.of(0), encodeU32(target.index))
  const payload = joinBytes(
    encodeU32(section.count + 1),
    wasm.subarray(section.countEnd, section.payloadEnd),
    added
  )
  const replacement = joinBytes(Uint8Array.of(7), encodeU32(payload.byteLength), payload)
  return joinBytes(
    wasm.subarray(0, section.sectionStart),
    replacement,
    wasm.subarray(section.payloadEnd)
  )
}

const rehashFunction = (fn: Record<string, any>): void => {
  const contract = { name: fn.name, parameters: fn.parameters, requirements: fn.requirements, result: fn.result }
  fn.contractDigest = digest(contract)
  const semantic = { ...contract, contractDigest: fn.contractDigest, locals: fn.locals, body: fn.body }
  fn.digest = digest(semantic)
}

const rehashModule = (module: Record<string, any>): void => {
  for (const fn of module.functions) rehashFunction(fn)
  module.digest = digest({
    formatVersion: module.formatVersion,
    moduleId: module.moduleId,
    capabilities: module.capabilities,
    functions: module.functions
  })
}

const forgedCopy = (module: unknown): Record<string, any> => JSON.parse(JSON.stringify(module)) as Record<string, any>

test("checked source lowers to exact portable IR without author-module evaluation", () => {
  ;(globalThis as Record<string, unknown>).__portable_backend_pwned = false
  const module = compilePortableModule({ moduleId: "example/math", source: SOURCE })
  expect(module.formatVersion).toBe(4)
  expect(module.functions.map((fn) => fn.name)).toEqual([
    "affine", "both", "checkedBoolean", "checkedScale", "divisionIsNan", "identity", "maybeBoolean", "maybeHalf", "maybeShadow"
  ])
  expect(module.functions.find((fn) => fn.name === "checkedScale")?.result).toMatchObject({
    kind: "result",
    errors: [
      { name: "Negative", tag: 1, fields: [] },
      { name: "TooLarge", tag: 2, fields: [] }
    ]
  })
  expect(module.functions.every((fn) => Array.isArray(fn.body) && fn.locals.length === 0)).toBe(true)
  expect((globalThis as Record<string, unknown>).__portable_backend_pwned).toBe(false)
  expect(Object.isFrozen(module)).toBe(true)

  const artifact = encodePortableModuleArtifact(module)
  expect(decodePortableModuleArtifact(artifact)).toEqual(module)
  expect(encodePortableModuleArtifact(decodePortableModuleArtifact(artifact))).toEqual(artifact)
})

test("TypeScript and real Wasm targets agree on plain, Optional, Result, and boolean wire hashes", async () => {
  const module = compilePortableModule({ moduleId: "example/math", source: SOURCE })
  const build = await compilePortableWasm(module)
  expect(build.toolVersion.length).toBeGreaterThan(0)
  const moduleBytes = Uint8Array.from(build.wasm)
  expect(WebAssembly.Module.imports(new WebAssembly.Module(moduleBytes.buffer as ArrayBuffer))).toEqual([])
  expect(emitPortableWat(module)).toBe(build.wat)

  const cases = [
    { name: "affine", input: { value: 4, offset: 3 } },
    { name: "both", input: { active: true, ready: false } },
    { name: "maybeBoolean", input: { active: true } },
    { name: "maybeBoolean", input: { active: false } },
    { name: "checkedBoolean", input: { active: true } },
    { name: "checkedBoolean", input: { active: false } },
    { name: "maybeHalf", input: { value: 8 } },
    { name: "maybeHalf", input: { value: -1 } },
    { name: "checkedScale", input: { value: 4, enabled: true } },
    { name: "checkedScale", input: { value: -2, enabled: true } },
    { name: "checkedScale", input: { value: 11, enabled: false } },
    { name: "identity", input: { value: 5e-324 } },
    { name: "identity", input: { value: 1.7976931348623157e308 } },
    { name: "identity", input: { value: 1e21 } },
    { name: "divisionIsNan", input: { value: 0 } },
    { name: "divisionIsNan", input: { value: 2 } },
    { name: "maybeShadow", input: { undefined: 7 } }
  ] as const
  for (const scenario of cases) {
    const typescript = executePortableTypeScript(module, scenario.name, scenario.input)
    const wasm = await executePortableWasm(build, scenario.name, scenario.input)
    expect(wasm).toEqual(typescript)
  }

  expect(executePortableTypeScript(module, "maybeHalf", { value: -1 }).exit).toEqual({ kind: "absent" })
  expect(executePortableTypeScript(module, "checkedScale", { value: -2, enabled: true }).exit).toEqual({
    kind: "failure",
    error: {
      identity: "smithers.error:example/math#Negative@1",
      payload: {}
    }
  })
  expect(executePortableTypeScript(module, "maybeShadow", { undefined: 7 }).exit).toEqual({ kind: "success", value: 7 })
  expect(executePortableTypeScript(module, "divisionIsNan", { value: 0 }).exit).toEqual({ kind: "success", value: true })
}, 120_000)

test("intra-module calls, unwrap propagation, tail returns, locals, loops, and payloads agree across runtimes", async () => {
  const module = compilePortableModule({ moduleId: "example/features", source: FEATURE_SOURCE })
  const artifact = encodePortableModuleArtifact(module)
  expect(decodePortableModuleArtifact(artifact)).toEqual(module)
  const build = await compilePortableWasm(module)
  expect(emitPortableWat(module)).toBe(build.wat)

  // Negative sorts before TooLarge but after Alpha: `remapped` must carry
  // half's tag-1 Negative into its own tag-2 slot inside Wasm.
  expect(module.functions.find((fn) => fn.name === "remapped")?.result).toMatchObject({
    kind: "result",
    errors: [
      { name: "Alpha", tag: 1 },
      { name: "Negative", tag: 2 }
    ]
  })

  const cases = [
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
  ] as const
  for (const scenario of cases) {
    const typescript = executePortableTypeScript(module, scenario.name, scenario.input)
    const wasm = await executePortableWasm(build, scenario.name, scenario.input)
    expect(wasm).toEqual(typescript)
  }

  expect(executePortableTypeScript(module, "remapped", { value: -4, wide: true }).exit).toEqual({
    kind: "failure",
    error: { identity: "smithers.error:example/features#Negative@1", payload: {} }
  })
  expect(executePortableTypeScript(module, "quadruple", { value: 3 }).exit).toEqual({ kind: "success", value: 12 })
  expect(executePortableTypeScript(module, "maybeQuarter", { value: -8 }).exit).toEqual({ kind: "absent" })
  expect(executePortableTypeScript(module, "sumTo", { limit: 10 }).exit).toEqual({ kind: "success", value: 45 })
  // Payload set at the throw site inside `clamp` survives propagation through
  // `clampCaller` in both runtimes, including the Wasm payload globals.
  expect((await executePortableWasm(build, "clampCaller", { value: 26 })).exit).toEqual({
    kind: "failure",
    error: {
      identity: "smithers.error:example/features#TooLarge@1",
      payload: { limit: 10, actual: 13 }
    }
  })
}, 120_000)

test("fuel-bounded loops defect canonically and reset per exported invocation", async () => {
  const module = compilePortableModule({ moduleId: "example/features", source: FEATURE_SOURCE })
  const build = await compilePortableWasm(module)

  // 999_999 iterations consume exactly the 1_000_000-condition budget.
  const boundaryTs = executePortableTypeScript(module, "countTo", { limit: 999_999 })
  const boundaryWasm = await executePortableWasm(build, "countTo", { limit: 999_999 })
  expect(boundaryTs.exit).toEqual({ kind: "success", value: 999_999 })
  expect(boundaryWasm).toEqual(boundaryTs)

  const exhaustedTs = executePortableTypeScript(module, "countTo", { limit: 1_000_000 })
  const exhaustedWasm = await executePortableWasm(build, "countTo", { limit: 1_000_000 })
  expect(exhaustedTs.exit).toEqual({ kind: "defect", defect: "fuel-exhausted" })
  expect(exhaustedWasm).toEqual(exhaustedTs)
  expect(exhaustedTs.wireDigest).toBe(exhaustedWasm.wireDigest)

  const spinTs = executePortableTypeScript(module, "spin", { flag: true })
  const spinWasm = await executePortableWasm(build, "spin", { flag: true })
  expect(spinTs.exit).toEqual({ kind: "defect", defect: "fuel-exhausted" })
  expect(spinWasm).toEqual(spinTs)

  // The budget belongs to the exported invocation, not the module instance.
  expect(executePortableTypeScript(module, "countTo", { limit: 999_999 }).exit).toEqual({ kind: "success", value: 999_999 })
  expect((await executePortableWasm(build, "countTo", { limit: 999_999 })).exit).toEqual({ kind: "success", value: 999_999 })
}, 120_000)

test("error payloads stay in the canonical wire domain in both runtimes", async () => {
  const source = `
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
`
  const module = compilePortableModule({ moduleId: "example/payload", source })
  const build = await compilePortableWasm(module)

  const okTs = executePortableTypeScript(module, "check", { value: 12, strict: true })
  const okWasm = await executePortableWasm(build, "check", { value: 12, strict: true })
  expect(okTs.exit).toEqual({
    kind: "failure",
    error: { identity: "smithers.error:example/payload#Flagged@1", payload: { limit: 24, strict: true } }
  })
  expect(okWasm).toEqual(okTs)

  const nanInternal = executePortableTypeScript(module, "nanPayload", { value: 3 })
  expect(nanInternal.exit).toEqual({ kind: "success", value: 3 })
  expect(await executePortableWasm(build, "nanPayload", { value: 3 })).toEqual(nanInternal)

  // NaN can only be produced internally; both runtimes must refuse to encode
  // it (and -0) into a failure payload rather than diverge silently.
  const nanSource = `
class Flagged extends Error {
  constructor(readonly probe: number) { super() }
}
export function explode(value: number): Result<number, Flagged> {
  if (value < 1) throw new Flagged(value / value)
  return value
}
`
  const nanModule = compilePortableModule({ moduleId: "example/payload-nan", source: nanSource })
  const nanBuild = await compilePortableWasm(nanModule)
  expect(() => executePortableTypeScript(nanModule, "explode", { value: 0 })).toThrow(
    "outside the canonical scalar wire domain"
  )
  await expect(executePortableWasm(nanBuild, "explode", { value: 0 })).rejects.toThrow(
    "outside the canonical scalar wire domain"
  )

  const negativeZeroTs = () => executePortableTypeScript(module, "negativeZeroPayload", { value: -1 })
  expect(negativeZeroTs).toThrow("outside the canonical scalar wire domain")
  await expect(executePortableWasm(build, "negativeZeroPayload", { value: -1 })).rejects.toThrow(
    "outside the canonical scalar wire domain"
  )
}, 120_000)

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

test("interned ASCII strings, equality, length, and string returns agree across runtimes", async () => {
  const module = compilePortableModule({ moduleId: "example/strings", source: STRING_SOURCE })
  const artifact = encodePortableModuleArtifact(module)
  expect(decodePortableModuleArtifact(artifact)).toEqual(module)
  const wat = emitPortableWat(module)
  // Format 3 exports memory so the host can decode computed strings; this
  // module interns and compares literals but never concatenates, so it carries
  // neither the bump-allocator global nor the allocator itself.
  expect(wat).toContain(`(memory (export "__memory") 1)`)
  expect(wat).toContain("(data (i32.const 0)")
  expect(wat).toContain("(func $__str_eq")
  expect(wat).not.toContain("$__heap")
  expect(wat).not.toContain("$__concat")
  // A module with no string feature at all still declares no memory.
  expect(emitPortableWat(compilePortableModule({ moduleId: "example/math", source: SOURCE }))).not.toContain("memory")
  const build = await compilePortableWasm(module)

  const cases = [
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
  ] as const
  for (const scenario of cases) {
    const typescript = executePortableTypeScript(module, scenario.name, scenario.input)
    const wasm = await executePortableWasm(build, scenario.name, scenario.input)
    expect(wasm).toEqual(typescript)
  }

  expect(executePortableTypeScript(module, "label", { flag: true }).exit).toEqual({ kind: "success", value: "on" })
  expect(executePortableTypeScript(module, "maybeLabel", { flag: false }).exit).toEqual({ kind: "absent" })
  expect(executePortableTypeScript(module, "pickCaller", { value: 9 }).exit).toEqual({ kind: "success", value: "many" })
  expect(executePortableTypeScript(module, "shortLabel", { flag: true }).exit).toEqual({ kind: "success", value: true })
  expect(executePortableTypeScript(module, "loopLabel", { limit: 2_000_000 }).exit).toEqual({
    kind: "defect",
    defect: "fuel-exhausted"
  })
}, 120_000)

/** Format 3: string parameters, concatenation, ordering, and string payloads. */
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

test("string parameters, concatenation, ordering, and string payloads agree across runtimes", async () => {
  const module = compilePortableModule({ moduleId: "example/string-runtime", source: STRING_RUNTIME_SOURCE })
  expect(decodePortableModuleArtifact(encodePortableModuleArtifact(module))).toEqual(module)
  const wat = emitPortableWat(module)
  expect(wat).toContain(`(memory (export "__memory")`)
  expect(wat).toContain("(global $__heap")
  expect(wat).toContain("(func $__concat")
  expect(wat).toContain("(func $__str_eq")
  expect(wat).toContain("(func $__str_cmp")
  const build = await compilePortableWasm(module)
  expect(build.formatVersion).toBe(4)

  const cases = [
    { name: "greet", input: { name: "ada" } },
    { name: "greet", input: { name: "" } },
    { name: "shout", input: { name: "ada", loud: true } },
    { name: "shout", input: { name: "ada", loud: false } },
    // Equality must be content, not pointer identity: host-written arguments
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
    { name: "growLength", input: { steps: 19 } }
  ] as const
  for (const scenario of cases) {
    const typescript = executePortableTypeScript(module, scenario.name, scenario.input)
    const wasm = await executePortableWasm(build, scenario.name, scenario.input)
    expect(wasm).toEqual(typescript)
    expect(wasm.wireDigest).toBe(typescript.wireDigest)
  }

  expect(executePortableTypeScript(module, "greet", { name: "ada" }).exit).toEqual({ kind: "success", value: "hi ada" })
  expect(executePortableTypeScript(module, "greet", { name: "" }).exit).toEqual({ kind: "success", value: "hi " })
  expect(executePortableTypeScript(module, "greetCaller", { name: "ada" }).exit).toEqual({ kind: "success", value: "hi hi ada" })
  expect(executePortableTypeScript(module, "shout", { name: "ada", loud: true }).exit).toEqual({ kind: "success", value: "ada!" })
  expect(executePortableTypeScript(module, "sameText", { left: "", right: "" }).exit).toEqual({ kind: "success", value: true })
  expect(executePortableTypeScript(module, "requireName", { name: "" }).exit).toEqual({
    kind: "failure",
    error: { identity: "smithers.error:example/string-runtime#Blank@1", payload: { given: "", size: 0 } }
  })

  // `text += text` charges 4 + leftBytes + rightBytes per concat, so the
  // 1_048_576-byte budget survives 18 doublings (524_358 bytes) and defects on
  // the 19th (1_048_650), at the identical operation in both runtimes.
  expect(executePortableTypeScript(module, "growLength", { steps: 18 }).exit).toEqual({ kind: "success", value: 262_144 })
  expect(executePortableTypeScript(module, "growLength", { steps: 19 }).exit).toEqual({
    kind: "defect",
    defect: "string-memory-exhausted"
  })
  // The heap budget belongs to the exported invocation, exactly like fuel.
  // Proven on a single shared instance: without the wrapper rewinding $__heap
  // the second call would defect on a heap the first call already consumed.
  const shared = await WebAssembly.instantiate(Uint8Array.from(build.wasm), {})
  const growTwice = shared.instance.exports.growLength as (steps: number) => readonly [number, number]
  expect(growTwice(18)).toEqual([0, 262_144])
  expect(growTwice(18)).toEqual([0, 262_144])
  expect(growTwice(19)[0]).toBe(-2)
  expect(growTwice(18)).toEqual([0, 262_144])

  // The negative tag space is closed: an undeclared defect tag is rejected
  // rather than mapped onto some nearby canonical defect. `growLength` is the
  // only concat function returning f64, so `(i32.const -2) (f64.const ...)`
  // (0x41 0x7e 0x44) uniquely identifies its string-memory defect return.
  const retagged = Uint8Array.from(build.wasm)
  let defectTag = -1
  for (let index = retagged.length - 3; index >= 0; index--) {
    if (retagged[index] === 0x41 && retagged[index + 1] === 0x7e && retagged[index + 2] === 0x44) {
      defectTag = index + 1
      break
    }
  }
  expect(defectTag).toBeGreaterThanOrEqual(0)
  retagged[defectTag] = 0x7d
  await expect(executePortableWasm(withWasm(build, retagged), "growLength", { steps: 19 })).rejects.toThrow(
    "unknown defect tag"
  )

  // Wire-boundary argument validation runs before either runtime executes.
  expect(() => executePortableTypeScript(module, "sizeOf", { text: "café" })).toThrow("printable ASCII string")
  await expect(executePortableWasm(build, "sizeOf", { text: "café" })).rejects.toThrow("printable ASCII string")
  expect(() => executePortableTypeScript(module, "sizeOf", { text: "x".repeat(4_097) })).toThrow("printable ASCII string")
  await expect(executePortableWasm(build, "sizeOf", { text: "x".repeat(4_097) })).rejects.toThrow("printable ASCII string")

  // A computed string longer than the wire limit may exist internally but can
  // never leave, and both runtimes refuse it with the same diagnostic.
  const wideSource = `export function wide(steps: number): string {
  let text = "x"
  let index = 0
  while (index < steps) {
    text += text
    index = index + 1
  }
  return text
}`
  const wideModule = compilePortableModule({ moduleId: "example/wide", source: wideSource })
  const wideBuild = await compilePortableWasm(wideModule)
  expect(executePortableTypeScript(wideModule, "wide", { steps: 12 }).exit).toEqual({ kind: "success", value: "x".repeat(4_096) })
  expect(await executePortableWasm(wideBuild, "wide", { steps: 12 })).toEqual(
    executePortableTypeScript(wideModule, "wide", { steps: 12 })
  )
  expect(() => executePortableTypeScript(wideModule, "wide", { steps: 13 })).toThrow("outside the canonical scalar wire domain")
  await expect(executePortableWasm(wideBuild, "wide", { steps: 13 })).rejects.toThrow("outside the canonical scalar wire domain")
}, 180_000)

test("string sources outside the bounded subset and forged string IR/Wasm fail closed", async () => {
  // Strings never coerce: mixed-type `+` stays rejected even though `string +
  // number` is legal TypeScript.
  expect(() => compilePortableModule({
    moduleId: "hostile/mixed-concat",
    source: `export function value(input: string): string { return input + 1 }`
  })).toThrow("portable + requires two numbers or two portable strings")
  // Every string method beyond `.length` remains unreachable.
  expect(() => compilePortableModule({
    moduleId: "hostile/string-slice",
    source: `export function value(input: string): string { return input.slice(1) }`
  })).toThrow("only direct calls to declared portable functions are callable")
  expect(() => compilePortableModule({
    moduleId: "hostile/string-upper",
    source: `export function value(input: string): string { return input.toUpperCase() }`
  })).toThrow("only direct calls to declared portable functions are callable")
  expect(() => compilePortableModule({
    moduleId: "hostile/string-index",
    source: `export function value(input: string): boolean { return input[0] === "a" }`
  })).toThrow("unsupported portable expression kind")
  expect(() => compilePortableModule({
    moduleId: "hostile/non-ascii",
    source: `export function value(flag: boolean): string { return "café" }`
  })).toThrow("printable ASCII")
  expect(() => compilePortableModule({
    moduleId: "hostile/oversized-literal",
    source: `export function value(flag: boolean): string { return "${"x".repeat(5000)}" }`
  })).toThrow("printable ASCII")
  expect(() => compilePortableModule({
    moduleId: "hostile/template-literal",
    source: "export function value(flag: boolean): string { return `on` }"
  })).toThrow("unsupported portable expression")
  const module = compilePortableModule({ moduleId: "example/strings", source: STRING_SOURCE })
  const forgedLiteral = forgedCopy(module)
  const label = forgedLiteral.functions.find((fn: Record<string, any>) => fn.name === "label")
  label.body[0].whenTrue[0].value.value = "café"
  rehashModule(forgedLiteral)
  expect(() => validatePortableModule(forgedLiteral)).toThrow("does not match its portable value type")

  const forgedLength = forgedCopy(module)
  const emptyLength = forgedLength.functions.find((fn: Record<string, any>) => fn.name === "emptyLength")
  emptyLength.body[1].value.value = { kind: "literal", valueType: "number", value: 1 }
  rehashModule(forgedLength)
  expect(() => validatePortableModule(forgedLength)).toThrow("string-length operand/type mismatch")

  // Forged IR must be rejected for the format 3 constructs too, not just the
  // format 2 ones: a concat whose operand type was swapped, and a string
  // parameter retyped underneath a body that still reads it as a string.
  const runtime = compilePortableModule({ moduleId: "example/string-runtime", source: STRING_RUNTIME_SOURCE })
  const forgedConcat = forgedCopy(runtime)
  const greet = forgedConcat.functions.find((fn: Record<string, any>) => fn.name === "greet")
  greet.body[0].value.right = { kind: "literal", valueType: "number", value: 1 }
  rehashModule(forgedConcat)
  expect(() => validatePortableModule(forgedConcat)).toThrow("binary operator/type mismatch")

  const forgedParameter = forgedCopy(runtime)
  const sizeOf = forgedParameter.functions.find((fn: Record<string, any>) => fn.name === "sizeOf")
  sizeOf.parameters[0].valueType = "number"
  rehashModule(forgedParameter)
  expect(() => validatePortableModule(forgedParameter)).toThrow("parameter identity/type mismatch")

  // Format 3 decodes strings out of exported memory, so the interned pool is no
  // longer the validity oracle; a forged offset is caught by bounds validation
  // of the [u32 length][bytes] record instead, even though every digest still
  // verifies. Pool: "" at 0, "off" at 4, "on" at 11, memoryBytes 20.
  const pickSource = `export function pick(flag: boolean): string {
  if (flag) return "on"
  return "off"
}`
  const pickModule = compilePortableModule({ moduleId: "abi/strings", source: pickSource })
  const pickBuild = await compilePortableWasm(pickModule)
  // `(return (i32.const 11))` -> 0x41 0x0b 0x0f.
  const findLiteral = (wasm: Uint8Array): number => {
    for (let index = wasm.length - 3; index >= 0; index--) {
      if (wasm[index] === 0x41 && wasm[index + 1] === 0x0b && wasm[index + 2] === 0x0f) return index + 1
    }
    return -1
  }
  expect(findLiteral(pickBuild.wasm)).toBeGreaterThanOrEqual(0)

  // Offset 12 is inside memory but its length word is whatever bytes follow.
  const misaligned = Uint8Array.from(pickBuild.wasm)
  misaligned[findLiteral(misaligned)] = 12
  await expect(executePortableWasm(withWasm(pickBuild, misaligned), "pick", { flag: true })).rejects.toThrow(
    "string length is outside exported memory"
  )

  // Offset 19 leaves no room for even the length word.
  const past = Uint8Array.from(pickBuild.wasm)
  past[findLiteral(past)] = 19
  await expect(executePortableWasm(withWasm(pickBuild, past), "pick", { flag: true })).rejects.toThrow(
    "string offset is outside exported memory"
  )
}, 120_000)

test("the portable backend rejects ambient authority, foreign calls, generics, and top-level effects", () => {
  ;(globalThis as Record<string, unknown>).__portable_backend_pwned = false
  expect(() => compilePortableModule({
    moduleId: "hostile/top-level",
    source: `
      ;(globalThis as any).__portable_backend_pwned = true
      export function value(input: number): number { return input }
    `
  })).toThrow("portable modules may contain only")
  expect((globalThis as Record<string, unknown>).__portable_backend_pwned).toBe(false)

  expect(() => compilePortableModule({
    moduleId: "hostile/call",
    source: `export function value(input: number): number { return Math.abs(input) }`
  })).toThrow("unsupported portable expression")
  expect(() => compilePortableModule({
    moduleId: "hostile/generic",
    source: `export function value<T>(input: number): number { return input }`
  })).toThrow("non-generic")
  expect(() => compilePortableModule({
    moduleId: "hostile/mutable-error-field",
    source: `
      class Bad extends Error { constructor(code: number) { super() } }
      export function value(input: number): Result<number, Bad> { throw new Bad(input) }
    `
  })).toThrow("readonly")
  expect(() => compilePortableModule({
    moduleId: "hostile/error-method",
    source: `
      class Bad extends Error { constructor(readonly code: number) { super(); this.code = code * 2 } }
      export function value(input: number): Result<number, Bad> { throw new Bad(input) }
    `
  })).toThrow("exactly `super()`")
  expect(() => compilePortableModule({
    moduleId: "hostile/context",
    source: `
      declare const Clock: { context(): { now(): number } }
      export function value(input: number): number { return Clock.context().now() + input }
    `
  })).toThrow()
})

test("the portable backend rejects recursion, deep chains, and misplaced propagation", () => {
  expect(() => compilePortableModule({
    moduleId: "hostile/self-recursion",
    source: `export function factorial(value: number): number {
      if (value <= 1) return 1
      return value * factorial(value - 1)
    }`
  })).toThrow("recursive portable calls are rejected")
  expect(() => compilePortableModule({
    moduleId: "hostile/mutual-recursion",
    source: `
      export function even(value: number): boolean {
        if (value === 0) return true
        return odd(value - 1)
      }
      export function odd(value: number): boolean {
        if (value === 0) return false
        return even(value - 1)
      }
    `
  })).toThrow("recursive portable calls are rejected")

  const chained = Array.from({ length: 34 }, (_, index) => index === 0
    ? `export function f0(value: number): number { return value + 1 }`
    : `export function f${index}(value: number): number { return f${index - 1}(value) + 1 }`).join("\n")
  expect(() => compilePortableModule({ moduleId: "hostile/deep-chain", source: chained }))
    .toThrow("call chains deeper than 32")

  const propagationBase = `
class Bad extends Error {}
export function half(value: number): Result<number, Bad> {
  if (value < 0) throw new Bad()
  return value / 2
}
export function maybe(value: number): Optional<number> {
  if (value < 0) return null
  return value
}
`
  expect(() => compilePortableModule({
    moduleId: "hostile/unwrap-in-expression",
    source: `${propagationBase}
export function caller(value: number): Result<number, Bad> {
  return half(value).unwrap() * 2
}`
  })).toThrow(PortableBackendError)
  expect(() => compilePortableModule({
    moduleId: "hostile/unwrap-reassignment",
    source: `${propagationBase}
export function caller(value: number): Result<number, Bad> {
  let h = 0
  h = half(value).unwrap()
  return h
}`
  })).toThrow(PortableBackendError)
  expect(() => compilePortableModule({
    moduleId: "hostile/unbound-result",
    source: `${propagationBase}
export function caller(value: number): number {
  return half(value)
}`
  })).toThrow(PortableBackendError)
  expect(() => compilePortableModule({
    moduleId: "hostile/optional-in-result",
    source: `${propagationBase}
export function caller(value: number): Result<number, Bad> {
  const h = maybe(value).unwrap()
  return h
}`
  })).toThrow(PortableBackendError)
  expect(() => compilePortableModule({
    moduleId: "hostile/result-in-optional",
    source: `${propagationBase}
export function caller(value: number): Optional<number> {
  const h = half(value).unwrap()
  return h
}`
  })).toThrow(PortableBackendError)
})

test("the portable backend rejects mutation misuse, reserved names, and unbounded loop forms", () => {
  expect(() => compilePortableModule({
    moduleId: "hostile/const-reassign",
    source: `export function value(input: number): number {
      const held = input
      held = held + 1
      return held
    }`
  })).toThrow(PortableBackendError)
  expect(() => compilePortableModule({
    moduleId: "hostile/parameter-assign",
    source: `export function value(input: number): number {
      input = input + 1
      return input
    }`
  })).toThrow("parameters are immutable")
  expect(() => compilePortableModule({
    moduleId: "hostile/duplicate-local",
    source: `export function value(flag: boolean): number {
      if (flag) { const held = 1; return held }
      const held = 2
      return held
    }`
  })).toThrow("duplicates another parameter or local name")
  expect(() => compilePortableModule({
    moduleId: "hostile/reserved-name",
    source: `export function value(input: number): number {
      const __tag = input
      return __tag
    }`
  })).toThrow("reserved")
  expect(() => compilePortableModule({
    moduleId: "hostile/do-while",
    source: `export function value(input: number): number {
      let total = 0
      do { total = total + 1 } while (total < input)
      return total
    }`
  })).toThrow("unsupported portable statement")
  expect(() => compilePortableModule({
    moduleId: "hostile/labeled-loop",
    source: `export function value(input: number): number {
      outer: while (input > 0) { break outer }
      return input
    }`
  })).toThrow(PortableBackendError)
  expect(() => compilePortableModule({
    moduleId: "hostile/missing-return-path",
    source: `export function value(flag: boolean): number {
      while (flag) { return 1 }
    }`
  })).toThrow(PortableBackendError)
})

test("source identities and compiler inputs are canonical and fail before module resolution", () => {
  expect(() => compilePortableModule({
    moduleId: "../identity",
    source: `export function value(input: number): number { return input }`
  })).toThrow("canonical ASCII package/path identity")
  expect(() => compilePortableModule({
    moduleId: "identity#forged",
    source: `export function value(input: number): number { return input }`
  })).toThrow("canonical ASCII package/path identity")
  expect(() => compilePortableModule({
    moduleId: "hostile/import",
    source: `import type { Secret } from "/definitely-not-readable/secret.ts"; export function value(input: number): number { return input }`
  })).toThrow("may only import { Context }")
  expect(() => compilePortableModule({
    moduleId: "hostile/reference",
    source: `/// <reference path="/definitely-not-readable/secret.ts" />\nexport function value(input: number): number { return input }`
  })).toThrow("cannot contain reference directives")
  expect(() => compilePortableModule({
    moduleId: "hostile/jsdoc-import",
    source: `/** @import { Secret } from "/definitely-not-readable/secret.ts" */\nexport function value(input: number): number { return input }`
  })).toThrow("cannot contain JSDoc imports")
  expect(() => compilePortableModule({
    moduleId: "hostile/declared-error",
    source: `declare class MissingRuntimeError extends Error {}\nexport function value(): Result<number, MissingRuntimeError> { throw new MissingRuntimeError() }`
  })).toThrow("concrete scalar-payload declarations")

  const nested = "(".repeat(300) + "value" + ")".repeat(300)
  expect(() => compilePortableModule({
    moduleId: "hostile/depth",
    source: `export function deep(value: number): number { return ${nested} }`
  })).toThrow("lowering depth limit")
})

test("nominal Error identities and malformed in-memory IR cannot be rehashed into validity", () => {
  const module = compilePortableModule({
    moduleId: "identity/errors",
    source: `class Expected extends Error {}\nexport function failValue(): Result<number, Expected> { throw new Expected() }`
  })
  const forged = forgedCopy(module)
  const fn = forged.functions[0]
  fn.result.errors[0].identity = "smithers.error:other/module#Expected@1"
  fn.body[0].identity = fn.result.errors[0].identity
  rehashModule(forged)
  expect(() => validatePortableModule(forged)).toThrow("error identity/tag is invalid")

  const malformed = forgedCopy(module)
  malformed.functions[0].result = null
  expect(() => validatePortableModule(malformed)).toThrow(PortableBackendError)
})

test("forged IR for calls, locals, loops, and payloads is rejected per node kind", () => {
  const module = compilePortableModule({ moduleId: "example/features", source: FEATURE_SOURCE })

  const withForged = (mutate: (functions: Record<string, any>[]) => void): Record<string, any> => {
    const forged = forgedCopy(module)
    mutate(forged.functions as Record<string, any>[])
    rehashModule(forged)
    return forged
  }
  const fnNamed = (functions: Record<string, any>[], name: string): Record<string, any> =>
    functions.find((fn) => fn.name === name)!

  // call expression: unknown callee, arity, and fallible-callee misuse
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "quadruple").body[0].value.callee = "missing"
  }))).toThrow("unknown function")
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "quadruple").body[0].value.arguments = []
  }))).toThrow("call arity mismatch")
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "quadruple").body[0].value.callee = "half"
  }))).toThrow("expression calls must target plain functions")

  // recursion and cycles cannot be forged around the lowering
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "quadruple").body[0].value.callee = "quadruple"
  }))).toThrow("recursive call")

  // bind-call: propagating into a mismatched caller channel
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "maybeQuarter").body[0].callee = "half"
  }))).toThrow("Result propagation requires a Result caller")

  // locals: read-before-declaration, immutable assignment, duplicate slots
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "sumTo")
    fn.body.unshift({ kind: "return", value: { kind: "local", valueType: "number", index: 0, name: "total" } })
    fn.body.length = 1
  }))).toThrow("before initialization")
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "clamp")
    fn.locals[0].mutable = false
    fn.body.splice(1, 0, {
      kind: "assign",
      index: 0,
      name: fn.locals[0].name,
      valueType: "number",
      value: { kind: "literal", valueType: "number", value: 1 }
    })
  }))).toThrow("immutable local")
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "sumTo")
    fn.body.splice(1, 0, JSON.parse(JSON.stringify(fn.body[0])))
  }))).toThrow("re-declares local slot")

  // loops: non-boolean conditions, non-assign updates, misplaced break
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "countTo")
    const loop = fn.body.find((statement: Record<string, any>) => statement.kind === "while")
    loop.condition = { kind: "literal", valueType: "number", value: 1 }
  }))).toThrow("condition must be boolean")
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "sumTo")
    const loop = fn.body.find((statement: Record<string, any>) => statement.kind === "while")
    loop.update = [{ kind: "break" }]
  }))).toThrow("must be an assignment")
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "double").body.unshift({ kind: "break" })
  }))).toThrow("must appear inside a loop")

  // terminality: unreachable statements and fall-through bodies
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "double")
    fn.body.push(JSON.parse(JSON.stringify(fn.body[0])))
  }))).toThrow("unreachable after a terminal statement")
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "double").body.length = 0
  }))).toThrow("fall off the function end")

  // payloads: forged arity and type cannot pass the declared field row
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "clamp")
    const failure = fn.body[1].whenTrue[0]
    failure.arguments = [failure.arguments[0]]
  }))).toThrow("failure payload arity mismatch")
  expect(() => validatePortableModule(withForged((functions) => {
    const fn = fnNamed(functions, "clamp")
    fn.body[1].whenTrue[0].arguments[0] = { kind: "literal", valueType: "boolean", value: true }
  }))).toThrow("failure payload type mismatch")

  // tail-call: channel mismatches cannot be forged
  expect(() => validatePortableModule(withForged((functions) => {
    fnNamed(functions, "tailHalf").body[0].callee = "maybeHalf"
  }))).toThrow(PortableBackendError)
})

test("IR artifacts, inputs, noncanonical outputs, and compiled Wasm fail closed", async () => {
  const module = compilePortableModule({ moduleId: "example/math", source: SOURCE })
  const forged = forgedCopy(module)
  const affine = forged.functions.find((fn: Record<string, any>) => fn.name === "affine")
  affine.body[0].value.operator = "and"
  rehashModule(forged)
  expect(() => validatePortableModule(forged)).toThrow("operator/type mismatch")

  const artifact = JSON.parse(new TextDecoder().decode(encodePortableModuleArtifact(module))) as Record<string, any>
  artifact.extra = true
  expect(() => decodePortableModuleArtifact(encodeCanonicalJson(artifact))).toThrow("missing or unknown fields")

  // Format 2 artifacts are decode-rejected with a version diagnostic rather
  // than silently reinterpreted: format 3 changed string equality from pointer
  // identity to memcmp and added memory, exports, and negative defect tags, so
  // a v2 module cannot be soundly executed here. The rejection is a genuine
  // version check, not a digest failure — every digest below still verifies.
  const legacy = forgedCopy(module)
  legacy.formatVersion = 2
  rehashModule(legacy)
  expect(() => validatePortableModule(legacy)).toThrow("formatVersion 2 predates the format 3 string ABI")
  const legacyIdentity = { artifactVersion: 1, kind: "smithers.portable-ir", module: legacy }
  expect(() => decodePortableModuleArtifact(
    encodeCanonicalJson({ ...legacyIdentity, digest: digest(legacyIdentity) })
  )).toThrow("formatVersion 2 predates the format 3 string ABI")
  expect(() => executePortableTypeScript(module, "affine", { value: 1 })).toThrow("missing or unknown fields")
  expect(() => executePortableTypeScript(module, "affine", { value: Number.NaN, offset: 1 })).toThrow()

  const zeroSource = `export function divide(value: number, divisor: number): number { return value / divisor }`
  const zeroModule = compilePortableModule({ moduleId: "example/nonfinite", source: zeroSource })
  const zeroBuild = await compilePortableWasm(zeroModule)
  expect(() => executePortableTypeScript(zeroModule, "divide", { value: 1, divisor: 0 })).toThrow(
    "outside the canonical scalar wire domain"
  )
  await expect(executePortableWasm(zeroBuild, "divide", { value: 1, divisor: 0 })).rejects.toThrow(
    "outside the canonical scalar wire domain"
  )

  const signedZeroModule = compilePortableModule({
    moduleId: "example/signed-zero",
    source: `export function zero(value: number): number { return value * 0 }`
  })
  const signedZeroBuild = await compilePortableWasm(signedZeroModule)
  expect(() => executePortableTypeScript(signedZeroModule, "zero", { value: -1 })).toThrow(
    "outside the canonical scalar wire domain"
  )
  await expect(executePortableWasm(signedZeroBuild, "zero", { value: -1 })).rejects.toThrow(
    "outside the canonical scalar wire domain"
  )

  const build = await compilePortableWasm(module)
  const corrupted = Uint8Array.from(build.wasm)
  corrupted[0] ^= 0xff
  await expect(executePortableWasm({ ...build, wasm: corrupted }, "affine", {
    value: 1,
    offset: 2
  })).rejects.toThrow("build identity/content mismatch")
}, 120_000)

test("Wasm validation rejects mutable, forged, and noncanonical ABI builds", async () => {
  const module = compilePortableModule({
    moduleId: "abi/boolean",
    source: `export function flag(): boolean { return false }`
  })
  const build = await compilePortableWasm(module)

  // The impl body is `(return (i32.const 0))`: find `i32.const 0` directly
  // followed by `return` (0x41 0x00 0x0f) and forge a noncanonical boolean.
  const mutated = Uint8Array.from(build.wasm)
  let literal = -1
  for (let index = mutated.length - 3; index >= 0; index--) {
    if (mutated[index] === 0x41 && mutated[index + 1] === 0x00 && mutated[index + 2] === 0x0f) {
      literal = index + 1
      break
    }
  }
  expect(literal).toBeGreaterThanOrEqual(0)
  mutated[literal] = 2
  await expect(executePortableWasm(withWasm(build, mutated), "flag", {})).rejects.toThrow(
    "not a canonical i32 boolean"
  )

  await expect(executePortableWasm({ ...build, unexpected: true } as PortableWasmBuild, "flag", {})).rejects.toThrow(
    "missing or unknown fields"
  )

  // A format 2 build is refused even when its own digest is self-consistent:
  // the ABI version is checked, not merely hashed.
  const legacyBuild = {
    ...build,
    formatVersion: 2,
    digest: digest({
      formatVersion: 2,
      moduleDigest: build.module.digest,
      tool: build.tool,
      toolVersion: build.toolVersion,
      watDigest: build.watDigest,
      wasmDigest: build.wasmDigest
    })
  } as unknown as PortableWasmBuild
  await expect(executePortableWasm(legacyBuild, "flag", {})).rejects.toThrow("build identity/content mismatch")

  build.wasm[0] ^= 0xff
  await expect(executePortableWasm(build, "flag", {})).rejects.toThrow("build identity/content mismatch")
}, 120_000)

test("binary-patched Wasm cannot hide __memory or add a bogus export", async () => {
  const module = compilePortableModule({
    moduleId: "abi/forged-exports",
    source: `export function echo(value: string): string { return value }`
  })
  const build = await compilePortableWasm(module)
  const originalExports = WebAssembly.Module.exports(
    new WebAssembly.Module(Uint8Array.from(build.wasm).buffer as ArrayBuffer)
  ).map((entry) => `${entry.kind}:${entry.name}`).sort()
  expect(originalExports).toEqual(["function:echo", "memory:__memory"])

  // Same-length replacement: the export section remains structurally valid,
  // but the checked IR's required memory name is no longer present.
  const hiddenMemory = renameWasmExport(build.wasm, "__memory", "__hidden")
  expect(WebAssembly.Module.exports(
    new WebAssembly.Module(hiddenMemory.buffer as ArrayBuffer)
  ).map((entry) => `${entry.kind}:${entry.name}`).sort()).toEqual([
    "function:echo", "memory:__hidden"
  ])

  // Rebuild the export section with a larger vector and section-size LEB. The
  // new name aliases a real function index, so WebAssembly itself accepts the
  // binary; only the IR-derived exact-surface check should reject it.
  const extraExport = addBogusWasmExport(build.wasm, "__bogus")
  expect(WebAssembly.Module.exports(
    new WebAssembly.Module(extraExport.buffer as ArrayBuffer)
  ).map((entry) => `${entry.kind}:${entry.name}`).sort()).toEqual([
    "function:__bogus", "function:echo", "memory:__memory"
  ])

  for (const forged of [hiddenMemory, extraExport]) {
    try {
      await executePortableWasm(withWasm(build, forged), "echo", { value: "ok" })
      throw new TypeError("forged Wasm export surface was silently accepted")
    } catch (error) {
      expect(error).toBeInstanceOf(PortableBackendError)
      expect((error as PortableBackendError).diagnostic).toEqual({
        code: "SMITHERS5059",
        message: "portable Wasm exports do not match checked IR",
        line: 1,
        column: 1
      })
    }
  }
}, 120_000)

test("the external Wasm tool is killed at the configured deadline", async () => {
  if (process.platform === "win32") return
  const module = compilePortableModule({
    moduleId: "tool/timeout",
    source: `export function value(): number { return 1 }`
  })
  const directory = await mkdtemp(join(tmpdir(), "smithers-portable-tool-test-"))
  const command = join(directory, "fake-wat2wasm")
  const symlinkCommand = join(directory, "fake-wat2wasm-symlink")
  try {
    await writeFile(command, `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  process.stdout.write("fake-wat2wasm 1.0\\n")
} else {
  const child = require("node:child_process").spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1_000)"],
    { stdio: "inherit" }
  )
  child.unref()
}
`, "utf8")
    await chmod(command, 0o755)
    // The wrapper's detached grandchild holds our pipes open, so this deadline
    // fires at any budget; it only needs to outlast Node's own startup for the
    // version probe and wrapper under full-suite load.
    await expect(compilePortableWasm(module, { wat2wasm: command, timeoutMs: 2_000 })).rejects.toThrow(
      "timed out after 2000ms"
    )

    await writeFile(symlinkCommand, `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  process.stdout.write("fake-wat2wasm 1.0\\n")
} else {
  const output = process.argv[process.argv.indexOf("-o") + 1]
  require("node:fs").symlinkSync("/dev/zero", output)
}
`, "utf8")
    await chmod(symlinkCommand, 0o755)
    // Generous deadline: this assertion proves symlink-output rejection, not
    // timing, and the fake Node tool starts twice (version probe + run), which
    // can exceed a tight deadline under full-suite load.
    await expect(compilePortableWasm(module, { wat2wasm: symlinkCommand, timeoutMs: 30_000 })).rejects.toThrow(
      "output must be a regular file"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 120_000)


/** Value-service capabilities: the whole environment ABI in one module. */
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

test("Context capabilities lower to a host-supplied environment with exact dual-runtime agreement", async () => {
  const module = compilePortableModule({ moduleId: "example/capability", source: CAPABILITY_SOURCE })

  // The requirement descriptor is the IR: nominal identities, exact field rows,
  // and per-function rows closed transitively through ordinary calls.
  expect(module.capabilities).toEqual([
    {
      name: "Config",
      identity: "smithers.capability:example/capability#Config@1",
      fields: [
        { name: "label", valueType: "string" },
        { name: "retries", valueType: "number" },
        { name: "verbose", valueType: "boolean" }
      ]
    },
    {
      name: "Locale",
      identity: "smithers.capability:example/capability#Locale@1",
      fields: [{ name: "suffix", valueType: "string" }]
    }
  ])
  expect(Object.fromEntries(module.functions.map((fn) => [fn.name, fn.requirements]))).toEqual({
    bounded: ["Config"],
    checked: ["Config"],
    decorated: ["Config", "Locale"],
    greet: ["Config"],
    labelSize: ["Config"],
    maybeRetries: ["Config"],
    pure: [],
    retries: ["Config"],
    verbose: ["Config"]
  })
  // The row is part of the static type, so it is inside the contract digest.
  const greet = module.functions.find((fn) => fn.name === "greet")!
  expect(greet.contractDigest).toBe(digest({
    name: "greet",
    parameters: [{ name: "name", valueType: "string" }],
    requirements: ["Config"],
    result: { kind: "plain", valueType: "string" }
  }))

  const wat = emitPortableWat(module)
  // Two scalar fields become exported mutable globals; the two string fields
  // become fixed records the host writes into the environment region, so their
  // pointers are compile-time constants and never forgeable at runtime.
  expect(wat).toContain(`(global $__smithers_env_0 (export "__smithers_env_0") (mut f64) (f64.const 0))`)
  expect(wat).toContain(`(global $__smithers_env_1 (export "__smithers_env_1") (mut i32) (i32.const 0))`)
  expect(wat).not.toContain("__smithers_env_2")
  expect(wat).toContain("(global.get $__smithers_env_0)")
  expect(wat).toContain(`(memory (export "__memory")`)

  const build = await compilePortableWasm(module)
  expect(build.formatVersion).toBe(4)
  // The capability ABI stays import-free: capability values arrive as data.
  const compiled = new WebAssembly.Module(Uint8Array.from(build.wasm).buffer as ArrayBuffer)
  expect(WebAssembly.Module.imports(compiled)).toEqual([])
  expect(WebAssembly.Module.exports(compiled).map((entry) => `${entry.kind}:${entry.name}`).sort()).toEqual([
    "function:bounded", "function:checked", "function:decorated", "function:greet", "function:labelSize",
    "function:maybeRetries", "function:pure", "function:retries", "function:verbose",
    "global:__smithers_env_0", "global:__smithers_env_1",
    "global:__smithers_payload_0", "global:__smithers_payload_1",
    "memory:__memory"
  ])

  const config = { label: "hi-", retries: 3, verbose: true }
  const locale = { suffix: "!" }
  const cases: ReadonlyArray<{
    readonly name: string
    readonly input: Record<string, unknown>
    readonly environment: Record<string, Record<string, number | boolean | string>>
    readonly exit: PortableWireExit
  }> = [
    { name: "greet", input: { name: "ada" }, environment: { Config: config }, exit: { kind: "success", value: "hi-ada" } },
    { name: "greet", input: { name: "" }, environment: { Config: { ...config, label: "" } }, exit: { kind: "success", value: "" } },
    { name: "retries", input: {}, environment: { Config: config }, exit: { kind: "success", value: 3 } },
    { name: "verbose", input: {}, environment: { Config: { ...config, verbose: false } }, exit: { kind: "success", value: false } },
    { name: "labelSize", input: {}, environment: { Config: config }, exit: { kind: "success", value: 3 } },
    // Transitive rows: `decorated` inherits Config from `greet` and adds Locale.
    { name: "decorated", input: { name: "ada" }, environment: { Config: config, Locale: locale }, exit: { kind: "success", value: "hi-ada!" } },
    { name: "bounded", input: { step: 5 }, environment: { Config: config }, exit: { kind: "success", value: 15 } },
    { name: "bounded", input: { step: 5 }, environment: { Config: { ...config, retries: 0 } }, exit: { kind: "success", value: 0 } },
    { name: "checked", input: { amount: 2 }, environment: { Config: config }, exit: { kind: "success", value: 2 } },
    {
      name: "checked",
      input: { amount: 9 },
      environment: { Config: config },
      exit: {
        kind: "failure",
        error: {
          identity: "smithers.error:example/capability#TooMany@1",
          payload: { limit: 3, reason: "hi-" }
        }
      }
    },
    { name: "maybeRetries", input: { active: false }, environment: { Config: config }, exit: { kind: "absent" } },
    { name: "maybeRetries", input: { active: true }, environment: { Config: config }, exit: { kind: "success", value: 3 } },
    // A requirement-free function takes — and demands — the empty environment.
    { name: "pure", input: { value: 4 }, environment: {}, exit: { kind: "success", value: 8 } }
  ]
  for (const entry of cases) {
    const host = executePortableTypeScript(module, entry.name, entry.input, entry.environment)
    const wasm = await executePortableWasm(build, entry.name, entry.input, entry.environment)
    expect(host.exit).toEqual(entry.exit)
    expect(wasm.exit).toEqual(entry.exit)
    expect(wasm.wireDigest).toBe(host.wireDigest)
    expect(wasm.contractDigest).toBe(host.contractDigest)
  }

  // Environment values never survive an invocation: the same instance path is
  // re-supplied per call and slots outside the selected row stay canonical.
  const first = await executePortableWasm(build, "retries", {}, { Config: { ...config, retries: 7 } })
  const second = await executePortableWasm(build, "retries", {}, { Config: { ...config, retries: 1 } })
  expect(first.exit).toEqual({ kind: "success", value: 7 })
  expect(second.exit).toEqual({ kind: "success", value: 1 })

  // A capability value flows through the string budget exactly like any other
  // string, so both runtimes defect at the same operation.
  const budget = compilePortableModule({
    moduleId: "example/capability-budget",
    source: `import { Context } from "smthrs/context"
abstract class Config extends Context { abstract readonly chunk: string }
export function grow(times: number): string {
  const config = Config.context()
  let out = ""
  let index = 0
  while (index < times) { out += config.chunk; index = index + 1 }
  return out
}`
  })
  const budgetBuild = await compilePortableWasm(budget)
  const budgetEnvironment = { Config: { chunk: "aaaaaaaaaa" } }
  const budgetHost = executePortableTypeScript(budget, "grow", { times: 400_000 }, budgetEnvironment)
  const budgetWasm = await executePortableWasm(budgetBuild, "grow", { times: 400_000 }, budgetEnvironment)
  expect(budgetHost.exit).toEqual({ kind: "defect", defect: "string-memory-exhausted" })
  expect(budgetWasm.wireDigest).toBe(budgetHost.wireDigest)

  // A string field nothing reads still needs its environment record, so the
  // module must declare memory even though no string expression exists.
  const unread = compilePortableModule({
    moduleId: "example/capability-unread",
    source: `import { Context } from "smthrs/context"
abstract class Config extends Context { abstract readonly label: string; abstract readonly retries: number }
export function value(input: number): number { return Config.context().retries + input }`
  })
  // Scalars live in globals, not memory, so a capability with no string field
  // costs a module nothing beyond the slots it actually declares.
  const scalarOnly = compilePortableModule({
    moduleId: "example/capability-scalars",
    source: `import { Context } from "smthrs/context"
abstract class Flags extends Context { abstract readonly enabled: boolean; abstract readonly scale: number }
export function value(input: number): number { const f = Flags.context(); return f.enabled ? input * f.scale : input }`
  })
  expect(emitPortableWat(scalarOnly)).not.toContain("(memory")
  const scalarBuild = await compilePortableWasm(scalarOnly)
  expect(WebAssembly.Module.exports(
    new WebAssembly.Module(Uint8Array.from(scalarBuild.wasm).buffer as ArrayBuffer)
  ).map((entry) => `${entry.kind}:${entry.name}`).sort()).toEqual([
    "function:value", "global:__smithers_env_0", "global:__smithers_env_1"
  ])
  const scalarEnvironment = { Flags: { enabled: true, scale: 3 } }
  const scalarHost = executePortableTypeScript(scalarOnly, "value", { input: 4 }, scalarEnvironment)
  const scalarWasm = await executePortableWasm(scalarBuild, "value", { input: 4 }, scalarEnvironment)
  expect(scalarHost.exit).toEqual({ kind: "success", value: 12 })
  expect(scalarWasm.wireDigest).toBe(scalarHost.wireDigest)

  expect(emitPortableWat(unread)).toContain(`(memory (export "__memory")`)
  const unreadBuild = await compilePortableWasm(unread)
  const unreadEnvironment = { Config: { label: "never read", retries: 2 } }
  const unreadHost = executePortableTypeScript(unread, "value", { input: 1 }, unreadEnvironment)
  const unreadWasm = await executePortableWasm(unreadBuild, "value", { input: 1 }, unreadEnvironment)
  expect(unreadHost.exit).toEqual({ kind: "success", value: 3 })
  expect(unreadWasm.wireDigest).toBe(unreadHost.wireDigest)
}, 240_000)

test("capability shapes needing host effects fail closed at the declaration", () => {
  const head = `import { Context } from "smthrs/context"\n`
  const capability = `${head}abstract class Config extends Context { abstract readonly retries: number }\n`

  // Clock/Random/FileSystem are exactly the shapes an import-free module cannot
  // express, and they are rejected where they are DECLARED, not at a call site.
  expect(() => compilePortableModule({
    moduleId: "hostile/clock",
    source: `${head}abstract class Clock extends Context { abstract now(): number }
export function value(input: number): number { return input }`
  })).toThrow("methods, accessors, and constructors need host effects")
  expect(() => compilePortableModule({
    moduleId: "hostile/random",
    source: `${head}abstract class Random extends Context { abstract get next(): number }
export function value(input: number): number { return input }`
  })).toThrow("methods, accessors, and constructors need host effects")
  expect(() => compilePortableModule({
    moduleId: "hostile/method-call",
    source: `${capability}export function value(input: number): number { return Config.context().toString().length + input }`
  })).toThrow("capability method calls need host effects")
  expect(() => compilePortableModule({
    moduleId: "hostile/inherited-member",
    source: `${capability}export function value(input: number): number { return Config.context().constructor === Config ? input : input }`
  })).toThrow("has no value field 'constructor'")

  // Declaration shape.
  expect(() => compilePortableModule({
    moduleId: "hostile/concrete-capability",
    source: `${head}class Config extends Context { readonly retries: number = 1 }
export function value(input: number): number { return input }`
  })).toThrow("abstract class Name extends Context")
  expect(() => compilePortableModule({
    moduleId: "hostile/generic-capability",
    source: `${head}abstract class Config<Value> extends Context { abstract readonly retries: number }
export function value(input: number): number { return input }`
  })).toThrow("abstract class Name extends Context")
  expect(() => compilePortableModule({
    moduleId: "hostile/mutable-field",
    source: `${head}abstract class Config extends Context { abstract retries: number }
export function value(input: number): number { return input }`
  })).toThrow("abstract readonly name: number|boolean|string")
  expect(() => compilePortableModule({
    moduleId: "hostile/array-field",
    source: `${head}abstract class Config extends Context { abstract readonly labels: string[] }
export function value(input: number): number { return input }`
  })).toThrow("must be exactly number, boolean, or string")
  expect(() => compilePortableModule({
    moduleId: "hostile/empty-capability",
    source: `${head}abstract class Config extends Context {}
export function value(input: number): number { return input }`
  })).toThrow("must declare 1-16 value fields")

  // A capability is never a value, and can never be fabricated.
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-value",
    source: `${capability}export function value(input: number): number { const c = Config.context(); return c === c ? input : input }`
  })).toThrow("is not a portable value")
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-class-member",
    source: `${capability}export function value(input: number): number { return Config.name.length + input }`
  })).toThrow("only accessible through Config.context()")
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-uncalled",
    source: `${capability}export function value(input: number): number { return Config.context.length + input }`
  })).toThrow("only accessible through Config.context()")
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-type-argument",
    source: `${capability}export function value(input: number): number { return Config.context<typeof Config>().retries + input }`
  })).toThrow("no arguments or type arguments")
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-let",
    source: `${capability}export function value(input: number): number { let c = Config.context(); return c.retries + input }`
  })).toThrow("must use `const`")
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-annotated",
    source: `${capability}export function value(input: number): number { const c: Config = Config.context(); return c.retries + input }`
  })).toThrow("cannot carry a type annotation")
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-construct",
    source: `${capability}export function value(input: number): number { return new Config().retries + input }`
  })).toThrow("Cannot create an instance of an abstract class")
  // An unread `.context()` would put a row entry in the IR that no `capability`
  // expression backs, so the IR could no longer describe its own row.
  expect(() => compilePortableModule({
    moduleId: "hostile/capability-unread",
    source: `${capability}export function value(input: number): number { const c = Config.context(); return input }`
  })).toThrow("never reads one of its fields")

  // The capability root is the only import, in exactly one canonical form.
  expect(() => compilePortableModule({
    moduleId: "hostile/renamed-context",
    source: `import { Context as Ctx } from "smthrs/context"
abstract class Config extends Ctx { abstract readonly retries: number }
export function value(input: number): number { return Config.context().retries + input }`
  })).toThrow("may only import { Context }")
  expect(() => compilePortableModule({
    moduleId: "hostile/namespace-context",
    source: `import * as context from "smthrs/context"
export function value(input: number): number { return input }`
  })).toThrow("may only import { Context }")
  expect(() => compilePortableModule({
    moduleId: "hostile/other-smithers-module",
    source: `import { Layer } from "smthrs/provider"
export function value(input: number): number { return input }`
  })).toThrow("may only import { Context }")
  expect(() => compilePortableModule({
    moduleId: "hostile/duplicate-context",
    source: `${head}${head}export function value(input: number): number { return input }`
  })).toThrow("at most once")
})

test("environments are validated against the declared row identically in both runtimes", async () => {
  const module = compilePortableModule({
    moduleId: "example/environment",
    source: `import { Context } from "smthrs/context"
abstract class Config extends Context {
  abstract readonly label: string
  abstract readonly retries: number
  abstract readonly verbose: boolean
}
export function value(input: number): number { return Config.context().retries + input }
export function pure(input: number): number { return input }`
  })
  const build = await compilePortableWasm(module)
  const good = { Config: { label: "x", retries: 1, verbose: true } }

  const agree = async (
    name: string,
    input: Record<string, unknown>,
    environment: unknown,
    expected: string
  ): Promise<void> => {
    let hostMessage = "accepted"
    let wasmMessage = "accepted"
    try {
      executePortableTypeScript(module, name, input, environment as never)
    } catch (error) {
      hostMessage = error instanceof Error ? error.message : String(error)
    }
    try {
      await executePortableWasm(build, name, input, environment as never)
    } catch (error) {
      wasmMessage = error instanceof Error ? error.message : String(error)
    }
    expect(hostMessage).toContain(expected)
    // Not merely both-rejected: byte-identical rejection in both runtimes.
    expect(wasmMessage).toBe(hostMessage)
  }

  await agree("value", { input: 1 }, {}, `does not match its requirement row ["Config"]; missing ["Config"]`)
  await agree("value", { input: 1 }, undefined, `does not match its requirement row ["Config"]`)
  await agree("value", { input: 1 }, { Config: good.Config, Extra: {} }, `unknown ["Extra"]`)
  // An environment richer than the row is as fatal as one that is too poor.
  await agree("pure", { input: 1 }, good, `does not match its requirement row []`)
  await agree("value", { input: 1 }, { Config: { label: "x", retries: 1 } }, "missing or unknown fields")
  await agree("value", { input: 1 }, { Config: { ...good.Config, extra: 1 } }, "missing or unknown fields")
  await agree("value", { input: 1 }, { Config: { ...good.Config, retries: "1" } }, "Config.retries must be number")
  await agree("value", { input: 1 }, { Config: { ...good.Config, verbose: 1 } }, "Config.verbose must be boolean")
  await agree("value", { input: 1 }, { Config: { ...good.Config, label: "café" } }, "printable ASCII string")
  await agree("value", { input: 1 }, { Config: { ...good.Config, label: "a".repeat(4097) } }, "printable ASCII string")
  await agree("value", { input: 1 }, { Config: null }, "must be an object of its declared fields")
  await agree("value", { input: 1 }, "nope", "must be an object of capability records")
  await agree("value", { input: 1 }, [good], "must be an object of capability records")
  await agree("value", { input: 1 }, { Config: { ...good.Config, retries: Number.NaN } }, "non-finite number")
  await agree("value", { input: 1 }, { Config: { ...good.Config, retries: -0 } }, "negative zero")
  await agree("value", { input: 1 }, { Config: { ...good.Config, retries: () => 1 } }, "not durable JSON")
}, 240_000)

test("forged capability rows and forged environment ABIs are rejected", async () => {
  const module = compilePortableModule({
    moduleId: "example/forged-capability",
    source: `import { Context } from "smthrs/context"
abstract class Config extends Context { abstract readonly retries: number }
export function value(input: number): number { return Config.context().retries + input }
export function pure(input: number): number { return input }`
  })

  const claimUnused = forgedCopy(module)
  claimUnused.functions.find((fn: Record<string, any>) => fn.name === "pure").requirements = ["Config"]
  rehashModule(claimUnused)
  expect(() => validatePortableModule(claimUnused)).toThrow("its transitive closure is []")

  const undeclaredRead = forgedCopy(module)
  undeclaredRead.functions.find((fn: Record<string, any>) => fn.name === "value").requirements = []
  rehashModule(undeclaredRead)
  expect(() => validatePortableModule(undeclaredRead)).toThrow("outside the function's declared requirement row")

  // Authority cannot be laundered through a callee whose row the caller drops.
  const launder = forgedCopy(module)
  launder.functions.find((fn: Record<string, any>) => fn.name === "pure").body = [{
    kind: "return",
    value: {
      kind: "call",
      valueType: "number",
      callee: "value",
      arguments: [{ kind: "parameter", valueType: "number", index: 0, name: "input" }]
    }
  }]
  rehashModule(launder)
  expect(() => validatePortableModule(launder)).toThrow(`declares requirement row [] but its transitive closure is ["Config"]`)

  const deadCapability = forgedCopy(module)
  const forgedValue = deadCapability.functions.find((fn: Record<string, any>) => fn.name === "value")
  forgedValue.requirements = []
  forgedValue.body = [{ kind: "return", value: { kind: "parameter", valueType: "number", index: 0, name: "input" } }]
  rehashModule(deadCapability)
  expect(() => validatePortableModule(deadCapability)).toThrow("declares capability Config that no function requires")

  const unknownField = forgedCopy(module)
  unknownField.functions.find((fn: Record<string, any>) => fn.name === "value").body[0].value.left.field = "nope"
  rehashModule(unknownField)
  expect(() => validatePortableModule(unknownField)).toThrow("reads unknown field 'nope'")

  const wrongType = forgedCopy(module)
  wrongType.capabilities[0].fields[0].valueType = "boolean"
  rehashModule(wrongType)
  expect(() => validatePortableModule(wrongType)).toThrow("capability field type mismatch")

  const forgedIdentity = forgedCopy(module)
  forgedIdentity.capabilities[0].identity = "smithers.capability:somewhere/else#Config@1"
  rehashModule(forgedIdentity)
  expect(() => validatePortableModule(forgedIdentity)).toThrow("capability identity is invalid")

  const unsorted = forgedCopy(module)
  unsorted.capabilities.push({
    name: "Alpha",
    identity: "smithers.capability:example/forged-capability#Alpha@1",
    fields: [{ name: "a", valueType: "number" }]
  })
  unsorted.functions.find((fn: Record<string, any>) => fn.name === "value").requirements = ["Config", "Alpha"]
  rehashModule(unsorted)
  expect(() => validatePortableModule(unsorted)).toThrow("capabilities must be sorted by name")

  // Format 3 modules carry no row at all, so loading one would assert
  // "requires nothing" about code whose digests never covered that claim.
  const legacy = forgedCopy(module)
  delete legacy.capabilities
  legacy.formatVersion = 3
  for (const fn of legacy.functions) delete fn.requirements
  expect(() => validatePortableModule(legacy)).toThrow("formatVersion 3 predates the format 4 capability environment ABI")

  // The export surface IS the environment descriptor: swapping in a binary
  // whose environment slots differ from the checked IR never executes.
  const wider = compilePortableModule({
    moduleId: "example/forged-capability",
    source: `import { Context } from "smthrs/context"
abstract class Config extends Context { abstract readonly retries: number; abstract readonly extra: number }
export function value(input: number): number { const c = Config.context(); return c.retries + c.extra + input }
export function pure(input: number): number { return input }`
  })
  const build = await compilePortableWasm(module)
  const widerBuild = await compilePortableWasm(wider)
  const environment = { Config: { retries: 1 } }
  await expect(executePortableWasm(withWasm(build, widerBuild.wasm), "value", { input: 1 }, environment)).rejects.toThrow(
    "exports do not match checked IR"
  )
  await expect(executePortableWasm(
    withWasm(widerBuild, build.wasm),
    "value",
    { input: 1 },
    { Config: { retries: 1, extra: 2 } }
  )).rejects.toThrow("exports do not match checked IR")
}, 240_000)
