import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertJson, canonicalJson, deepFreeze, digest } from "../durable/ir.ts"
import {
  PORTABLE_LOOP_FUEL,
  PORTABLE_STRING_HEAP_BYTES,
  PortableBackendError,
  validatePortableModule,
  type PortableCapability,
  type PortableCapabilityField,
  type PortableDefect,
  type PortableErrorVariant,
  type PortableEnvironment,
  type PortableExecution,
  type PortableExpression,
  type PortableFunctionIR,
  type PortableModuleIR,
  type PortableStatement,
  type PortableValueType,
  type PortableWireExit
} from "./portable-backend.ts"

/**
 * Bounded portable NATIVE backend (LLVM IR text -> `clang -x ir` -> executable).
 *
 * ## What this is
 *
 * A THIRD consumer of the exact same digest-bound canonical IR that
 * `portable-backend.ts` already lowers `.sm` sources into. It designs no
 * language, no type system, and no IR: it consumes `PortableModuleIR` through
 * the same `validatePortableModule` trust boundary the TypeScript evaluator and
 * the Wasm backend use, and it mirrors the Wasm trio name for name:
 *
 * | Wasm                    | Native                     |
 * | ----------------------- | -------------------------- |
 * | `emitPortableWat`       | `emitPortableLlvmIr`       |
 * | `compilePortableWasm`   | `compilePortableNative`    |
 * | `executePortableWasm`   | `executePortableNative`    |
 * | `PortableWasmBuild`     | `PortableNativeBuild`      |
 *
 * The acceptance bar is three-way differential agreement: for every supported
 * case, `executePortableTypeScript`, `executePortableWasm`, and
 * `executePortableNative` must produce byte-identical canonical
 * `PortableWireExit` values AND byte-identical `wireDigest`s. `PortableExecution`
 * is returned (not a bare `PortableWireExit`) precisely because the wire digest
 * is half of that bar and only `PortableExecution` carries it.
 *
 * ## Supported subset (deliberately bounded, and exactly the Wasm subset)
 *
 * Every `PortableExpression` and `PortableStatement` variant the Wasm backend
 * lowers is lowered here:
 *
 * - `number` (IEEE-754 `double`) and `boolean` (`i32` 0/1) scalars;
 * - interned printable-ASCII string literals in a canonical constant pool,
 *   plus host-supplied string parameters and string capability fields, all
 *   represented (exactly as in Wasm) as `i32` offsets into a single flat
 *   `@__mem` byte array holding `[u32 length LE][bytes]` records;
 * - parameters, locals (`let`/`assign`, zero-initialized exactly as Wasm
 *   locals are), statement-form `if`/`else`, `while` with a `continue` update
 *   block, `break`, `continue`;
 * - intra-module calls (`call`, `bind-call`, `tail-call`) with absence, Result
 *   tag re-mapping into the caller's declared row, and defect propagation;
 * - nominal Error variants with number/boolean/string payload fields, carried
 *   through the same `double` payload-global channel Wasm uses;
 * - Context capabilities as VALUE SERVICES: scalar fields in mutable globals,
 *   string fields as fixed records in a reserved environment region, both
 *   installed by the host before the invocation;
 * - the two canonical defects, produced at exactly the same operation as the
 *   other two runtimes: `fuel-exhausted` after `PORTABLE_LOOP_FUEL` loop
 *   CONDITION evaluations, and `string-memory-exhausted` when a concat's
 *   `4 + leftBytes + rightBytes` charge would exceed `PORTABLE_STRING_HEAP_BYTES`.
 *
 * NOT supported, and rejected with a diagnostic that names the construct rather
 * than emitting something plausible (see `SMITHERS5108`): a general heap, GC,
 * cross-module calls, and string operations beyond the above. These are
 * unimplemented in the Wasm backend too; inventing them here would destroy the
 * shared-IR symmetry that makes this reviewable. Relational (`<`/`<=`/`>`/`>=`)
 * comparison of `boolean` operands is likewise rejected: it has no valid Wasm
 * lowering either (`i32.lt` has no unsigned/signed-free form), so a module that
 * contained one could never have assembled.
 *
 * ## Fail-closed posture
 *
 * - `clang` absence/failure is an honest, specific diagnostic. Nothing here
 *   ever "passes because the toolchain was missing"; the test suite asserts a
 *   real compile happened.
 * - Every entry point runs `validatePortableModule` first, so a forged IR
 *   claiming a capability it never declares is rejected exactly as the Wasm
 *   path rejects it.
 * - `validateNativeBuild` re-emits the LLVM IR from the validated module and
 *   requires textual equality, then requires the binary digest to match the
 *   bytes, then requires the running binary to ATTEST the module digest it was
 *   built from before any result is accepted.
 * - Honest limit, stated plainly: unlike `inspectPortableWasm`, which re-parses
 *   the Wasm and re-derives its whole export surface from the IR, a Mach-O/ELF
 *   executable is opaque to us. The residual trust in `executePortableNative`
 *   is therefore the binary BYTES: a caller who fabricates a self-consistent
 *   `PortableNativeBuild` runs their own code. The IR-text check binds the
 *   build to validated IR and the attestation binds the binary to that module,
 *   which catches every mismatch, but neither is a sandbox. Execution is
 *   additionally bounded by a wall-clock timeout and an output cap.
 *
 * ## Determinism
 *
 * Same IR in, byte-identical `.ll` out, across runs and across machines. No
 * timestamps, no addresses, no temp paths, and no map-iteration order reaches
 * the text: every table is built in canonical (declaration or sorted) order,
 * SSA temporaries and block labels are sequential counters over a fixed walk,
 * and floating-point literals are emitted as LLVM's exact `0x`-prefixed 64-bit
 * bit patterns rather than as formatted decimals. NO target triple and NO
 * datalayout are emitted, so the same text compiles on any host `clang` and the
 * text itself carries nothing host-specific.
 *
 * ## Diagnostic code range
 *
 * SMITHERS5100-SMITHERS5112. Chosen because 5100-5199 is the only wholly unused
 * contiguous block adjacent to the portable backend's own 5050-5073 range (5201+
 * belongs to another subsystem), so a reader meets the native backend as an
 * immediate sibling of the portable backend it consumes rather than as an
 * unrelated island. The block is deliberately left with room to grow rather
 * than packed against the next occupied range.
 */

/** Mirrors the portable backend's private `MAX_STRING_BYTES` input bound. */
const NATIVE_MAX_STRING_BYTES = 4_096
const MAX_LLVM_IR_BYTES = 4 * 1024 * 1024
const MAX_NATIVE_BINARY_BYTES = 32 * 1024 * 1024
const HEX_DIGEST = /^[0-9a-f]{64}$/
/** Printable ASCII, so UTF-8 bytes, UTF-16 units, and code points coincide. */
const PORTABLE_STRING_CONTENT = /^[\x20-\x7e]*$/
/** Tag reserved for the canonical fuel-exhausted defect exit (as in Wasm). */
const FUEL_DEFECT_TAG = -1
/** Tag reserved for the canonical string-memory-exhausted defect exit. */
const STRING_DEFECT_TAG = -2
/** Attestation prefix the emitted binary prints before anything else. */
const ATTESTATION_PREFIX = "SMITHERS-NATIVE-1"

const fail = (code: string, message: string): never => {
  throw new PortableBackendError({ code, message, line: 1, column: 1 })
}

// ---------------------------------------------------------------------------
// IR facts and layout
//
// These mirror the portable backend's private `moduleStringFacts`,
// `moduleEnvLayout`, `moduleMemoryLayout`, `modulePayloadSlots` and
// `moduleDefectMap`. The three-way differential suite is what proves the
// re-derivation agrees: any drift shows up immediately as a canonical-exit or
// wire-digest mismatch against two independent existing implementations.
//
// A later lane owning BOTH files evaluated exporting the portable helpers and
// importing them here, and MEASURED why that is not the pure move it looks
// like. Recorded so it is not rediscovered:
//
//   - The types are not the same shape. `PortableStringFacts` carries 9 fields
//     (it also tracks `used`, `usesEq`, `usesOrder` for WAT emission) against
//     the 5 used here; `PortableEnvSlot` 6 against 4; `PortableEnvLayout` 4
//     against 2; `PortableMemoryLayout` 10 (including `pages`, a Wasm concept)
//     against 6. The narrower shapes are deliberate: this backend has no pages
//     and no `$__str_cmp` helper to condition on.
//   - The signatures differ: `moduleStringFacts(functions, capabilities)`
//     against `nativeStringFacts(module)`, and the traversal underneath is
//     `statementFacts`/`walkStatementExpressions` there against
//     `walkStatements` here.
//   - Around 90 reference sites in this file are typed against the narrow
//     shapes, and `nativeMemoryLayout` sizes `@__mem` while `wireExit` produces
//     the wire digest — so a merge that is not exactly behaviour-preserving
//     moves emitted `.ll` bytes and the digest that the whole acceptance bar
//     rests on.
//
// The wire helpers below have a further blocker of their own; see there.
// ---------------------------------------------------------------------------

interface NativeStringFacts {
  readonly entries: readonly string[]
  readonly offsets: ReadonlyMap<string, number>
  readonly poolBytes: number
  readonly usesConcat: boolean
  readonly maxStringParams: number
}

interface NativeEnvSlot {
  readonly key: string
  readonly valueType: PortableValueType
  readonly globalIndex: number
  readonly stringIndex: number
}

interface NativeEnvLayout {
  readonly slots: readonly NativeEnvSlot[]
  readonly byKey: ReadonlyMap<string, NativeEnvSlot>
}

interface NativeMemoryLayout {
  readonly inputBase: number
  readonly inputLimit: number
  readonly envBase: number
  readonly heapBase: number
  readonly heapLimit: number
  readonly memoryBytes: number
}

/** Which canonical defect exits a function can reach, transitively. */
interface NativeDefectFacts {
  readonly fuel: boolean
  readonly string: boolean
}

const walkExpression = (expression: PortableExpression, visit: (expression: PortableExpression) => void): void => {
  visit(expression)
  switch (expression.kind) {
    case "unary":
    case "string-length": return walkExpression(expression.value, visit)
    case "binary":
      walkExpression(expression.left, visit)
      return walkExpression(expression.right, visit)
    case "select":
      walkExpression(expression.condition, visit)
      walkExpression(expression.whenTrue, visit)
      return walkExpression(expression.whenFalse, visit)
    case "call": {
      for (const argument of expression.arguments) walkExpression(argument, visit)
      return
    }
    case "literal":
    case "parameter":
    case "capability":
    case "local": return
  }
}

const walkStatements = (
  statements: readonly PortableStatement[],
  visit: (statement: PortableStatement) => void,
  onExpression: (expression: PortableExpression) => void
): void => {
  for (const statement of statements) {
    visit(statement)
    switch (statement.kind) {
      case "let":
      case "assign":
      case "return":
      case "present":
        walkExpression(statement.value, onExpression)
        break
      case "bind-call":
      case "tail-call":
      case "failure":
        for (const argument of statement.arguments) walkExpression(argument, onExpression)
        break
      case "if":
        walkExpression(statement.condition, onExpression)
        walkStatements(statement.whenTrue, visit, onExpression)
        walkStatements(statement.whenFalse, visit, onExpression)
        break
      case "while":
        walkExpression(statement.condition, onExpression)
        walkStatements(statement.body, visit, onExpression)
        walkStatements(statement.update, visit, onExpression)
        break
      case "break":
      case "continue":
      case "absent":
        break
    }
  }
}

/**
 * Canonical interned literal pool: `""` pinned at offset 0 so a zero-initialized
 * string slot and the evaluator's zero value agree, then the remaining literals
 * deduplicated and sorted. Identical to the Wasm pool by construction.
 */
const nativeStringFacts = (module: PortableModuleIR): NativeStringFacts => {
  const literals = new Set<string>()
  let usesConcat = false
  let maxStringParams = 0
  for (const fn of module.functions) {
    maxStringParams = Math.max(maxStringParams, fn.parameters.filter((parameter) => parameter.valueType === "string").length)
    walkStatements(fn.body, () => {}, (expression) => {
      if (expression.kind === "literal" && expression.valueType === "string") literals.add(expression.value as string)
      if (expression.kind === "binary" && expression.operator === "concat") usesConcat = true
    })
  }
  const entries = ["", ...[...literals].filter((value) => value !== "").sort()]
  const offsets = new Map<string, number>()
  let cursor = 0
  for (const entry of entries) {
    offsets.set(entry, cursor)
    cursor += 4 + Buffer.byteLength(entry, "utf8")
  }
  return { entries, offsets, poolBytes: cursor, usesConcat, maxStringParams }
}

/** Capabilities in name order, fields in name order, scalars and strings numbered apart. */
const nativeEnvLayout = (capabilities: readonly PortableCapability[]): NativeEnvLayout => {
  const slots: NativeEnvSlot[] = []
  let globalCount = 0
  let stringCount = 0
  for (const capability of capabilities) {
    for (const field of capability.fields) {
      const isString = field.valueType === "string"
      slots.push({
        key: `${capability.name}.${field.name}`,
        valueType: field.valueType,
        globalIndex: isString ? -1 : globalCount++,
        stringIndex: isString ? stringCount++ : -1
      })
    }
  }
  return { slots, byKey: new Map(slots.map((slot) => [slot.key, slot])) }
}

const nativeMemoryLayout = (strings: NativeStringFacts, env: NativeEnvLayout): NativeMemoryLayout => {
  const inputBase = (strings.poolBytes + 3) & ~3
  const inputLimit = inputBase + strings.maxStringParams * (4 + NATIVE_MAX_STRING_BYTES)
  const envBase = inputLimit
  const envStrings = env.slots.filter((slot) => slot.valueType === "string").length
  const heapBase = envBase + envStrings * (4 + NATIVE_MAX_STRING_BYTES)
  const heapLimit = heapBase + (strings.usesConcat ? PORTABLE_STRING_HEAP_BYTES : 0)
  return { inputBase, inputLimit, envBase, heapBase, heapLimit, memoryBytes: heapLimit }
}

const envStringOffset = (layout: NativeMemoryLayout, stringIndex: number): number =>
  layout.envBase + stringIndex * (4 + NATIVE_MAX_STRING_BYTES)

const nativePayloadSlots = (module: PortableModuleIR): number => {
  let slots = 0
  for (const fn of module.functions) {
    if (fn.result.kind !== "result") continue
    for (const error of fn.result.errors) slots = Math.max(slots, error.fields.length)
  }
  return slots
}

/**
 * A function can reach `fuel-exhausted` when it contains a loop, and
 * `string-memory-exhausted` when it concatenates, in both cases transitively
 * through callees. Used only by the host DECODER, to reject a negative tag no
 * emitted code could have produced.
 */
const nativeDefectMap = (module: PortableModuleIR): ReadonlyMap<string, NativeDefectFacts> => {
  const byName = new Map(module.functions.map((fn) => [fn.name, fn]))
  const resolved = new Map<string, NativeDefectFacts>()
  const visit = (name: string): NativeDefectFacts => {
    const known = resolved.get(name)
    if (known !== undefined) return known
    const fn = byName.get(name)
    if (fn === undefined) return { fuel: false, string: false }
    let fuel = false
    let string = false
    const callees: string[] = []
    walkStatements(fn.body, (statement) => {
      if (statement.kind === "while") fuel = true
      if (statement.kind === "bind-call" || statement.kind === "tail-call") callees.push(statement.callee)
    }, (expression) => {
      if (expression.kind === "binary" && expression.operator === "concat") string = true
      if (expression.kind === "call") callees.push(expression.callee)
    })
    // Seed before recursing so a (validator-rejected) cycle terminates instead
    // of spinning; the portable validator already forbids recursion outright.
    resolved.set(name, { fuel: false, string: false })
    for (const callee of callees) {
      const nested = visit(callee)
      fuel = fuel || nested.fuel
      string = string || nested.string
    }
    const facts: NativeDefectFacts = { fuel, string }
    resolved.set(name, facts)
    return facts
  }
  for (const fn of module.functions) visit(fn.name)
  return resolved
}

// ---------------------------------------------------------------------------
// LLVM text helpers
// ---------------------------------------------------------------------------

/** LLVM type for a portable value: strings are `i32` offsets into `@__mem`. */
const llvmType = (type: PortableValueType): "double" | "i32" => type === "number" ? "double" : "i32"

const llvmResultType = (fn: PortableFunctionIR): string => `{ i32, ${llvmType(fn.result.valueType)} }`

/**
 * Exact IEEE-754 bit pattern in LLVM's hexadecimal float syntax. Formatted
 * decimals would make the emitted text depend on a printer; the bit pattern
 * cannot lose or gain a single ulp and is byte-stable across machines.
 */
const llvmDouble = (value: number): string => {
  if (!Number.isFinite(value) || Object.is(value, -0)) {
    return fail("SMITHERS5100", "native numeric literal is outside the portable wire domain")
  }
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value, false)
  let hex = ""
  for (let index = 0; index < 8; index += 1) hex += view.getUint8(index).toString(16).padStart(2, "0")
  return `0x${hex.toUpperCase()}`
}

const llvmZero = (type: PortableValueType): string => type === "number" ? llvmDouble(0) : "0"

/** Escape bytes for an LLVM `c"..."` constant, keeping the declared length exact. */
const llvmBytes = (bytes: Uint8Array | readonly number[]): string => {
  let out = ""
  for (const byte of bytes) {
    out += byte >= 0x20 && byte <= 0x7e && byte !== 0x22 && byte !== 0x5c
      ? String.fromCharCode(byte)
      : `\\${byte.toString(16).padStart(2, "0")}`
  }
  return out
}

const llvmCString = (name: string, text: string): string => {
  const bytes = [...Buffer.from(text, "utf8"), 0]
  return `@${name} = private unnamed_addr constant [${bytes.length} x i8] c"${llvmBytes(bytes)}"`
}

/** Pool bytes: `[u32 length LE][ASCII bytes]` per entry, exactly as in Wasm. */
const poolBytes = (strings: NativeStringFacts): Uint8Array => {
  const bytes: number[] = []
  for (const entry of strings.entries) {
    const encoded = Buffer.from(entry, "utf8")
    bytes.push(
      encoded.byteLength & 0xff,
      (encoded.byteLength >>> 8) & 0xff,
      (encoded.byteLength >>> 16) & 0xff,
      (encoded.byteLength >>> 24) & 0xff,
      ...encoded
    )
  }
  return Uint8Array.from(bytes)
}

/**
 * Straight-line LLVM body builder.
 *
 * Locals, parameters, and every lazily-evaluated temporary live in `alloca`
 * slots so emission never needs to construct phi nodes, and every `alloca` is
 * HOISTED into the entry block: a temporary allocated inside a loop body would
 * otherwise grow the stack once per iteration and a fuel-bounded loop runs a
 * million of them.
 */
class NativeBody {
  readonly #allocas: string[] = []
  readonly #lines: string[] = []
  #temp = 0
  #label = 0
  #sealed = false

  temp(): string {
    this.#temp += 1
    return `%t${this.#temp}`
  }

  label(prefix: string): string {
    this.#label += 1
    return `${prefix}.${this.#label}`
  }

  alloca(type: string): string {
    const slot = this.temp()
    this.#allocas.push(`  ${slot} = alloca ${type}, align 8`)
    return slot
  }

  named(slot: string, type: string): void {
    this.#allocas.push(`  ${slot} = alloca ${type}, align 8`)
  }

  emit(instruction: string): void {
    // A sealed block already has its terminator. Anything emitted after it is
    // unreachable, but must still live in a well-formed block, so open one.
    if (this.#sealed) {
      this.#lines.push(`${this.label("unreached")}:`)
      this.#sealed = false
    }
    this.#lines.push(`  ${instruction}`)
  }

  terminate(instruction: string): void {
    this.emit(instruction)
    this.#sealed = true
  }

  /** Open `label`, falling through from the current block when it is still open. */
  block(label: string): void {
    if (!this.#sealed) this.#lines.push(`  br label %${label}`)
    this.#lines.push(`${label}:`)
    this.#sealed = false
  }

  get sealed(): boolean {
    return this.#sealed
  }

  render(): string {
    const tail = this.#sealed ? [] : ["  unreachable"]
    return ["entry:", ...this.#allocas, ...this.#lines, ...tail].join("\n")
  }
}

interface NativeLoop {
  readonly breakLabel: string
  readonly continueLabel: string
}

interface NativeContext {
  readonly fn: PortableFunctionIR
  readonly functionsByName: ReadonlyMap<string, PortableFunctionIR>
  readonly strings: NativeStringFacts
  readonly env: NativeEnvLayout
  readonly layout: NativeMemoryLayout
  readonly body: NativeBody
  readonly loops: NativeLoop[]
}

const paramSlot = (name: string): string => `%pv.${name}`
const localSlot = (name: string): string => `%lv.${name}`

/** `ret { i32, T } { tag, value }` for the CURRENT function's result type. */
const emitReturn = (context: NativeContext, tag: string, value: string): void => {
  const resultType = llvmResultType(context.fn)
  const valueType = llvmType(context.fn.result.valueType)
  const first = context.body.temp()
  const second = context.body.temp()
  context.body.emit(`${first} = insertvalue ${resultType} undef, i32 ${tag}, 0`)
  context.body.emit(`${second} = insertvalue ${resultType} ${first}, ${valueType} ${value}, 1`)
  context.body.terminate(`ret ${resultType} ${second}`)
}

/** Early exit carrying a defect out of the current function, dummy value in tow. */
const emitDefectReturn = (context: NativeContext, tag: string): void =>
  emitReturn(context, tag, llvmZero(context.fn.result.valueType))

/** i32 0/1 truth value -> i1 for a branch. */
const emitTruth = (context: NativeContext, value: string): string => {
  const bit = context.body.temp()
  context.body.emit(`${bit} = icmp ne i32 ${value}, 0`)
  return bit
}

const emitMemPointer = (context: NativeContext, offset: string): string => {
  const pointer = context.body.temp()
  context.body.emit(`${pointer} = getelementptr i8, ptr @__mem, i32 ${offset}`)
  return pointer
}

const emitExpression = (expression: PortableExpression, context: NativeContext): string => {
  const body = context.body
  switch (expression.kind) {
    case "literal": {
      if (expression.valueType === "number") return llvmDouble(expression.value as number)
      if (expression.valueType === "boolean") return expression.value === true ? "1" : "0"
      const offset = context.strings.offsets.get(expression.value as string)
      if (offset === undefined) return fail("SMITHERS5100", "native string literal is missing from the interned pool")
      return String(offset)
    }
    case "parameter":
    case "local": {
      const slot = expression.kind === "parameter" ? paramSlot(expression.name) : localSlot(expression.name)
      const value = body.temp()
      body.emit(`${value} = load ${llvmType(expression.valueType)}, ptr ${slot}, align 8`)
      return value
    }
    case "capability": {
      const slot = context.env.byKey.get(`${expression.capability}.${expression.field}`)
      if (slot === undefined || slot.valueType !== expression.valueType) {
        return fail("SMITHERS5100", `native capability read ${expression.capability}.${expression.field} has no environment slot`)
      }
      // String fields sit at a compile-time constant offset; scalars live in a
      // mutable global the host writes before the invocation.
      if (slot.valueType === "string") return String(envStringOffset(context.layout, slot.stringIndex))
      const value = body.temp()
      body.emit(`${value} = load ${llvmType(slot.valueType)}, ptr @__env_${slot.globalIndex}, align 8`)
      return value
    }
    case "string-length": {
      const offset = emitExpression(expression.value, context)
      const length = body.temp()
      const widened = body.temp()
      body.emit(`${length} = call i32 @__str_len(i32 ${offset})`)
      body.emit(`${widened} = uitofp i32 ${length} to double`)
      return widened
    }
    case "unary": {
      const value = emitExpression(expression.value, context)
      if (expression.operator === "positive") return value
      if (expression.operator === "not") {
        const zero = body.temp()
        const result = body.temp()
        body.emit(`${zero} = icmp eq i32 ${value}, 0`)
        body.emit(`${result} = zext i1 ${zero} to i32`)
        return result
      }
      const negated = body.temp()
      body.emit(`${negated} = fneg double ${value}`)
      return negated
    }
    case "select": {
      // Lazy in both other runtimes (`?:` in TypeScript, `(if (result T) ...)`
      // in Wasm), so the arms must not both be evaluated.
      const type = llvmType(expression.valueType)
      const slot = body.alloca(type)
      const condition = emitExpression(expression.condition, context)
      const bit = emitTruth(context, condition)
      const whenTrue = body.label("sel.true")
      const whenFalse = body.label("sel.false")
      const join = body.label("sel.join")
      body.terminate(`br i1 ${bit}, label %${whenTrue}, label %${whenFalse}`)
      body.block(whenTrue)
      body.emit(`store ${type} ${emitExpression(expression.whenTrue, context)}, ptr ${slot}, align 8`)
      body.terminate(`br label %${join}`)
      body.block(whenFalse)
      body.emit(`store ${type} ${emitExpression(expression.whenFalse, context)}, ptr ${slot}, align 8`)
      body.terminate(`br label %${join}`)
      body.block(join)
      const result = body.temp()
      body.emit(`${result} = load ${type}, ptr ${slot}, align 8`)
      return result
    }
    case "call": {
      const callee = context.functionsByName.get(expression.callee)
      if (callee === undefined) return fail("SMITHERS5100", `native call has no callee ${expression.callee}`)
      const callArguments = expression.arguments.map((argument) => ({
        type: llvmType(argument.valueType),
        value: emitExpression(argument, context)
      }))
      const call = emitCall(context, callee, callArguments)
      // A plain callee can still report a defect through the uniform tagged
      // ABI; thread its exact tag out so the defect KIND survives every hop.
      const bad = body.temp()
      const propagate = body.label("call.defect")
      const ok = body.label("call.ok")
      body.emit(`${bad} = icmp ne i32 ${call.tag}, 0`)
      body.terminate(`br i1 ${bad}, label %${propagate}, label %${ok}`)
      body.block(propagate)
      emitDefectReturn(context, call.tag)
      body.block(ok)
      return call.value
    }
    case "binary": {
      if (expression.operator === "and" || expression.operator === "or") {
        // Short-circuit, matching `&&`/`||` and Wasm's `(if (result i32) ...)`.
        const slot = body.alloca("i32")
        const left = emitExpression(expression.left, context)
        const bit = emitTruth(context, left)
        const evaluate = body.label("logic.rhs")
        const shortcut = body.label("logic.short")
        const join = body.label("logic.join")
        body.terminate(expression.operator === "and"
          ? `br i1 ${bit}, label %${evaluate}, label %${shortcut}`
          : `br i1 ${bit}, label %${shortcut}, label %${evaluate}`)
        body.block(evaluate)
        body.emit(`store i32 ${emitExpression(expression.right, context)}, ptr ${slot}, align 8`)
        body.terminate(`br label %${join}`)
        body.block(shortcut)
        body.emit(`store i32 ${expression.operator === "and" ? 0 : 1}, ptr ${slot}, align 8`)
        body.terminate(`br label %${join}`)
        body.block(join)
        const result = body.temp()
        body.emit(`${result} = load i32, ptr ${slot}, align 8`)
        return result
      }
      const left = emitExpression(expression.left, context)
      const right = emitExpression(expression.right, context)
      if (expression.operator === "concat") {
        const allocated = body.temp()
        const exhausted = body.temp()
        const defect = body.label("concat.defect")
        const ok = body.label("concat.ok")
        body.emit(`${allocated} = call i32 @__concat(i32 ${left}, i32 ${right})`)
        body.emit(`${exhausted} = icmp slt i32 ${allocated}, 0`)
        body.terminate(`br i1 ${exhausted}, label %${defect}, label %${ok}`)
        body.block(defect)
        emitDefectReturn(context, String(STRING_DEFECT_TAG))
        body.block(ok)
        return allocated
      }
      if (expression.left.valueType === "string") return emitStringComparison(context, expression.operator, left, right)
      if (expression.left.valueType === "boolean") {
        const predicate = expression.operator === "eq" ? "eq" : expression.operator === "neq" ? "ne" : undefined
        if (predicate === undefined) {
          return fail(
            "SMITHERS5108",
            `native backend does not lower the '${expression.operator}' operator over boolean operands ` +
            "(it has no valid Wasm lowering either, so no assembled module can contain one)"
          )
        }
        const compared = body.temp()
        const widened = body.temp()
        body.emit(`${compared} = icmp ${predicate} i32 ${left}, ${right}`)
        body.emit(`${widened} = zext i1 ${compared} to i32`)
        return widened
      }
      const arithmetic = ({ add: "fadd", subtract: "fsub", multiply: "fmul", divide: "fdiv" } as const)[
        expression.operator as "add" | "subtract" | "multiply" | "divide"
      ]
      if (arithmetic !== undefined) {
        const result = body.temp()
        body.emit(`${result} = ${arithmetic} double ${left}, ${right}`)
        return result
      }
      // Ordered predicates for </<=/>/>= and eq, unordered for neq: exactly
      // Wasm's f64 comparison semantics, and exactly JavaScript's, so a NaN
      // from `0/0` compares identically in all three runtimes.
      const predicate = ({ eq: "oeq", neq: "une", lt: "olt", lte: "ole", gt: "ogt", gte: "oge" } as const)[
        expression.operator as "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
      ]
      if (predicate === undefined) return fail("SMITHERS5108", `native backend does not lower the '${expression.operator}' operator`)
      const compared = body.temp()
      const widened = body.temp()
      body.emit(`${compared} = fcmp ${predicate} double ${left}, ${right}`)
      body.emit(`${widened} = zext i1 ${compared} to i32`)
      return widened
    }
  }
}

const emitStringComparison = (
  context: NativeContext,
  operator: string,
  left: string,
  right: string
): string => {
  const body = context.body
  if (operator === "eq" || operator === "neq") {
    const equal = body.temp()
    body.emit(`${equal} = call i32 @__str_eq(i32 ${left}, i32 ${right})`)
    if (operator === "eq") return equal
    const zero = body.temp()
    const widened = body.temp()
    body.emit(`${zero} = icmp eq i32 ${equal}, 0`)
    body.emit(`${widened} = zext i1 ${zero} to i32`)
    return widened
  }
  const predicate = ({ lt: "slt", lte: "sle", gt: "sgt", gte: "sge" } as const)[operator as "lt" | "lte" | "gt" | "gte"]
  if (predicate === undefined) return fail("SMITHERS5108", `native backend does not lower the string operator '${operator}'`)
  const ordering = body.temp()
  const compared = body.temp()
  const widened = body.temp()
  body.emit(`${ordering} = call i32 @__str_cmp(i32 ${left}, i32 ${right})`)
  body.emit(`${compared} = icmp ${predicate} i32 ${ordering}, 0`)
  body.emit(`${widened} = zext i1 ${compared} to i32`)
  return widened
}

interface NativeCall {
  readonly tag: string
  readonly value: string
}

const emitCall = (
  context: NativeContext,
  callee: PortableFunctionIR,
  callArguments: readonly { readonly type: string; readonly value: string }[]
): NativeCall => {
  const body = context.body
  const resultType = llvmResultType(callee)
  const returned = body.temp()
  const tag = body.temp()
  const value = body.temp()
  const rendered = callArguments.map((argument) => `${argument.type} ${argument.value}`).join(", ")
  body.emit(`${returned} = call ${resultType} @__impl_${callee.name}(${rendered})`)
  body.emit(`${tag} = extractvalue ${resultType} ${returned}, 0`)
  body.emit(`${value} = extractvalue ${resultType} ${returned}, 1`)
  return { tag, value }
}

/**
 * Propagate a callee's non-success exits out of the caller, mirroring
 * `watPropagation`: negative tags are defects and are forwarded UNCHANGED so
 * the defect kind survives; absence exits an Optional caller; declared Result
 * tags are re-mapped into the caller's own declared row.
 */
const emitPropagation = (context: NativeContext, callee: PortableFunctionIR, tag: string): void => {
  const body = context.body
  const defect = body.label("prop.defect")
  const live = body.label("prop.live")
  const isDefect = body.temp()
  body.emit(`${isDefect} = icmp slt i32 ${tag}, 0`)
  body.terminate(`br i1 ${isDefect}, label %${defect}, label %${live}`)
  body.block(defect)
  emitDefectReturn(context, tag)
  body.block(live)

  if (callee.result.kind === "optional") {
    const absent = body.label("prop.absent")
    const present = body.label("prop.present")
    const bad = body.label("prop.bad")
    const isAbsent = body.temp()
    const isPresent = body.temp()
    body.emit(`${isAbsent} = icmp eq i32 ${tag}, 0`)
    body.terminate(`br i1 ${isAbsent}, label %${absent}, label %${present}`)
    body.block(absent)
    emitReturn(context, "0", llvmZero(context.fn.result.valueType))
    body.block(present)
    body.emit(`${isPresent} = icmp eq i32 ${tag}, 1`)
    const ok = body.label("prop.ok")
    body.terminate(`br i1 ${isPresent}, label %${ok}, label %${bad}`)
    body.block(bad)
    body.terminate("unreachable")
    body.block(ok)
    return
  }

  const callerErrors = context.fn.result.kind === "result" ? context.fn.result.errors : []
  const callerTagByIdentity = new Map(callerErrors.map((error) => [error.identity, error.tag]))
  if (callee.result.kind === "result") {
    for (const error of callee.result.errors) {
      const callerTag = callerTagByIdentity.get(error.identity)
      if (callerTag === undefined) {
        return fail("SMITHERS5100", `native caller ${context.fn.name} cannot carry callee error ${error.identity}`)
      }
      const match = body.temp()
      const remap = body.label("prop.remap")
      const next = body.label("prop.next")
      body.emit(`${match} = icmp eq i32 ${tag}, ${error.tag}`)
      body.terminate(`br i1 ${match}, label %${remap}, label %${next}`)
      body.block(remap)
      emitReturn(context, String(callerTag), llvmZero(context.fn.result.valueType))
      body.block(next)
    }
  }
  const isSuccess = body.temp()
  const ok = body.label("prop.ok")
  const bad = body.label("prop.bad")
  body.emit(`${isSuccess} = icmp eq i32 ${tag}, 0`)
  body.terminate(`br i1 ${isSuccess}, label %${ok}, label %${bad}`)
  body.block(bad)
  body.terminate("unreachable")
  body.block(ok)
}

const emitStatements = (statements: readonly PortableStatement[], context: NativeContext): void => {
  for (const statement of statements) emitStatement(statement, context)
}

const emitStatement = (statement: PortableStatement, context: NativeContext): void => {
  const body = context.body
  switch (statement.kind) {
    case "let":
    case "assign": {
      const value = emitExpression(statement.value, context)
      body.emit(`store ${llvmType(statement.valueType)} ${value}, ptr ${localSlot(statement.name)}, align 8`)
      return
    }
    case "bind-call": {
      const callee = context.functionsByName.get(statement.callee)
      if (callee === undefined) return fail("SMITHERS5100", `native bind-call has no callee ${statement.callee}`)
      const callArguments = statement.arguments.map((argument) => ({
        type: llvmType(argument.valueType),
        value: emitExpression(argument, context)
      }))
      const call = emitCall(context, callee, callArguments)
      emitPropagation(context, callee, call.tag)
      body.emit(`store ${llvmType(callee.result.valueType)} ${call.value}, ptr ${localSlot(statement.name)}, align 8`)
      return
    }
    case "tail-call": {
      const callee = context.functionsByName.get(statement.callee)
      if (callee === undefined) return fail("SMITHERS5100", `native tail-call has no callee ${statement.callee}`)
      const callArguments = statement.arguments.map((argument) => ({
        type: llvmType(argument.valueType),
        value: emitExpression(argument, context)
      }))
      const call = emitCall(context, callee, callArguments)
      emitPropagation(context, callee, call.tag)
      emitReturn(context, callee.result.kind === "optional" ? "1" : "0", call.value)
      return
    }
    case "if": {
      const condition = emitExpression(statement.condition, context)
      const bit = emitTruth(context, condition)
      const whenTrue = body.label("if.then")
      const whenFalse = body.label("if.else")
      const join = body.label("if.join")
      body.terminate(`br i1 ${bit}, label %${whenTrue}, label %${whenFalse}`)
      body.block(whenTrue)
      emitStatements(statement.whenTrue, context)
      if (!body.sealed) body.terminate(`br label %${join}`)
      body.block(whenFalse)
      emitStatements(statement.whenFalse, context)
      if (!body.sealed) body.terminate(`br label %${join}`)
      body.block(join)
      return
    }
    case "while": {
      const head = body.label("loop.head")
      const inner = body.label("loop.body")
      const update = body.label("loop.update")
      const exit = body.label("loop.exit")
      const starved = body.label("loop.starved")
      const alive = body.label("loop.alive")
      body.block(head)
      // Fuel is charged per CONDITION evaluation, before the condition runs,
      // exactly where the evaluator and Wasm charge it.
      const fuel = body.temp()
      const empty = body.temp()
      body.emit(`${fuel} = load i32, ptr @__fuel, align 4`)
      body.emit(`${empty} = icmp slt i32 ${fuel}, 1`)
      body.terminate(`br i1 ${empty}, label %${starved}, label %${alive}`)
      body.block(starved)
      emitDefectReturn(context, String(FUEL_DEFECT_TAG))
      body.block(alive)
      const spent = body.temp()
      body.emit(`${spent} = sub i32 ${fuel}, 1`)
      body.emit(`store i32 ${spent}, ptr @__fuel, align 4`)
      const condition = emitExpression(statement.condition, context)
      const bit = emitTruth(context, condition)
      body.terminate(`br i1 ${bit}, label %${inner}, label %${exit}`)
      body.block(inner)
      context.loops.push({ breakLabel: exit, continueLabel: update })
      emitStatements(statement.body, context)
      context.loops.pop()
      if (!body.sealed) body.terminate(`br label %${update}`)
      body.block(update)
      // The update block is also the `continue` target, matching the
      // evaluator's "run updates, then re-test" and Wasm's $__continue block.
      emitStatements(statement.update, context)
      if (!body.sealed) body.terminate(`br label %${head}`)
      body.block(exit)
      return
    }
    case "break":
    case "continue": {
      const loop = context.loops[context.loops.length - 1]
      if (loop === undefined) return fail("SMITHERS5100", `native ${statement.kind} appears outside a loop`)
      body.terminate(`br label %${statement.kind === "break" ? loop.breakLabel : loop.continueLabel}`)
      return
    }
    case "return":
      return emitReturn(context, "0", emitExpression(statement.value, context))
    case "present":
      return emitReturn(context, "1", emitExpression(statement.value, context))
    case "absent":
      return emitReturn(context, "0", llvmZero(context.fn.result.valueType))
    case "failure": {
      const variant = context.fn.result.kind === "result"
        ? context.fn.result.errors.find((error) => error.identity === statement.identity)
        : undefined
      if (variant === undefined) return fail("SMITHERS5100", "native failure outside its declaring Result row")
      statement.arguments.forEach((argument, index) => {
        const field = variant.fields[index]
        if (field === undefined) return fail("SMITHERS5100", `native failure ${statement.identity} has no field at ${index}`)
        const value = emitExpression(argument, context)
        // Payloads travel through `double` globals exactly as in Wasm; i32
        // booleans and string offsets widen through an exact unsigned convert.
        let stored = value
        if (field.valueType !== "number") {
          stored = body.temp()
          body.emit(`${stored} = uitofp i32 ${value} to double`)
        }
        body.emit(`store double ${stored}, ptr @__payload_${index}, align 8`)
      })
      emitReturn(context, String(statement.tag), llvmZero(context.fn.result.valueType))
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Fixed runtime helpers
// ---------------------------------------------------------------------------

/**
 * Byte-for-byte string equality, byte-lexicographic ordering returning -1/0/1,
 * a bump allocator charging exactly `4 + leftBytes + rightBytes`, and the byte
 * copier they share. Direct transliterations of `$__str_eq`, `$__str_cmp`,
 * `$__concat`, and `$__copy`.
 *
 * Pointer identity is only a fast path: host-written parameters and concat
 * results are NOT interned, so equal content at different offsets still
 * compares equal. None of these loops charge fuel, because fuel measures author
 * loop-condition evaluations only and the other two runtimes do not charge
 * them either, so all three exhaust their budgets at exactly the same operation.
 */
const runtimeHelpers = (layout: NativeMemoryLayout): readonly string[] => [
  `define internal void @__copy(ptr %dst, ptr %src, i32 %n) {`,
  `entry:`,
  `  %i = alloca i32, align 4`,
  `  store i32 0, ptr %i, align 4`,
  `  br label %cond`,
  `cond:`,
  `  %iv = load i32, ptr %i, align 4`,
  `  %more = icmp ult i32 %iv, %n`,
  `  br i1 %more, label %body, label %done`,
  `body:`,
  `  %sp = getelementptr i8, ptr %src, i32 %iv`,
  `  %byte = load i8, ptr %sp, align 1`,
  `  %dp = getelementptr i8, ptr %dst, i32 %iv`,
  `  store i8 %byte, ptr %dp, align 1`,
  `  %next = add i32 %iv, 1`,
  `  store i32 %next, ptr %i, align 4`,
  `  br label %cond`,
  `done:`,
  `  ret void`,
  `}`,
  ``,
  `define internal i32 @__str_len(i32 %off) {`,
  `entry:`,
  `  %p = getelementptr i8, ptr @__mem, i32 %off`,
  `  %n = load i32, ptr %p, align 1`,
  `  ret i32 %n`,
  `}`,
  ``,
  `define internal i32 @__byte_at(i32 %off, i32 %i) {`,
  `entry:`,
  `  %base = add i32 %off, 4`,
  `  %at = add i32 %base, %i`,
  `  %p = getelementptr i8, ptr @__mem, i32 %at`,
  `  %byte = load i8, ptr %p, align 1`,
  `  %wide = zext i8 %byte to i32`,
  `  ret i32 %wide`,
  `}`,
  ``,
  `define internal i32 @__str_eq(i32 %a, i32 %b) {`,
  `entry:`,
  `  %i = alloca i32, align 4`,
  `  store i32 0, ptr %i, align 4`,
  `  %same = icmp eq i32 %a, %b`,
  `  br i1 %same, label %yes, label %lengths`,
  `lengths:`,
  `  %na = call i32 @__str_len(i32 %a)`,
  `  %nb = call i32 @__str_len(i32 %b)`,
  `  %differ = icmp ne i32 %na, %nb`,
  `  br i1 %differ, label %no, label %cond`,
  `cond:`,
  `  %iv = load i32, ptr %i, align 4`,
  `  %more = icmp ult i32 %iv, %na`,
  `  br i1 %more, label %body, label %yes`,
  `body:`,
  `  %ca = call i32 @__byte_at(i32 %a, i32 %iv)`,
  `  %cb = call i32 @__byte_at(i32 %b, i32 %iv)`,
  `  %ne = icmp ne i32 %ca, %cb`,
  `  br i1 %ne, label %no, label %next`,
  `next:`,
  `  %step = add i32 %iv, 1`,
  `  store i32 %step, ptr %i, align 4`,
  `  br label %cond`,
  `yes:`,
  `  ret i32 1`,
  `no:`,
  `  ret i32 0`,
  `}`,
  ``,
  `define internal i32 @__str_cmp(i32 %a, i32 %b) {`,
  `entry:`,
  `  %i = alloca i32, align 4`,
  `  store i32 0, ptr %i, align 4`,
  `  %same = icmp eq i32 %a, %b`,
  `  br i1 %same, label %equal, label %lengths`,
  `lengths:`,
  `  %na = call i32 @__str_len(i32 %a)`,
  `  %nb = call i32 @__str_len(i32 %b)`,
  `  %shorter = icmp ult i32 %na, %nb`,
  `  %n = select i1 %shorter, i32 %na, i32 %nb`,
  `  br label %cond`,
  `cond:`,
  `  %iv = load i32, ptr %i, align 4`,
  `  %more = icmp ult i32 %iv, %n`,
  `  br i1 %more, label %body, label %tail`,
  `body:`,
  `  %ca = call i32 @__byte_at(i32 %a, i32 %iv)`,
  `  %cb = call i32 @__byte_at(i32 %b, i32 %iv)`,
  `  %lt = icmp ult i32 %ca, %cb`,
  `  br i1 %lt, label %less, label %maybegt`,
  `maybegt:`,
  `  %gt = icmp ugt i32 %ca, %cb`,
  `  br i1 %gt, label %greater, label %next`,
  `next:`,
  `  %step = add i32 %iv, 1`,
  `  store i32 %step, ptr %i, align 4`,
  `  br label %cond`,
  `tail:`,
  `  %shortA = icmp ult i32 %na, %nb`,
  `  br i1 %shortA, label %less, label %maybelong`,
  `maybelong:`,
  `  %longA = icmp ugt i32 %na, %nb`,
  `  br i1 %longA, label %greater, label %equal`,
  `less:`,
  `  ret i32 -1`,
  `greater:`,
  `  ret i32 1`,
  `equal:`,
  `  ret i32 0`,
  `}`,
  ``,
  `define internal i32 @__concat(i32 %a, i32 %b) {`,
  `entry:`,
  `  %na = call i32 @__str_len(i32 %a)`,
  `  %nb = call i32 @__str_len(i32 %b)`,
  `  %content = add i32 %na, %nb`,
  `  %need = add i32 4, %content`,
  `  %heap = load i32, ptr @__heap, align 4`,
  `  %after = add i32 %heap, %need`,
  `  %over = icmp ugt i32 %after, ${layout.heapLimit}`,
  `  br i1 %over, label %exhausted, label %allocate`,
  `exhausted:`,
  `  ret i32 -1`,
  `allocate:`,
  `  store i32 %after, ptr @__heap, align 4`,
  `  %hp = getelementptr i8, ptr @__mem, i32 %heap`,
  `  store i32 %content, ptr %hp, align 1`,
  `  %dst0off = add i32 %heap, 4`,
  `  %dst0 = getelementptr i8, ptr @__mem, i32 %dst0off`,
  `  %src0off = add i32 %a, 4`,
  `  %src0 = getelementptr i8, ptr @__mem, i32 %src0off`,
  `  call void @__copy(ptr %dst0, ptr %src0, i32 %na)`,
  `  %dst1off = add i32 %dst0off, %na`,
  `  %dst1 = getelementptr i8, ptr @__mem, i32 %dst1off`,
  `  %src1off = add i32 %b, 4`,
  `  %src1 = getelementptr i8, ptr @__mem, i32 %src1off`,
  `  call void @__copy(ptr %dst1, ptr %src1, i32 %nb)`,
  `  ret i32 %heap`,
  `}`,
  ``,
  `define internal i64 @__arg_hex(ptr %argv, i32 %idx) {`,
  `entry:`,
  `  %p = getelementptr ptr, ptr %argv, i32 %idx`,
  `  %s = load ptr, ptr %p, align 8`,
  `  %v = call i64 @strtoull(ptr %s, ptr null, i32 16)`,
  `  ret i64 %v`,
  `}`,
  ``,
  `define internal void @__arg_str(ptr %argv, i32 %idx, i32 %dest) {`,
  `entry:`,
  `  %p = getelementptr ptr, ptr %argv, i32 %idx`,
  `  %s = load ptr, ptr %p, align 8`,
  `  %n64 = call i64 @strlen(ptr %s)`,
  `  %n = trunc i64 %n64 to i32`,
  `  %tooLong = icmp ugt i32 %n, ${NATIVE_MAX_STRING_BYTES}`,
  `  br i1 %tooLong, label %reject, label %write`,
  `reject:`,
  `  call void @exit(i32 4)`,
  `  unreachable`,
  `write:`,
  `  %hp = getelementptr i8, ptr @__mem, i32 %dest`,
  `  store i32 %n, ptr %hp, align 1`,
  `  %contentOff = add i32 %dest, 4`,
  `  %content = getelementptr i8, ptr @__mem, i32 %contentOff`,
  `  call void @__copy(ptr %content, ptr %s, i32 %n)`,
  `  ret void`,
  `}`,
  ``,
  `define internal void @__print_num(double %v) {`,
  `entry:`,
  `  %bits = bitcast double %v to i64`,
  `  call i32 (ptr, ...) @printf(ptr @.fmt.hex, i64 %bits)`,
  `  ret void`,
  `}`,
  ``,
  `define internal void @__print_bool(i32 %v) {`,
  `entry:`,
  `  call i32 (ptr, ...) @printf(ptr @.fmt.dec, i32 %v)`,
  `  ret void`,
  `}`,
  ``,
  // Bounds are re-checked against the IR-derived memory size here as well as on
  // the host: an offset that could not have come from emitted code aborts the
  // process rather than reading whatever bytes follow the array.
  `define internal void @__print_str(i32 %off) {`,
  `entry:`,
  `  %i = alloca i32, align 4`,
  `  store i32 0, ptr %i, align 4`,
  `  %off64 = zext i32 %off to i64`,
  `  %headEnd = add i64 %off64, 4`,
  `  %headBad = icmp ugt i64 %headEnd, ${layout.memoryBytes}`,
  `  br i1 %headBad, label %reject, label %header`,
  `header:`,
  `  %n = call i32 @__str_len(i32 %off)`,
  `  %n64 = zext i32 %n to i64`,
  `  %tailEnd = add i64 %headEnd, %n64`,
  `  %tailBad = icmp ugt i64 %tailEnd, ${layout.memoryBytes}`,
  `  br i1 %tailBad, label %reject, label %emit`,
  `reject:`,
  `  call void @exit(i32 5)`,
  `  unreachable`,
  `emit:`,
  `  call i32 (ptr, ...) @printf(ptr @.fmt.dec, i32 %n)`,
  `  br label %cond`,
  `cond:`,
  `  %iv = load i32, ptr %i, align 4`,
  `  %more = icmp ult i32 %iv, %n`,
  `  br i1 %more, label %body, label %done`,
  `body:`,
  `  %byte = call i32 @__byte_at(i32 %off, i32 %iv)`,
  `  call i32 @putchar(i32 %byte)`,
  `  %step = add i32 %iv, 1`,
  `  store i32 %step, ptr %i, align 4`,
  `  br label %cond`,
  `done:`,
  `  call i32 @putchar(i32 10)`,
  `  ret void`,
  `}`
]

/** Print one portable value in the canonical stdout protocol for its type. */
const emitPrintValue = (type: PortableValueType, value: string): string =>
  type === "number"
    ? `  call void @__print_num(double ${value})`
    : type === "boolean"
      ? `  call void @__print_bool(i32 ${value})`
      : `  call void @__print_str(i32 ${value})`

// ---------------------------------------------------------------------------
// Module emission
// ---------------------------------------------------------------------------

const emitFunction = (
  fn: PortableFunctionIR,
  functionsByName: ReadonlyMap<string, PortableFunctionIR>,
  strings: NativeStringFacts,
  env: NativeEnvLayout,
  layout: NativeMemoryLayout
): string => {
  const body = new NativeBody()
  const context: NativeContext = { fn, functionsByName, strings, env, layout, body, loops: [] }
  for (const parameter of fn.parameters) {
    const type = llvmType(parameter.valueType)
    body.named(paramSlot(parameter.name), type)
    body.emit(`store ${type} %arg.${parameter.name}, ptr ${paramSlot(parameter.name)}, align 8`)
  }
  for (const local of fn.locals) {
    // Zero-initialized exactly as Wasm locals are, so a validator gap can never
    // let the runtimes observe different uninitialized values. The string zero
    // value is the pool's "" entry, pinned at offset 0.
    const type = llvmType(local.valueType)
    body.named(localSlot(local.name), type)
    body.emit(`store ${type} ${llvmZero(local.valueType)}, ptr ${localSlot(local.name)}, align 8`)
  }
  emitStatements(fn.body, context)
  const parameters = fn.parameters.map((parameter) => `${llvmType(parameter.valueType)} %arg.${parameter.name}`).join(", ")
  return [
    `define internal ${llvmResultType(fn)} @__impl_${fn.name}(${parameters}) {`,
    body.render(),
    `}`
  ].join("\n")
}

/** Per-function entry point: parse argv, install the environment, run, print. */
const emitRunner = (
  fn: PortableFunctionIR,
  env: NativeEnvLayout,
  layout: NativeMemoryLayout
): string => {
  const lines: string[] = [`define internal void @__run_${fn.name}(ptr %argv) {`, `entry:`]
  const callArguments: string[] = []
  // The i-th STRING parameter (in declaration order) owns the i-th input slot,
  // exactly as `wasmArguments` assigns them. Host code never writes this region
  // again during the call, so arguments cannot be disturbed mid-invocation.
  let stringSlot = 0
  fn.parameters.forEach((parameter, position) => {
    const slot = position + 2
    if (parameter.valueType === "string") {
      const offset = layout.inputBase + stringSlot * (4 + NATIVE_MAX_STRING_BYTES)
      stringSlot += 1
      lines.push(`  call void @__arg_str(ptr %argv, i32 ${slot}, i32 ${offset})`)
      lines.push(`  %s${position} = add i32 ${offset}, 0`)
      callArguments.push(`i32 %s${position}`)
      return
    }
    lines.push(`  %h${position} = call i64 @__arg_hex(ptr %argv, i32 ${slot})`)
    if (parameter.valueType === "number") {
      lines.push(`  %d${position} = bitcast i64 %h${position} to double`)
      callArguments.push(`double %d${position}`)
      return
    }
    lines.push(`  %b${position} = trunc i64 %h${position} to i32`)
    callArguments.push(`i32 %b${position}`)
  })
  lines.push(`  call void @__install_env(ptr %argv, i32 ${fn.parameters.length + 2})`)
  // Both budgets belong to the exported invocation, never to the process.
  lines.push(`  store i32 ${PORTABLE_LOOP_FUEL}, ptr @__fuel, align 4`)
  lines.push(`  store i32 ${layout.heapBase}, ptr @__heap, align 4`)
  const resultType = llvmResultType(fn)
  lines.push(`  %ret = call ${resultType} @__impl_${fn.name}(${callArguments.join(", ")})`)
  lines.push(`  %tag = extractvalue ${resultType} %ret, 0`)
  lines.push(`  %val = extractvalue ${resultType} %ret, 1`)
  lines.push(`  call i32 (ptr, ...) @printf(ptr @.fmt.dec, i32 %tag)`)
  lines.push(`  %isDefect = icmp slt i32 %tag, 0`)
  lines.push(`  br i1 %isDefect, label %done, label %live`)
  lines.push(`live:`)
  if (fn.result.kind === "plain") {
    lines.push(emitPrintValue(fn.result.valueType, "%val"))
    lines.push(`  br label %done`)
  } else if (fn.result.kind === "optional") {
    lines.push(`  %isPresent = icmp eq i32 %tag, 1`)
    lines.push(`  br i1 %isPresent, label %present, label %done`)
    lines.push(`present:`)
    lines.push(emitPrintValue(fn.result.valueType, "%val"))
    lines.push(`  br label %done`)
  } else {
    lines.push(`  %isSuccess = icmp eq i32 %tag, 0`)
    lines.push(`  br i1 %isSuccess, label %success, label %failure`)
    lines.push(`success:`)
    lines.push(emitPrintValue(fn.result.valueType, "%val"))
    lines.push(`  br label %done`)
    lines.push(`failure:`)
    const cases = fn.result.errors.map((error) => `i32 ${error.tag}, label %err${error.tag}`).join(" ")
    lines.push(`  switch i32 %tag, label %done [ ${cases} ]`)
    for (const error of fn.result.errors) {
      lines.push(`err${error.tag}:`)
      error.fields.forEach((field, position) => {
        lines.push(`  %p${error.tag}_${position} = load double, ptr @__payload_${position}, align 8`)
        if (field.valueType === "number") {
          lines.push(`  call void @__print_num(double %p${error.tag}_${position})`)
          return
        }
        lines.push(`  %n${error.tag}_${position} = fptoui double %p${error.tag}_${position} to i32`)
        lines.push(field.valueType === "boolean"
          ? `  call void @__print_bool(i32 %n${error.tag}_${position})`
          : `  call void @__print_str(i32 %n${error.tag}_${position})`)
      })
      lines.push(`  br label %done`)
    }
  }
  lines.push(`done:`)
  lines.push(`  ret void`)
  lines.push(`}`)
  return lines.join("\n")
}

/**
 * Install the host-supplied environment before the call. EVERY declared slot is
 * written, including ones outside the selected function's row: those receive the
 * canonical zero value, so a slot can never carry a stale or fabricated value
 * into an invocation. Mirrors `writeWasmEnvironment`.
 */
const emitInstallEnv = (env: NativeEnvLayout, layout: NativeMemoryLayout): string => {
  const lines: string[] = [`define internal void @__install_env(ptr %argv, i32 %base) {`, `entry:`]
  env.slots.forEach((slot, index) => {
    lines.push(`  %i${index} = add i32 %base, ${index}`)
    if (slot.valueType === "string") {
      lines.push(`  call void @__arg_str(ptr %argv, i32 %i${index}, i32 ${envStringOffset(layout, slot.stringIndex)})`)
      return
    }
    lines.push(`  %h${index} = call i64 @__arg_hex(ptr %argv, i32 %i${index})`)
    if (slot.valueType === "number") {
      lines.push(`  %d${index} = bitcast i64 %h${index} to double`)
      lines.push(`  store double %d${index}, ptr @__env_${slot.globalIndex}, align 8`)
      return
    }
    lines.push(`  %b${index} = trunc i64 %h${index} to i32`)
    lines.push(`  store i32 %b${index}, ptr @__env_${slot.globalIndex}, align 8`)
  })
  lines.push(`  ret void`)
  lines.push(`}`)
  return lines.join("\n")
}

const emitMain = (module: PortableModuleIR, env: NativeEnvLayout, strings: NativeStringFacts): string => {
  const lines: string[] = [
    `define i32 @main(i32 %argc, ptr %argv) {`,
    `entry:`,
    // The pool is copied into the mutable byte array once, so `@__mem` stays a
    // zero-initialized (BSS) global and the executable does not carry a
    // megabyte of literal zeros.
    `  call void @__copy(ptr @__mem, ptr @.pool, i32 ${strings.poolBytes})`,
    `  call i32 (ptr, ...) @printf(ptr @.attest)`,
    `  %hasSel = icmp sge i32 %argc, 2`,
    `  br i1 %hasSel, label %select, label %bad`,
    `select:`,
    `  %selp = getelementptr ptr, ptr %argv, i32 1`,
    `  %sels = load ptr, ptr %selp, align 8`,
    `  %sel64 = call i64 @strtoull(ptr %sels, ptr null, i32 10)`,
    `  %sel = trunc i64 %sel64 to i32`,
    `  switch i32 %sel, label %bad [ ${module.functions.map((_, index) => `i32 ${index}, label %case${index}`).join(" ")} ]`
  ]
  module.functions.forEach((fn, index) => {
    const expected = 2 + fn.parameters.length + env.slots.length
    lines.push(`case${index}:`)
    lines.push(`  %ok${index} = icmp eq i32 %argc, ${expected}`)
    lines.push(`  br i1 %ok${index}, label %run${index}, label %bad`)
    lines.push(`run${index}:`)
    lines.push(`  call void @__run_${fn.name}(ptr %argv)`)
    lines.push(`  ret i32 0`)
  })
  lines.push(`bad:`)
  lines.push(`  call i32 (ptr, ...) @printf(ptr @.badargs)`)
  lines.push(`  ret i32 2`)
  lines.push(`}`)
  return lines.join("\n")
}

/**
 * Lower a validated `PortableModuleIR` to LLVM IR text.
 *
 * Deterministic: identical input yields byte-identical output on every run and
 * every machine. No target triple or datalayout is emitted, so the host `clang`
 * supplies both and nothing host-specific enters the text.
 */
export const emitPortableLlvmIr = (moduleValue: PortableModuleIR): string => {
  const module = validatePortableModule(moduleValue)
  const functionsByName = new Map(module.functions.map((fn) => [fn.name, fn]))
  const strings = nativeStringFacts(module)
  const env = nativeEnvLayout(module.capabilities)
  const layout = nativeMemoryLayout(strings, env)
  const payloadSlots = nativePayloadSlots(module)
  const pool = poolBytes(strings)

  const header = [
    `; Smithers portable native backend, format 4.`,
    `; module ${module.moduleId}`,
    `; module-digest ${module.digest}`,
    `; Emitted from validated portable IR. No target triple or datalayout: the`,
    `; host clang supplies both, so this text is byte-identical everywhere.`,
    ``,
    `declare i32 @printf(ptr, ...)`,
    `declare i32 @putchar(i32)`,
    `declare i64 @strlen(ptr)`,
    `declare i64 @strtoull(ptr, ptr, i32)`,
    `declare void @exit(i32)`,
    ``,
    `@__mem = internal global [${Math.max(layout.memoryBytes, 8)} x i8] zeroinitializer, align 8`,
    `@.pool = private unnamed_addr constant [${pool.length} x i8] c"${llvmBytes(pool)}"`,
    `@__fuel = internal global i32 0, align 4`,
    `@__heap = internal global i32 0, align 4`,
    ...Array.from({ length: payloadSlots }, (_, index) => `@__payload_${index} = internal global double ${llvmDouble(0)}, align 8`),
    ...env.slots.filter((slot) => slot.globalIndex >= 0).map((slot) =>
      `@__env_${slot.globalIndex} = internal global ${llvmType(slot.valueType)} ${llvmZero(slot.valueType)}, align 8`),
    llvmCString(".fmt.dec", "%d\n"),
    llvmCString(".fmt.hex", "%016llx\n"),
    llvmCString(".attest", `${ATTESTATION_PREFIX} ${module.digest}\n`),
    llvmCString(".badargs", "smithers-native: bad invocation\n")
  ]

  const text = [
    ...header,
    ``,
    ...runtimeHelpers(layout),
    ``,
    emitInstallEnv(env, layout),
    ``,
    ...module.functions.map((fn) => emitFunction(fn, functionsByName, strings, env, layout)),
    ``,
    ...module.functions.map((fn) => emitRunner(fn, env, layout)),
    ``,
    emitMain(module, env, strings),
    ``
  ].join("\n")

  if (Buffer.byteLength(text, "utf8") > MAX_LLVM_IR_BYTES) {
    return fail("SMITHERS5101", `native LLVM IR exceeds ${MAX_LLVM_IR_BYTES} bytes`)
  }
  return text
}

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

export interface PortableNativeOptions {
  /** `clang` (or a compatible driver) that accepts `-x ir`. */
  readonly clang?: string
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}

export interface PortableNativeBuild {
  readonly formatVersion: 4
  readonly module: PortableModuleIR
  readonly tool: "clang"
  readonly toolVersion: string
  readonly llvmIr: string
  readonly llvmIrDigest: string
  readonly binary: Uint8Array
  readonly binaryDigest: string
  readonly digest: string
}

interface ProcessResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: Buffer
  readonly stderr: string
}

const binaryDigest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

const validToolIdentity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 4096 &&
  !/[\u0000-\u001f\u007f]/.test(value)

/**
 * Run a child to completion under a wall-clock deadline and an output cap,
 * without rejecting on a non-zero exit: the native runner needs to inspect the
 * code and the stderr text to produce an honest diagnostic.
 */
const runProcess = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number
): Promise<ProcessResult> => new Promise((resolveResult, reject) => {
  const grouped = process.platform !== "win32"
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], detached: grouped })
  } catch (error) {
    reject(error instanceof Error ? error : new Error(String(error)))
    return
  }
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let outputBytes = 0
  let failure: Error | undefined
  let timedOut = false
  const kill = (): void => {
    if (grouped && child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); return } catch { /* already gone */ }
    }
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }
  const collect = (target: Buffer[], chunk: Buffer): void => {
    if (failure) return
    outputBytes += chunk.byteLength
    if (outputBytes > maxOutputBytes) {
      failure = new Error(`${command} exceeded ${maxOutputBytes} output bytes`)
      kill()
      return
    }
    target.push(Buffer.from(chunk))
  }
  child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk))
  child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk))
  child.once("error", (error) => { failure ??= error; kill() })
  const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
  timer.unref()
  child.once("close", (code, signal) => {
    clearTimeout(timer)
    if (grouped && child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL") } catch { /* already gone */ }
    }
    if (timedOut) return reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    if (failure) return reject(failure)
    resolveResult({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") })
  })
})

const normalizedOptions = (options: PortableNativeOptions): {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
} => {
  const command = options.clang ?? "clang"
  const timeoutMs = options.timeoutMs ?? 60_000
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  if (typeof command !== "string" || command.length === 0 || command.length > 4_096 || command.includes("\0")) {
    return fail("SMITHERS5102", "native toolchain command is invalid")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    return fail("SMITHERS5102", "native toolchain timeout is invalid")
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 8 * 1024 * 1024) {
    return fail("SMITHERS5102", "native toolchain output limit is invalid")
  }
  return { command, timeoutMs, maxOutputBytes }
}

/**
 * Resolve the toolchain identity, failing with a specific, honest diagnostic
 * when `clang` is absent or unusable. This NEVER degrades into a skip: a caller
 * that cannot compile learns exactly that, and the test suite treats a missing
 * toolchain as a failure rather than as a pass.
 */
const clangIdentity = async (command: string, timeoutMs: number, maxOutputBytes: number): Promise<string> => {
  let result: ProcessResult
  try {
    result = await runProcess(command, ["--version"], timeoutMs, maxOutputBytes)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return fail(
      "SMITHERS5103",
      `native backend requires a working '${command}' that accepts '-x ir', but invoking it failed: ${reason}`
    )
  }
  if (result.code !== 0) {
    return fail(
      "SMITHERS5103",
      `native backend requires a working '${command}', but '${command} --version' exited with code ${String(result.code)}: ${result.stderr.trim()}`
    )
  }
  const identity = (result.stdout.toString("utf8").split("\n")[0] ?? "").trim()
  if (!validToolIdentity(identity)) return fail("SMITHERS5103", `'${command} --version' returned an unusable tool identity`)
  return identity
}

/**
 * Emit LLVM IR text and compile it with `clang -x ir` into a native executable.
 *
 * `-O0` is deliberate: the emitted IR is already a direct lowering, the fuel
 * budget bounds every loop, and a non-optimizing compile keeps the executable's
 * observable behaviour as close to the emitted text as the toolchain allows.
 */
export const compilePortableNative = async (
  moduleValue: PortableModuleIR,
  options: PortableNativeOptions = {}
): Promise<PortableNativeBuild> => {
  const module = validatePortableModule(moduleValue)
  const { command, timeoutMs, maxOutputBytes } = normalizedOptions(options)
  const llvmIr = emitPortableLlvmIr(module)
  const toolVersion = await clangIdentity(command, timeoutMs, maxOutputBytes)
  const directory = await mkdtemp(join(tmpdir(), "smithers-portable-native-"))
  const sourcePath = join(directory, "module.ll")
  const outputPath = join(directory, "module.bin")
  let binary: Uint8Array
  try {
    await writeFile(sourcePath, llvmIr, "utf8")
    let compiled: ProcessResult
    try {
      compiled = await runProcess(command, ["-x", "ir", sourcePath, "-O0", "-o", outputPath], timeoutMs, maxOutputBytes)
    } catch (error) {
      return fail("SMITHERS5104", `native compilation could not run '${command}': ${error instanceof Error ? error.message : String(error)}`)
    }
    if (compiled.code !== 0) {
      return fail("SMITHERS5104", `native compilation failed (code ${String(compiled.code)}): ${compiled.stderr.trim()}`)
    }
    let outputStat
    try {
      outputStat = await lstat(outputPath)
    } catch (error) {
      return fail("SMITHERS5104", `'${command}' did not produce its output file: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!outputStat.isFile() || outputStat.size > MAX_NATIVE_BINARY_BYTES) {
      return fail("SMITHERS5104", `native output must be a regular file no larger than ${MAX_NATIVE_BINARY_BYTES} bytes`)
    }
    binary = Uint8Array.from(await readFile(outputPath))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (binary.byteLength === 0) return fail("SMITHERS5104", "native output is empty")
  const llvmIrDigest = digest(llvmIr)
  const digestOfBinary = binaryDigest(binary)
  return Object.freeze({
    formatVersion: 4 as const,
    module,
    tool: "clang" as const,
    toolVersion,
    llvmIr,
    llvmIrDigest,
    binary,
    binaryDigest: digestOfBinary,
    digest: digest({
      formatVersion: 4,
      moduleDigest: module.digest,
      tool: "clang",
      toolVersion,
      llvmIrDigest,
      binaryDigest: digestOfBinary
    })
  })
}

const NATIVE_BUILD_KEYS = [
  "binary", "binaryDigest", "digest", "formatVersion", "llvmIr", "llvmIrDigest", "module", "tool", "toolVersion"
] as const

const validateNativeBuild = (value: unknown): { readonly module: PortableModuleIR; readonly binary: Uint8Array } => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail("SMITHERS5105", "native build must be a plain object")
  }
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    canonicalJson((ownKeys as string[]).sort()) !== canonicalJson([...NATIVE_BUILD_KEYS].sort())
  ) return fail("SMITHERS5105", "native build has missing or unknown fields")
  for (const key of NATIVE_BUILD_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return fail("SMITHERS5105", "native build cannot contain accessors or hidden fields")
    }
  }
  const build = value as PortableNativeBuild
  const module = validatePortableModule(build.module)
  if (!(build.binary instanceof Uint8Array) || build.binary.byteLength === 0 || build.binary.byteLength > MAX_NATIVE_BINARY_BYTES) {
    return fail("SMITHERS5105", "native build binary is invalid")
  }
  // Snapshot the mutable bytes once, then hash and execute this same copy so
  // concurrent mutation cannot cross validation.
  const binary = Uint8Array.from(build.binary)
  if (
    build.formatVersion !== 4 || build.tool !== "clang" || !validToolIdentity(build.toolVersion) ||
    typeof build.llvmIr !== "string" || Buffer.byteLength(build.llvmIr, "utf8") > MAX_LLVM_IR_BYTES ||
    build.llvmIr !== emitPortableLlvmIr(module) || build.llvmIrDigest !== digest(build.llvmIr) ||
    typeof build.binaryDigest !== "string" || !HEX_DIGEST.test(build.binaryDigest) || build.binaryDigest !== binaryDigest(binary)
  ) return fail("SMITHERS5105", "native build identity/content mismatch")
  const expected = digest({
    formatVersion: 4,
    moduleDigest: module.digest,
    tool: "clang",
    toolVersion: build.toolVersion,
    llvmIrDigest: build.llvmIrDigest,
    binaryDigest: build.binaryDigest
  })
  if (build.digest !== expected) return fail("SMITHERS5105", "native build digest mismatch")
  return { module, binary }
}

// ---------------------------------------------------------------------------
// Wire boundary
//
// Re-derived from the portable backend's private `inputValues`,
// `environmentValues`, `canonicalWireValue`, and `wireExit`, so a rejected
// argument or environment is rejected identically before anything runs and the
// resulting `PortableExecution` is byte-identical. The differential suite is
// what proves this: `digest` and `deepFreeze` come from the same shared module
// the portable backend uses, so an agreeing wire digest is an agreeing
// canonical encoding.
//
// These four in particular CANNOT be shared as-is, and the reason is a design
// decision rather than an accident: the rejection paths carry their own
// subsystem codes and message prefixes. Here they are SMITHERS5106 (input),
// SMITHERS5107 (environment) and SMITHERS5109 (wire domain) with "native …"
// text; there they are SMITHERS5052/5053/5054/5073 with "portable …" text.
// Importing the portable helpers would make a native rejection report the
// portable subsystem's code, emptying three members of the 5100-5112 block this
// backend was deliberately given so a reader can tell WHICH runtime refused.
// Keeping both codes instead requires giving the portable helpers a code and
// prefix parameter — a signature change to that file's private surface, not a
// move. The differential suite already requires all three runtimes to reject
// for the same REASON (shared load-bearing text), which is the property that
// actually matters at this boundary.
// ---------------------------------------------------------------------------

const validPortableStringValue = (value: unknown): value is string =>
  typeof value === "string" && Buffer.byteLength(value, "utf8") <= NATIVE_MAX_STRING_BYTES && PORTABLE_STRING_CONTENT.test(value)

const inputValues = (
  fn: PortableFunctionIR,
  input: Readonly<Record<string, unknown>>
): readonly (number | boolean | string)[] => {
  const normalized = assertJson(input, `native input for ${fn.name}`)
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) {
    return fail("SMITHERS5106", "native input must be an object")
  }
  if (canonicalJson(Object.keys(normalized).sort()) !== canonicalJson(fn.parameters.map((parameter) => parameter.name).sort())) {
    return fail("SMITHERS5106", `native input for ${fn.name} has missing or unknown fields`)
  }
  return fn.parameters.map((parameter) => {
    const value = (normalized as Record<string, unknown>)[parameter.name]
    if (
      (parameter.valueType === "number" && (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0))) ||
      (parameter.valueType === "boolean" && typeof value !== "boolean") ||
      (parameter.valueType === "string" && !validPortableStringValue(value))
    ) {
      return fail("SMITHERS5106", `native input ${parameter.name} must be ${parameter.valueType === "string"
        ? `a printable ASCII string of at most ${NATIVE_MAX_STRING_BYTES} bytes`
        : parameter.valueType}`)
    }
    return value as number | boolean | string
  })
}

const environmentField = (capability: string, field: PortableCapabilityField, value: unknown): number | boolean | string => {
  if (
    (field.valueType === "number" && (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0))) ||
    (field.valueType === "boolean" && typeof value !== "boolean") ||
    (field.valueType === "string" && !validPortableStringValue(value))
  ) {
    return fail("SMITHERS5107", `native environment ${capability}.${field.name} must be ${field.valueType === "string"
      ? `a printable ASCII string of at most ${NATIVE_MAX_STRING_BYTES} bytes`
      : field.valueType}`)
  }
  return value as number | boolean | string
}

const environmentValues = (
  fn: PortableFunctionIR,
  capabilities: readonly PortableCapability[],
  environment: unknown
): ReadonlyMap<string, number | boolean | string> => {
  const normalized = assertJson(environment, `native environment for ${fn.name}`)
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) {
    return fail("SMITHERS5107", "native environment must be an object of capability records")
  }
  const supplied = Object.keys(normalized).sort()
  if (canonicalJson(supplied) !== canonicalJson([...fn.requirements])) {
    const missing = fn.requirements.filter((requirement) => !supplied.includes(requirement))
    const unknown = supplied.filter((name) => !fn.requirements.includes(name))
    return fail(
      "SMITHERS5107",
      `native environment for ${fn.name} does not match its requirement row ${JSON.stringify([...fn.requirements])}` +
      `${missing.length > 0 ? `; missing ${JSON.stringify(missing)}` : ""}` +
      `${unknown.length > 0 ? `; unknown ${JSON.stringify(unknown)}` : ""}`
    )
  }
  const byName = new Map(capabilities.map((capability) => [capability.name, capability]))
  const values = new Map<string, number | boolean | string>()
  for (const name of fn.requirements) {
    const capability = byName.get(name)
    if (capability === undefined) return fail("SMITHERS5107", `native environment names capability ${name} the module does not declare`)
    const record = (normalized as Record<string, unknown>)[name]
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      return fail("SMITHERS5107", `native environment entry ${name} must be an object of its declared fields`)
    }
    const fields = capability.fields.map((field) => field.name).sort()
    if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(fields)) {
      return fail("SMITHERS5107", `native environment entry ${name} has missing or unknown fields; it must supply exactly ${JSON.stringify(fields)}`)
    }
    for (const field of capability.fields) {
      values.set(`${name}.${field.name}`, environmentField(name, field, (record as Record<string, unknown>)[field.name]))
    }
  }
  return values
}

type NativeExit =
  | { readonly kind: "value"; readonly value: number | boolean | string }
  | { readonly kind: "absent" }
  | { readonly kind: "failure"; readonly identity: string; readonly payload: Readonly<Record<string, number | boolean | string>> }
  | { readonly kind: "defect"; readonly defect: PortableDefect }

const canonicalWireValue = (valueType: PortableValueType, value: unknown, label: string): number | boolean | string => {
  if (
    (valueType === "number" && (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0))) ||
    (valueType === "boolean" && typeof value !== "boolean") ||
    (valueType === "string" && !validPortableStringValue(value))
  ) return fail("SMITHERS5109", `${label} is outside the canonical scalar wire domain`)
  return value as number | boolean | string
}

const wireExit = (fn: PortableFunctionIR, exit: NativeExit): PortableExecution => {
  let wire: PortableWireExit
  if (exit.kind === "absent") {
    if (fn.result.kind !== "optional") return fail("SMITHERS5109", "native backend produced absence for non-Optional function")
    wire = { kind: "absent" }
  } else if (exit.kind === "defect") {
    wire = { kind: "defect", defect: exit.defect }
  } else if (exit.kind === "failure") {
    const variant = fn.result.kind === "result"
      ? fn.result.errors.find((error) => error.identity === exit.identity)
      : undefined
    if (variant === undefined) return fail("SMITHERS5109", "native backend produced undeclared failure")
    const payloadKeys = Object.keys(exit.payload).sort()
    if (canonicalJson(payloadKeys) !== canonicalJson(variant.fields.map((field) => field.name).sort())) {
      return fail("SMITHERS5109", "native failure payload fields do not match the declared variant")
    }
    const payload: Record<string, number | boolean | string> = {}
    for (const field of variant.fields) {
      payload[field.name] = canonicalWireValue(field.valueType, exit.payload[field.name], `native failure payload ${field.name}`)
    }
    wire = { kind: "failure", error: { identity: exit.identity, payload } }
  } else {
    wire = { kind: "success", value: canonicalWireValue(fn.result.valueType, exit.value, "native output") }
  }
  const frozen = deepFreeze(wire)
  return deepFreeze({
    contractDigest: fn.contractDigest,
    exit: frozen,
    wireDigest: digest({ wireVersion: 1, contractDigest: fn.contractDigest, exit: frozen })
  })
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Exact IEEE-754 bits as 16 lowercase hex digits: the numeric argv encoding. */
const numberToHex = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value, false)
  let hex = ""
  for (let index = 0; index < 8; index += 1) hex += view.getUint8(index).toString(16).padStart(2, "0")
  return hex
}

const hexToNumber = (hex: string, label: string): number => {
  if (!/^[0-9a-f]{16}$/.test(hex)) return fail("SMITHERS5110", `${label} is not a 64-bit hex bit pattern`)
  const view = new DataView(new ArrayBuffer(8))
  for (let index = 0; index < 8; index += 1) view.setUint8(index, Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))
  return view.getFloat64(0, false)
}

const argumentToken = (valueType: PortableValueType, value: number | boolean | string): string =>
  valueType === "number"
    ? numberToHex(value as number)
    : valueType === "boolean"
      ? (value === true ? "0000000000000001" : "0000000000000000")
      : (value as string)

/** Cursor over the child's stdout, so a truncated or forged stream fails closed. */
class NativeOutput {
  #offset = 0
  constructor(private readonly bytes: Buffer) {}

  line(label: string): string {
    const end = this.bytes.indexOf(0x0a, this.#offset)
    if (end < 0) return fail("SMITHERS5110", `native runner output ended before ${label}`)
    const text = this.bytes.toString("latin1", this.#offset, end)
    this.#offset = end + 1
    return text
  }

  exact(length: number, label: string): string {
    if (this.#offset + length + 1 > this.bytes.byteLength) return fail("SMITHERS5110", `native runner output ended inside ${label}`)
    // latin1 keeps every forged byte distinguishable (no U+FFFD folding), so a
    // non-ASCII byte fails the canonical wire-domain check instead of silently
    // decoding into some other character.
    const text = this.bytes.toString("latin1", this.#offset, this.#offset + length)
    if (this.bytes[this.#offset + length] !== 0x0a) return fail("SMITHERS5110", `native runner output did not terminate ${label}`)
    this.#offset += length + 1
    return text
  }

  integer(label: string): number {
    const text = this.line(label)
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(text)) return fail("SMITHERS5110", `${label} is not a canonical integer`)
    const value = Number(text)
    if (!Number.isSafeInteger(value)) return fail("SMITHERS5110", `${label} is not a safe integer`)
    return value
  }

  end(): void {
    if (this.#offset !== this.bytes.byteLength) return fail("SMITHERS5110", "native runner produced trailing output")
  }
}

const readValue = (output: NativeOutput, valueType: PortableValueType, label: string): number | boolean | string => {
  if (valueType === "number") return hexToNumber(output.line(label), label)
  if (valueType === "boolean") {
    const raw = output.integer(label)
    if (raw !== 0 && raw !== 1) return fail("SMITHERS5110", `${label} is not a canonical boolean`)
    return raw === 1
  }
  const length = output.integer(`${label} length`)
  if (length < 0) return fail("SMITHERS5110", `${label} length is negative`)
  return output.exact(length, label)
}

const readPayload = (
  output: NativeOutput,
  variant: PortableErrorVariant,
  label: string
): Readonly<Record<string, number | boolean | string>> => {
  const payload: Record<string, number | boolean | string> = {}
  for (const field of variant.fields) {
    payload[field.name] = readValue(output, field.valueType, `${label} payload field ${field.name}`)
  }
  return payload
}

/** Negative tags are canonical defects; the tag names which one. */
const decodeNativeDefect = (tag: number, facts: NativeDefectFacts | undefined): PortableDefect => {
  if (tag === FUEL_DEFECT_TAG) {
    if (facts?.fuel !== true) return fail("SMITHERS5110", "native runner returned a fuel defect tag for a loop-free function")
    return "fuel-exhausted"
  }
  if (tag === STRING_DEFECT_TAG) {
    if (facts?.string !== true) return fail("SMITHERS5110", "native runner returned a string-memory defect tag for a concat-free function")
    return "string-memory-exhausted"
  }
  return fail("SMITHERS5110", "native runner returned an unknown defect tag")
}

/**
 * Execute a validated native build and return the canonical `PortableExecution`.
 *
 * The build is re-validated (IR text re-emitted and compared, binary digest
 * re-checked), the binary is materialized into a private temporary file, run
 * under a deadline with a bounded output, and required to ATTEST the module
 * digest it was built from before a single byte of its result is believed.
 */
export const executePortableNative = async (
  build: PortableNativeBuild,
  functionName: string,
  input: Readonly<Record<string, unknown>>,
  environment: PortableEnvironment = {},
  options: PortableNativeOptions = {}
): Promise<PortableExecution> => {
  const validated = validateNativeBuild(build)
  const module = validated.module
  const index = module.functions.findIndex((entry) => entry.name === functionName)
  const fn = module.functions[index]
  if (fn === undefined) return fail("SMITHERS5111", `native module has no function ${functionName}`)
  const { timeoutMs, maxOutputBytes } = normalizedOptions(options)
  const env = nativeEnvLayout(module.capabilities)
  const defects = nativeDefectMap(module)
  // Inputs and environment are validated against the declared row BEFORE the
  // process starts, so a bad call fails identically in all three runtimes with
  // nothing run.
  const parameters = inputValues(fn, input)
  const environmentSlots = environmentValues(fn, module.capabilities, environment)

  const args = [
    String(index),
    ...parameters.map((value, position) => argumentToken(fn.parameters[position]!.valueType, value)),
    ...env.slots.map((slot) => {
      const supplied = environmentSlots.get(slot.key)
      // Every declared slot is written; ones outside the row get the canonical
      // zero value so a slot can never carry a fabricated value in.
      if (slot.valueType === "string") return (supplied ?? "") as string
      if (slot.valueType === "number") return numberToHex((supplied ?? 0) as number)
      return supplied === true ? "0000000000000001" : "0000000000000000"
    })
  ]

  const directory = await mkdtemp(join(tmpdir(), "smithers-portable-native-run-"))
  const binaryPath = join(directory, "module.bin")
  let result: ProcessResult
  try {
    await writeFile(binaryPath, validated.binary)
    await chmod(binaryPath, 0o700)
    try {
      result = await runProcess(binaryPath, args, timeoutMs, maxOutputBytes)
    } catch (error) {
      return fail("SMITHERS5111", `native invocation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (result.code !== 0) {
    return fail(
      "SMITHERS5111",
      `native invocation exited with code ${String(result.code)}${result.signal === null ? "" : ` (signal ${result.signal})`}` +
      `${result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : ""}`
    )
  }

  const output = new NativeOutput(result.stdout)
  const attestation = output.line("the native attestation line")
  if (attestation !== `${ATTESTATION_PREFIX} ${module.digest}`) {
    return fail("SMITHERS5112", "native binary did not attest the module digest it was built from")
  }
  const tag = output.integer("native exit tag")
  let exit: NativeExit
  if (tag < 0) {
    exit = { kind: "defect", defect: decodeNativeDefect(tag, defects.get(fn.name)) }
  } else if (fn.result.kind === "plain") {
    if (tag !== 0) return fail("SMITHERS5110", "native runner returned an invalid plain-function tag")
    exit = { kind: "value", value: readValue(output, fn.result.valueType, `native result for ${fn.name}`) }
  } else if (fn.result.kind === "optional") {
    if (tag === 0) exit = { kind: "absent" }
    else if (tag !== 1) return fail("SMITHERS5110", "native runner returned an invalid Optional tag")
    else exit = { kind: "value", value: readValue(output, fn.result.valueType, `native Optional value for ${fn.name}`) }
  } else if (tag === 0) {
    exit = { kind: "value", value: readValue(output, fn.result.valueType, `native Result value for ${fn.name}`) }
  } else {
    const variant = fn.result.errors.find((error) => error.tag === tag)
    if (variant === undefined) return fail("SMITHERS5110", "native runner returned an undeclared Result tag")
    exit = {
      kind: "failure",
      identity: variant.identity,
      payload: readPayload(output, variant, `native failure for ${fn.name}`)
    }
  }
  output.end()
  return wireExit(fn, exit)
}

export const PortableNativeBackend = Object.freeze({
  compileNative: compilePortableNative,
  emitLlvmIr: emitPortableLlvmIr,
  executeNative: executePortableNative
})
