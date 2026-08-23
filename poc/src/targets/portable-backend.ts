import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import * as ts from "typescript-js"
import { analyzeSource } from "../language/analyze.ts"
import {
  assertJson,
  canonicalJson,
  decodeCanonicalJson,
  deepFreeze,
  digest,
  encodeCanonicalJson
} from "../durable/ir.ts"

/**
 * Bounded portable Wasm backend (format 4).
 *
 * Honest scope: this lowers exported, synchronous, non-generic `.sm`
 * functions over `number`/`boolean`/portable-string values into a canonical,
 * digest-bound IR that runs in a TypeScript-host evaluator and compiles to
 * import-free WAT via `wat2wasm`, with exact canonical-exit and wire-digest
 * agreement between both runtimes. The supported subset now covers:
 *
 * - Context capabilities as VALUE SERVICES: an author declares
 *   `abstract class Config extends Context { abstract readonly label: string }`
 *   (importing `Context` from the compiler-owned `smthrs/context` module) and
 *   reads it with the ordinary library-shaped call `Config.context().label`, or
 *   `const config = Config.context()` followed by `config.label`. The enclosing
 *   function's requirement row (`R`) is inferred, propagates transitively
 *   through ordinary calls, is part of the function's contract digest, and is
 *   satisfied at execution by a host-supplied ENVIRONMENT (see below);
 *
 * - direct intra-module calls between portable functions (acyclic only; both
 *   direct and mutual recursion are REJECTED at compile and validation time,
 *   and the static call-chain depth is capped) with failure/absence
 *   propagation through `const x = f(...).unwrap()`, `return f(...).unwrap()`,
 *   and compatible tail returns (`return f(...)`) — Result tags are re-mapped
 *   into the caller's declared row inside Wasm;
 * - `let`/`const` locals with assignment (`=`, `+=`, `-=`, `*=`, `/=`, `++`,
 *   `--`, and `+=` string append), statement-form `if`/`else`, and
 *   `while`/`for` loops bounded by a module-wide fuel budget of exactly
 *   1_000_000 condition evaluations per exported invocation; exhausting fuel
 *   produces the canonical `fuel-exhausted` defect wire exit identically in
 *   both runtimes;
 * - nominal Error variants carrying `readonly` constructor-parameter payload
 *   fields of any portable value type (number, boolean, or string); payloads
 *   travel on the wire exit and survive propagation through callers (Wasm
 *   threads every field through the exported f64 globals — strings as exact
 *   integral i32 memory offsets widened via f64.convert_i32_u); error
 *   identity stays the compiler-derived nominal id
 *   `smithers.error:<module>#<Name>@1`;
 * - immutable printable-ASCII strings (so UTF-8 bytes, UTF-16 units, and code
 *   points coincide) as literals, PARAMETERS, locals, returns on every
 *   channel, and error payload fields, with `+`/`+=` CONCATENATION,
 *   content-based `===`/`!==`, byte-lexicographic `<`/`<=`/`>`/`>=`, and
 *   `.length` over both interned and computed strings.
 *
 * ## Environment ABI: how capabilities are lowered (format 4)
 *
 * The requirements specification leaves the LOWERING free ("hidden environment
 * parameters, scoped ambient context, or another mechanism that preserves
 * semantics and ordinary source-level call syntax") while locking the
 * SEMANTICS. This backend must also stay IMPORT-FREE: `Module.imports(...)` is
 * empty and stays empty, because a portable artifact that can call back into
 * the host is no longer a portable artifact. Those two facts together decide
 * the design:
 *
 * A capability method call (`Clock.context().now()`) can only be lowered as a
 * host callback, i.e. a Wasm import. So this backend supports exactly the
 * capability shape that needs no callback: a capability whose service surface
 * is a record of PORTABLE VALUES. `Capability.context().field` lowers to a read
 * of a fixed, compile-time-assigned environment slot that the host fills in
 * before the invocation. That is a genuine "hidden environment parameter"
 * lowering — the environment is passed as data, per invocation, rather than as
 * an ambient global or as authority to call out.
 *
 *   source:   `const config = Config.context(); return config.label + name`
 *   IR:       `{ kind: "capability", capability: "Config", field: "label" }`
 *   Wasm:     scalar field  -> `(global.get $__smithers_env_<k>)`
 *             string field  -> `(i32.const <envBase + s * (4 + 4096)>)`
 *   evaluator -> the identical validated environment map, keyed
 *                `"<Capability>.<field>"`.
 *
 * Nothing about a capability exists at runtime beyond those slots: there is no
 * service locator, no registry, no dynamic key, and no way for authored code to
 * name a capability that the compiler did not record in the function's row.
 *
 * The DESCRIPTOR of a module's requirement surface is the IR itself:
 * `module.capabilities` carries every required capability's nominal identity
 * (`smithers.capability:<module>#<Name>@1`) and its exact field row, each
 * function carries its own transitively-closed `requirements`, and both are
 * covered by the contract/function/module digests. The compiled Wasm is bound
 * to that same row two ways: `validateBuild` re-emits the WAT from the IR and
 * compares it byte for byte, and `inspectPortableWasm` requires the module's
 * export surface to be exactly the IR-derived set (functions, payload globals,
 * `__smithers_env_<k>` scalar slots, and `__memory` when memory is needed). A
 * module that exports an environment slot it did not declare — or hides one it
 * did — never reaches execution.
 *
 * The ENVIRONMENT is supplied at execution as plain data:
 * `{ Config: { label: "x", retries: 3 } }`. Before any code runs, both runtimes
 * validate it with one shared function against the SELECTED function's declared
 * row: exact capability set (no missing, no extra), exact field set per
 * capability (no missing, no extra), correct value types, finite non-negative-
 * zero numbers, strict booleans, and printable-ASCII strings of at most 4_096
 * bytes. Because rows are transitively closed, every field any callee can read
 * is already in the selected function's row, so a validated environment is
 * total for the whole invocation. Environment slots outside the selected row
 * are reset to canonical defaults before the call, exactly where fuel and the
 * concat heap are reset, so nothing leaks between invocations.
 *
 * FAIL-CLOSED, loudly, with stable diagnostics:
 *
 * - SMITHERS5071 rejects any capability member that is not
 *   `abstract readonly name: number|boolean|string` — methods, accessors, and
 *   constructors are the shapes that would need a host callback (`Clock.now()`,
 *   `FileSystem.read()`, `Random.next()`), and they cannot be lowered without
 *   Wasm imports. A portable module therefore cannot require Clock, Random,
 *   FileSystem, or any other host-effect capability at all; it is rejected at
 *   the capability DECLARATION, not silently at the call.
 * - SMITHERS5070 rejects malformed capability declarations (non-abstract, generic,
 *   decorated, empty, over-wide, non-portable field types, duplicate fields).
 * - SMITHERS5072 rejects every attempt to treat a capability as a value or to
 *   fabricate one: `new Config()`, `Config.context()` in a value position,
 *   `Config.context(arg)`, binding it with `let`, re-binding it, annotating it,
 *   or reading an identifier bound to it.
 * - SMITHERS5073 rejects a bad environment at execution in BOTH runtimes with the
 *   identical message: unknown capability, missing capability, missing or extra
 *   field, wrong value type, or an out-of-domain number/string.
 * - SMITHERS5033 rejects any disagreement between the lowered row and the row the
 *   independent checked Smithers frontend infers for the same source.
 * - SMITHERS5050 rejects forged IR: a function that claims a capability it never
 *   reads, reads one it did not declare, declares a row that is not exactly the
 *   transitive closure of its own reads and its callees' rows, or a module that
 *   declares a capability no function requires.
 *
 * A future non-import-free profile (a separate target, not this one) would need
 * imported capability methods, a re-entrancy and failure protocol for host
 * calls, per-method fuel accounting, and a way to reproduce host answers
 * deterministically for the TypeScript-host runtime to keep agreeing. None of
 * that is expressible here, and none of it is faked.
 *
 * ## Linear memory layout and string ABI (format 4)
 *
 * Every string value flows as an i32 offset into module memory pointing at a
 * packed `[u32 little-endian byte length][bytes]` record. Memory is laid out
 * deterministically from validated IR (both `emitPortableWat` and the host
 * executor derive the identical layout):
 *
 *   [0, poolBytes)                 interned literal pool, deduplicated and
 *                                  sorted, "" pinned at offset 0 so the i32
 *                                  zero value decodes as the empty string;
 *   [inputBase, inputLimit)        reserved input region; the HOST writes the
 *                                  exported invocation's string arguments here
 *                                  (packed, in parameter order) before each
 *                                  call and passes their offsets. Wasm code
 *                                  never writes this region.
 *                                  inputBase = poolBytes aligned up to 4;
 *                                  inputLimit = inputBase +
 *                                  maxStringParams * (4 + 4096);
 *   [envBase, heapBase)            reserved environment string region; the HOST
 *                                  writes one packed record per string-typed
 *                                  capability field, in canonical slot order,
 *                                  before each call. Wasm reads them through
 *                                  compile-time constant pointers and never
 *                                  writes this region either. Scalar capability
 *                                  fields live in exported mutable globals
 *                                  (`__smithers_env_<k>`) instead, so a module with
 *                                  only scalar fields needs no memory at all;
 *   [heapBase, heapBase+1MiB)      bump-allocated concat heap, present only
 *                                  when the module concatenates.
 *
 * When any string feature is used, memory is exported as `__memory` and the
 * host decodes string results/payloads by reading length+bytes from memory
 * with strict bounds validation (forged out-of-bounds offsets or lengths are
 * rejected); the IR literal table is no longer the validity oracle.
 *
 * Concatenation allocates from a bump allocator (`$__heap` global, initialized
 * to heapBase and reset by every exported wrapper alongside fuel). Memory is
 * NEVER reclaimed within one invocation and is reset between exported
 * invocations, mirroring the fuel-reset pattern. Each concat consumes
 * 4 + leftBytes + rightBytes heap bytes; exceeding the module-wide budget of
 * exactly 1_048_576 heap bytes per exported invocation produces the canonical
 * `string-memory-exhausted` defect wire exit identically in both runtimes at
 * the exact same operation. Fuel and the string budget are independent: fuel
 * is charged at each loop-condition evaluation, heap bytes at each concat, so
 * whichever budget an operation exceeds first (in program order) defects
 * first, deterministically in both runtimes. String equality is a length+byte
 * memcmp (`$__str_eq`) and ordering a byte-lexicographic compare
 * (`$__str_cmp`); interned-pointer equality is only a fast path because
 * runtime strings (parameters, concat results) are not interned.
 *
 * The Wasm exit tag ABI reserves negative tags for defects: -1 fuel-exhausted,
 * -2 string-memory-exhausted; propagation preserves the originating tag.
 *
 * Everything else stays fail-closed: imports other than the single canonical
 * `import { Context } from "smthrs/context"`, capability METHODS and every
 * host-effect capability, provider layers, non-ASCII or template literals,
 * string methods beyond `.length` (slice/indexOf/...), string mutation/
 * indexing, cross-invocation string retention, arrays, objects, closures,
 * generics, async, GC, recursion, labeled statements, switch, do/while, and any
 * host ABI. Author identifiers starting with `__` are reserved for the
 * backend's own WAT symbols and rejected.
 *
 * Canonical wire exits remain restricted to finite, non-negative-zero numbers,
 * strict booleans, and printable-ASCII strings of at most 4_096 bytes;
 * internal NaN/±inf/-0 values and concat results longer than 4_096 bytes may
 * flow between expressions and across intra-module call boundaries but can
 * never leave on the wire. The `unwrap()` authoring surface for Optionals
 * requires narrowly suppressing the checker's possibly-null diagnostics on
 * exactly the receiver of `<optionalFn>(...).unwrap()`; every other
 * nullability diagnostic still fails compilation, and the lowering
 * re-validates those receivers itself.
 *
 * Format 2 and format 3 artifacts are decode-rejected with a version
 * diagnostic. Format 3 changed string equality semantics (pointer -> memcmp),
 * memory layout, exports, and defect tags relative to format 2. Format 4 adds
 * the requirement row to every contract digest, adds `capabilities` to the
 * module surface, inserts the environment string region into the memory layout,
 * and adds `__smithers_env_<k>` to the export surface; a v3 module carries no row
 * at all, so loading one would silently assert "requires nothing" about code
 * whose digests never covered that claim. Both are recompiled, not migrated.
 */
const PRELUDE_NAME = resolve(process.cwd(), "__smithers_portable_backend__.d.ts")
const SOURCE_NAME = resolve(process.cwd(), "__smithers_portable_module__.sm.ts")
const CONTEXT_NAME = resolve(process.cwd(), "__smithers_portable_context__.d.ts")
/** The one module specifier portable source may import, resolved in-process. */
const CONTEXT_MODULE = "smthrs/context"
const PRELUDE = `
/** Compiler-only authoring aliases; no declaration here has a runtime value. */
type Result<Success, Failure extends Error> = Success
type Optional<Value> = Value | null | undefined
interface Number { unwrap(): number }
interface Boolean { unwrap(): boolean }
interface String { unwrap(): string }
`
/**
 * The compiler-owned capability root. It is an ambient module declaration in a
 * backend-owned file, never a filesystem edge: module resolution is disabled
 * outright in `createCheckedProgram`, so `smthrs/context` can only ever bind
 * to this text.
 */
const CONTEXT_DECLARATIONS = `
declare module "${CONTEXT_MODULE}" {
  export abstract class Context {
    static context<Capability extends abstract new (...args: never[]) => Context>(
      this: Capability
    ): InstanceType<Capability>
  }
}
`
const MAX_IR_BYTES = 2 * 1024 * 1024
const MAX_WAT_BYTES = 1024 * 1024
const MAX_WASM_BYTES = 4 * 1024 * 1024
const MAX_IR_DEPTH = 256
const MAX_FUNCTIONS = 1_024
const MAX_PARAMETERS = 256
const MAX_LOCALS = 256
const MAX_ERRORS = 256
const MAX_ERROR_FIELDS = 16
const MAX_CAPABILITIES = 16
const MAX_CAPABILITY_FIELDS = 16
const MAX_CALL_DEPTH = 32
const MAX_STRING_BYTES = 4_096
const MAX_STRING_POOL_BYTES = 60_000
const MAX_TOOL_IDENTITY_BYTES = 4 * 1024
const WASM_PAGE_BYTES = 65_536
/** Loop-condition evaluations allowed per exported invocation, both runtimes. */
export const PORTABLE_LOOP_FUEL = 1_000_000
/** Concat heap bytes (4-byte header + content per allocation) per exported invocation. */
export const PORTABLE_STRING_HEAP_BYTES = 1_048_576
/** Wasm ABI tag reserved for the canonical fuel-exhausted defect exit. */
const FUEL_DEFECT_TAG = -1
/** Wasm ABI tag reserved for the canonical string-memory-exhausted defect exit. */
const STRING_DEFECT_TAG = -2
const HEX_DIGEST = /^[0-9a-f]{64}$/
const PORTABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Portable string literals stay printable ASCII so UTF-8 bytes, UTF-16 units, and code points coincide. */
const PORTABLE_STRING_CONTENT = /^[\x20-\x7e]*$/
const PORTABLE_MODULE_ID = /^(?:@[A-Za-z0-9_][A-Za-z0-9._-]*\/)?[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/

export type PortableScalarType = "number" | "boolean"

/** Strings join the full portable value domain (params, locals, returns, payloads). */
export type PortableValueType = PortableScalarType | "string"

/** Canonical defect exits shared by both runtimes. */
export type PortableDefect = "fuel-exhausted" | "string-memory-exhausted"

export type PortableExpression =
  | { readonly kind: "literal"; readonly valueType: PortableValueType; readonly value: number | boolean | string }
  | { readonly kind: "parameter"; readonly valueType: PortableValueType; readonly index: number; readonly name: string }
  | { readonly kind: "local"; readonly valueType: PortableValueType; readonly index: number; readonly name: string }
  | {
    readonly kind: "unary"
    readonly valueType: PortableScalarType
    readonly operator: "negate" | "positive" | "not"
    readonly value: PortableExpression
  }
  | {
    readonly kind: "binary"
    readonly valueType: PortableValueType
    readonly operator: "add" | "subtract" | "multiply" | "divide" | "concat" | "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "and" | "or"
    readonly left: PortableExpression
    readonly right: PortableExpression
  }
  | {
    readonly kind: "select"
    readonly valueType: PortableValueType
    readonly condition: PortableExpression
    readonly whenTrue: PortableExpression
    readonly whenFalse: PortableExpression
  }
  | {
    /** `.length` of a portable (ASCII) string expression. */
    readonly kind: "string-length"
    readonly valueType: "number"
    readonly value: PortableExpression
  }
  | {
    /** Direct call to a plain (infallible, non-optional) module function. */
    readonly kind: "call"
    readonly valueType: PortableValueType
    readonly callee: string
    readonly arguments: readonly PortableExpression[]
  }
  | {
    /**
     * `Capability.context().field`: a read of one environment slot the host
     * fills before the invocation. The capability/field pair is fixed at
     * compile time; nothing here is a runtime lookup key.
     */
    readonly kind: "capability"
    readonly valueType: PortableValueType
    readonly capability: string
    readonly field: string
  }

type PortableBinaryOperator = Extract<PortableExpression, { readonly kind: "binary" }>["operator"]

export interface PortableErrorField {
  readonly name: string
  readonly valueType: PortableValueType
}

/** One `abstract readonly name: number|boolean|string` capability member. */
export interface PortableCapabilityField {
  readonly name: string
  readonly valueType: PortableValueType
}

/**
 * A nominal Context capability required by this module, with the exact field
 * row the host environment must supply. Identity is compiler-derived, never
 * structural: two identically-shaped capabilities stay different requirements.
 */
export interface PortableCapability {
  readonly name: string
  readonly identity: string
  /** Fields in canonical (name-sorted) order; 1..MAX_CAPABILITY_FIELDS. */
  readonly fields: readonly PortableCapabilityField[]
}

/** Capability name -> field name -> portable value, as supplied by the host. */
export type PortableEnvironment = Readonly<Record<string, Readonly<Record<string, number | boolean | string>>>>

export interface PortableErrorVariant {
  readonly name: string
  readonly identity: string
  /** Zero is success; declared errors receive stable positive tags. */
  readonly tag: number
  /** Portable-value payload fields in constructor declaration order. */
  readonly fields: readonly PortableErrorField[]
}

export type PortableResultContract =
  | { readonly kind: "plain"; readonly valueType: PortableValueType }
  | { readonly kind: "optional"; readonly valueType: PortableValueType }
  | {
    readonly kind: "result"
    readonly valueType: PortableValueType
    readonly errors: readonly PortableErrorVariant[]
  }

export interface PortableLocal {
  readonly name: string
  readonly valueType: PortableValueType
  readonly mutable: boolean
}

export type PortableStatement =
  | { readonly kind: "let"; readonly index: number; readonly name: string; readonly valueType: PortableValueType; readonly value: PortableExpression }
  | { readonly kind: "assign"; readonly index: number; readonly name: string; readonly valueType: PortableValueType; readonly value: PortableExpression }
  | {
    /** `const x = callee(...).unwrap()` for an Optional/Result callee. */
    readonly kind: "bind-call"
    readonly index: number
    readonly name: string
    readonly valueType: PortableValueType
    readonly callee: string
    readonly arguments: readonly PortableExpression[]
  }
  | {
    readonly kind: "if"
    readonly condition: PortableExpression
    readonly whenTrue: readonly PortableStatement[]
    readonly whenFalse: readonly PortableStatement[]
  }
  | {
    readonly kind: "while"
    readonly condition: PortableExpression
    readonly body: readonly PortableStatement[]
    /** Assignments executed after the body and on `continue` (for-loop update). */
    readonly update: readonly PortableStatement[]
  }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "return"; readonly value: PortableExpression }
  | { readonly kind: "present"; readonly value: PortableExpression }
  | { readonly kind: "absent" }
  | {
    readonly kind: "failure"
    readonly identity: string
    readonly tag: number
    readonly arguments: readonly PortableExpression[]
  }
  | {
    /** `return callee(...)` / `return callee(...).unwrap()` for a compatible fallible/optional callee. */
    readonly kind: "tail-call"
    readonly callee: string
    readonly arguments: readonly PortableExpression[]
  }

export interface PortableFunctionIR {
  readonly name: string
  readonly parameters: readonly {
    readonly name: string
    readonly valueType: PortableValueType
  }[]
  /**
   * The inferred requirement row: sorted capability names, transitively closed
   * through ordinary calls. Part of the contract digest because the row is part
   * of the function's static type.
   */
  readonly requirements: readonly string[]
  readonly result: PortableResultContract
  readonly contractDigest: string
  readonly locals: readonly PortableLocal[]
  readonly body: readonly PortableStatement[]
  readonly digest: string
}

export interface PortableModuleIR {
  readonly formatVersion: 4
  readonly moduleId: string
  /** Every capability some function requires, sorted by name. */
  readonly capabilities: readonly PortableCapability[]
  readonly functions: readonly PortableFunctionIR[]
  readonly digest: string
}

export interface PortableModuleArtifact {
  readonly artifactVersion: 1
  readonly kind: "smithers.portable-ir"
  readonly module: PortableModuleIR
  readonly digest: string
}

export interface PortableDiagnostic {
  readonly code: string
  readonly message: string
  readonly line: number
  readonly column: number
}

export class PortableBackendError extends Error {
  constructor(
    readonly diagnostic: PortableDiagnostic
  ) {
    super(`${diagnostic.code} ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`)
    this.name = "PortableBackendError"
  }
}

export type PortableWireExit =
  | { readonly kind: "success"; readonly value: number | boolean | string }
  | { readonly kind: "absent" }
  | {
    readonly kind: "failure"
    readonly error: {
      readonly identity: string
      readonly payload: Readonly<Record<string, number | boolean | string>>
    }
  }
  | { readonly kind: "defect"; readonly defect: PortableDefect }

export interface PortableExecution {
  readonly contractDigest: string
  readonly exit: PortableWireExit
  readonly wireDigest: string
}

export interface PortableWasmBuild {
  readonly formatVersion: 4
  readonly module: PortableModuleIR
  readonly tool: "wat2wasm"
  readonly toolVersion: string
  readonly wat: string
  readonly watDigest: string
  readonly wasm: Uint8Array
  readonly wasmDigest: string
  readonly digest: string
}

export interface PortableWasmOptions {
  readonly wat2wasm?: string
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}

const diagnosticAt = (node: ts.Node | undefined, code: string, message: string): PortableBackendError => {
  const file = node?.getSourceFile()
  const position = file && node ? file.getLineAndCharacterOfPosition(node.getStart(file)) : { line: 0, character: 0 }
  return new PortableBackendError({
    code,
    message,
    line: position.line + 1,
    column: position.character + 1
  })
}

const fail = (code: string, message: string): never => {
  throw new PortableBackendError({ code, message, line: 1, column: 1 })
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind))

const resolvedSymbol = (checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined => {
  const symbol = checker.getSymbolAtLocation(node)
  return symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
}

const validModuleId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 256 && PORTABLE_MODULE_ID.test(value)

/** `__`-prefixed identifiers are reserved for backend-owned WAT symbols. */
const validPortableName = (value: unknown): value is string =>
  typeof value === "string" && PORTABLE_NAME.test(value) && !value.startsWith("__")

const errorIdentity = (moduleId: string, name: string): string =>
  `smithers.error:${moduleId}#${name}@1`

/** Nominal capability identity; structurally identical rows stay distinct. */
const capabilityIdentity = (moduleId: string, name: string): string =>
  `smithers.capability:${moduleId}#${name}@1`

/**
 * The single legal import: `import { Context } from "smthrs/context"`, with
 * no default binding, no namespace binding, no rename, no type-only marker, and
 * no attributes. Anything else — including a second copy — is an external edge.
 */
const isCanonicalContextImport = (node: ts.ImportDeclaration): boolean => {
  const clause = node.importClause
  const bindings = clause?.namedBindings
  return (
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === CONTEXT_MODULE &&
    node.attributes === undefined && clause !== undefined && clause.isTypeOnly !== true &&
    clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) &&
    bindings.elements.length === 1 && bindings.elements[0]!.isTypeOnly !== true &&
    bindings.elements[0]!.propertyName === undefined && bindings.elements[0]!.name.text === "Context"
  )
}

/**
 * Reject author-controlled module resolution before constructing a Program.
 * The checker may read its fixed standard libraries, but portable source can
 * never make it inspect an import, reference directive, or augmentation.
 */
const assertNoExternalSourceEdges = (sourceFile: ts.SourceFile): void => {
  if (
    sourceFile.referencedFiles.length !== 0 ||
    sourceFile.typeReferenceDirectives.length !== 0 ||
    sourceFile.libReferenceDirectives.length !== 0 ||
    sourceFile.amdDependencies.length !== 0 ||
    sourceFile.hasNoDefaultLib
  ) {
    throw diagnosticAt(undefined, "SMITHERS5043", "portable source cannot contain reference directives or external compiler inputs")
  }
  let contextImports = 0
  const visit = (node: ts.Node): void => {
    for (const tag of ts.getJSDocTags(node)) {
      const visitTag = (tagNode: ts.Node): void => {
        if (ts.isJSDocImportTag(tagNode) || ts.isImportTypeNode(tagNode)) {
          throw diagnosticAt(tag, "SMITHERS5043", "portable source cannot contain JSDoc imports or external type edges")
        }
        ts.forEachChild(tagNode, visitTag)
      }
      visitTag(tag)
    }
    // The compiler-owned capability root is the one permitted edge, and it
    // resolves in-process: module resolution is disabled entirely below, so
    // this specifier can never reach the filesystem or author-controlled code.
    if (ts.isImportDeclaration(node) && node.parent === sourceFile && isCanonicalContextImport(node)) {
      contextImports += 1
      if (contextImports > 1) {
        throw diagnosticAt(node, "SMITHERS5043", `portable source may import ${CONTEXT_MODULE} at most once`)
      }
      return
    }
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isImportTypeNode(node) ||
      ts.isExternalModuleReference(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
      (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
    ) {
      throw diagnosticAt(node, "SMITHERS5043", `portable source may only import { Context } from "${CONTEXT_MODULE}"`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const createCheckedProgram = (source: string, parsedSourceFile: ts.SourceFile): {
  readonly sourceFile: ts.SourceFile
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
} => {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: []
  }
  const sourceFile = parsedSourceFile
  const preludeFile = ts.createSourceFile(PRELUDE_NAME, PRELUDE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const contextFile = ts.createSourceFile(CONTEXT_NAME, CONTEXT_DECLARATIONS, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const host = ts.createCompilerHost(options, true)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  const originalReadFile = host.readFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const normalized = resolve(name)
    if (normalized === SOURCE_NAME) return sourceFile
    if (normalized === PRELUDE_NAME) return preludeFile
    if (normalized === CONTEXT_NAME) return contextFile
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  }
  host.fileExists = (name) => {
    const normalized = resolve(name)
    return normalized === SOURCE_NAME || normalized === PRELUDE_NAME || normalized === CONTEXT_NAME || originalFileExists(name)
  }
  host.readFile = (name) => {
    const normalized = resolve(name)
    if (normalized === SOURCE_NAME) return source
    if (normalized === PRELUDE_NAME) return PRELUDE
    if (normalized === CONTEXT_NAME) return CONTEXT_DECLARATIONS
    return originalReadFile(name)
  }
  // No specifier ever resolves to a file. `smthrs/context` binds to the
  // ambient declaration above and every other specifier stays unresolved, so
  // portable source can never pull real code (or `node_modules`) into scope.
  host.resolveModuleNames = (moduleNames) => moduleNames.map(() => undefined)
  const program = ts.createProgram({ rootNames: [SOURCE_NAME, PRELUDE_NAME, CONTEXT_NAME], options, host })
  return {
    sourceFile: program.getSourceFile(SOURCE_NAME) ?? sourceFile,
    program,
    checker: program.getTypeChecker()
  }
}

/** The whole portable value domain: parameters, locals, returns, and payloads. */
const valueTypeNode = (node: ts.TypeNode, role: string): PortableValueType => {
  if (node.kind === ts.SyntaxKind.NumberKeyword) return "number"
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return "boolean"
  if (node.kind === ts.SyntaxKind.StringKeyword) return "string"
  throw diagnosticAt(node, "SMITHERS5004", `${role} must be exactly number, boolean, or string in the bounded portable backend`)
}

interface ValueBinding {
  readonly kind: "parameter" | "local"
  readonly index: number
  readonly name: string
  readonly valueType: PortableValueType
  readonly mutable: boolean
}

interface FunctionContract {
  readonly name: string
  readonly parameters: readonly { readonly name: string; readonly valueType: PortableValueType }[]
  readonly result: PortableResultContract
}

interface DeclaredCapability {
  readonly name: string
  readonly identity: string
  readonly fields: readonly PortableCapabilityField[]
}

interface LoweringContext {
  readonly checker: ts.TypeChecker
  readonly bindings: Map<ts.Symbol, ValueBinding>
  readonly locals: PortableLocal[]
  readonly result: PortableResultContract
  readonly errorsBySymbol: ReadonlyMap<ts.Symbol, PortableErrorVariant>
  readonly contractsBySymbol: ReadonlyMap<ts.Symbol, FunctionContract>
  /** Every capability class declared in this module, by class symbol. */
  readonly capabilitiesBySymbol: ReadonlyMap<ts.Symbol, DeclaredCapability>
  /** `const config = Config.context()` bindings; erased, never a Wasm local. */
  readonly capabilityBindings: Map<ts.Symbol, DeclaredCapability>
  /** Identifier text of every capability binding, for name-collision checks. */
  readonly capabilityBindingNames: Set<string>
  /** Capabilities this function reads directly; callees add theirs by closure. */
  readonly requirements: Set<string>
  readonly callEdges: Array<{ readonly callee: string; readonly node: ts.Node }>
  readonly functionName: string
  loopDepth: number
}

const skipParens = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? skipParens(node.expression) : node

/** `receiver(...).unwrap()` with no arguments; returns the receiver call. */
const unwrapReceiverCall = (node: ts.Expression): ts.CallExpression | undefined => {
  const call = skipParens(node)
  if (!ts.isCallExpression(call) || call.arguments.length !== 0) return undefined
  const access = call.expression
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== "unwrap") return undefined
  const receiver = skipParens(access.expression)
  return ts.isCallExpression(receiver) ? receiver : undefined
}

/**
 * A capability instance reference: either the compiler-recognized
 * `Capability.context()` call, or an identifier bound to one by a preceding
 * `const capability = Capability.context()`. Returns `undefined` for anything
 * that is not a capability reference, so ordinary lowering continues.
 */
const capabilityReference = (
  node: ts.Expression,
  context: LoweringContext
): DeclaredCapability | undefined => {
  const expression = skipParens(node)
  if (ts.isIdentifier(expression)) {
    const symbol = resolvedSymbol(context.checker, expression)
    return symbol === undefined ? undefined : context.capabilityBindings.get(symbol)
  }
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return undefined
  const access = expression.expression
  const receiver = skipParens(access.expression)
  if (!ts.isIdentifier(receiver)) return undefined
  const symbol = resolvedSymbol(context.checker, receiver)
  const capability = symbol && context.capabilitiesBySymbol.get(symbol)
  if (capability === undefined) return undefined
  if (access.name.text !== "context") {
    throw diagnosticAt(expression, "SMITHERS5072", `portable capability ${capability.name} is only accessible through ${capability.name}.context()`)
  }
  if (expression.arguments.length !== 0 || expression.typeArguments !== undefined) {
    throw diagnosticAt(expression, "SMITHERS5072", "portable capability access must be exactly `Capability.context()` with no arguments or type arguments")
  }
  // Per the requirements specification the `.context()` CALL is what adds the
  // nominal identity to the enclosing row — reading a field afterwards is not a
  // second requirement, and never reading one does not remove it.
  context.requirements.add(capability.name)
  return capability
}

/** Read one declared capability field, recording the requirement. */
const lowerCapabilityField = (
  node: ts.PropertyAccessExpression,
  capability: DeclaredCapability,
  context: LoweringContext
): PortableExpression => {
  const field = capability.fields.find((candidate) => candidate.name === node.name.text)
  if (field === undefined) {
    throw diagnosticAt(node, "SMITHERS5071", `portable capability ${capability.name} has no value field '${node.name.text}'; capability methods need host effects and cannot be lowered into an import-free module`)
  }
  context.requirements.add(capability.name)
  return { kind: "capability", valueType: field.valueType, capability: capability.name, field: field.name }
}

/** Direct identifier call to a declared portable function, if any. */
const portableCallee = (
  node: ts.Expression,
  context: LoweringContext
): { readonly call: ts.CallExpression; readonly contract: FunctionContract } | undefined => {
  const call = skipParens(node)
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return undefined
  const symbol = resolvedSymbol(context.checker, call.expression)
  const contract = symbol && context.contractsBySymbol.get(symbol)
  return contract === undefined ? undefined : { call, contract }
}

const lowerCallArguments = (
  call: ts.CallExpression,
  contract: FunctionContract,
  context: LoweringContext,
  depth: number
): readonly PortableExpression[] => {
  if (call.arguments.length !== contract.parameters.length) {
    throw diagnosticAt(call, "SMITHERS5062", `portable call to ${contract.name} needs exactly ${contract.parameters.length} arguments`)
  }
  return call.arguments.map((argument, index) => {
    const lowered = lowerExpression(argument, context, depth + 1)
    const expected = contract.parameters[index]!
    if (lowered.valueType !== expected.valueType) {
      throw diagnosticAt(argument, "SMITHERS5062", `portable call argument ${expected.name} must be ${expected.valueType}`)
    }
    return lowered
  })
}

const lowerExpression = (node: ts.Expression, context: LoweringContext, depth = 0): PortableExpression => {
  if (depth > MAX_IR_DEPTH) throw diagnosticAt(node, "SMITHERS5005", "portable expression exceeds the lowering depth limit")
  const { checker } = context
  if (ts.isParenthesizedExpression(node)) return lowerExpression(node.expression, context, depth + 1)
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text)
    if (!Number.isFinite(value)) throw diagnosticAt(node, "SMITHERS5006", "portable numeric literals must be finite")
    return { kind: "literal", valueType: "number", value }
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "literal", valueType: "boolean", value: node.kind === ts.SyntaxKind.TrueKeyword }
  }
  if (ts.isStringLiteral(node)) {
    if (!PORTABLE_STRING_CONTENT.test(node.text) || Buffer.byteLength(node.text, "utf8") > MAX_STRING_BYTES) {
      throw diagnosticAt(node, "SMITHERS5067", `portable string literals must be printable ASCII of at most ${MAX_STRING_BYTES} bytes`)
    }
    return { kind: "literal", valueType: "string", value: node.text }
  }
  if (ts.isPropertyAccessExpression(node)) {
    // Capability field reads bind tighter than `.length` so a capability whose
    // field is literally named `length` still reads that field.
    const capability = capabilityReference(node.expression, context)
    if (capability !== undefined) return lowerCapabilityField(node, capability, context)
    const receiver = skipParens(node.expression)
    if (ts.isIdentifier(receiver)) {
      // `Config.anything`: the capability CLASS has no readable surface at all,
      // not even the members TypeScript gives every class object.
      const receiverSymbol = resolvedSymbol(checker, receiver)
      const receiverCapability = receiverSymbol && context.capabilitiesBySymbol.get(receiverSymbol)
      if (receiverCapability !== undefined) {
        throw diagnosticAt(node, "SMITHERS5072", `portable capability ${receiverCapability.name} is only accessible through ${receiverCapability.name}.context()`)
      }
    }
    if (node.name.text === "length") {
      const value = lowerExpression(node.expression, context, depth + 1)
      if (value.valueType !== "string") {
        throw diagnosticAt(node, "SMITHERS5067", "portable .length requires a portable string receiver")
      }
      return { kind: "string-length", valueType: "number", value }
    }
  }
  if (ts.isIdentifier(node)) {
    const symbol = resolvedSymbol(checker, node)
    if (symbol !== undefined && context.capabilityBindings.has(symbol)) {
      throw diagnosticAt(node, "SMITHERS5072", `portable capability instance '${node.text}' is not a portable value; read one of its declared fields`)
    }
    if (symbol !== undefined && context.capabilitiesBySymbol.has(symbol)) {
      throw diagnosticAt(node, "SMITHERS5072", `portable capability ${node.text} is only accessible through ${node.text}.context()`)
    }
    const binding = symbol && context.bindings.get(symbol)
    if (binding === undefined) {
      throw diagnosticAt(node, "SMITHERS5007", `portable expression cannot read '${node.text}' or ambient state`)
    }
    return binding.kind === "parameter"
      ? { kind: "parameter", valueType: binding.valueType, index: binding.index, name: binding.name }
      : { kind: "local", valueType: binding.valueType, index: binding.index, name: binding.name }
  }
  if (ts.isNewExpression(node)) {
    // Redundant backstop: capabilities are required to be `abstract`, so the
    // checker already rejects `new Config()` with SMITHERS5003. This keeps the
    // fabrication rule stated inside the backend rather than resting on a
    // checker detail.
    const constructed = ts.isIdentifier(node.expression) ? resolvedSymbol(checker, node.expression) : undefined
    if (constructed !== undefined && context.capabilitiesBySymbol.has(constructed)) {
      throw diagnosticAt(node, "SMITHERS5072", "portable capabilities cannot be constructed; they are supplied by the host environment")
    }
  }
  if (ts.isCallExpression(node)) {
    if (ts.isPropertyAccessExpression(node.expression)) {
      const receiverCapability = capabilityReference(node.expression.expression, context)
      if (receiverCapability !== undefined) {
        throw diagnosticAt(node, "SMITHERS5071", `portable capability ${receiverCapability.name} exposes value fields only; capability method calls need host effects and cannot be lowered into an import-free module`)
      }
    }
    if (capabilityReference(node, context) !== undefined) {
      throw diagnosticAt(node, "SMITHERS5072", "a portable capability instance must be consumed by reading a declared field or bound with `const`")
    }
    if (unwrapReceiverCall(node) !== undefined) {
      throw diagnosticAt(node, "SMITHERS5062", "portable unwrap propagation is only supported as `const x = f(...).unwrap()` or `return f(...).unwrap()`")
    }
    const direct = portableCallee(node, context)
    if (direct === undefined) {
      throw diagnosticAt(node, "SMITHERS5016", "unsupported portable expression: only direct calls to declared portable functions are callable")
    }
    if (direct.contract.name === context.functionName) {
      throw diagnosticAt(node, "SMITHERS5061", "recursive portable calls are rejected in the bounded backend")
    }
    if (direct.contract.result.kind !== "plain") {
      throw diagnosticAt(node, "SMITHERS5062", `portable ${direct.contract.result.kind === "optional" ? "Optional" : "Result"} call must be consumed as \`const x = f(...).unwrap()\`, \`return f(...).unwrap()\`, or a compatible \`return f(...)\``)
    }
    const callArguments = lowerCallArguments(direct.call, direct.contract, context, depth)
    context.callEdges.push({ callee: direct.contract.name, node })
    return { kind: "call", valueType: direct.contract.result.valueType, callee: direct.contract.name, arguments: callArguments }
  }
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
      throw diagnosticAt(node, "SMITHERS5009", "portable increment/decrement is only supported as its own statement")
    }
    const value = lowerExpression(node.operand, context, depth + 1)
    if (node.operator === ts.SyntaxKind.ExclamationToken) {
      if (value.valueType !== "boolean") throw diagnosticAt(node, "SMITHERS5008", "logical not requires boolean")
      return { kind: "unary", valueType: "boolean", operator: "not", value }
    }
    if (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken) {
      if (value.valueType !== "number") throw diagnosticAt(node, "SMITHERS5008", "numeric unary operators require number")
      return {
        kind: "unary",
        valueType: "number",
        operator: node.operator === ts.SyntaxKind.PlusToken ? "positive" : "negate",
        value
      }
    }
    throw diagnosticAt(node, "SMITHERS5009", "unsupported portable unary operator")
  }
  if (ts.isConditionalExpression(node)) {
    const condition = lowerExpression(node.condition, context, depth + 1)
    const whenTrue = lowerExpression(node.whenTrue, context, depth + 1)
    const whenFalse = lowerExpression(node.whenFalse, context, depth + 1)
    if (condition.valueType !== "boolean" || whenTrue.valueType !== whenFalse.valueType) {
      throw diagnosticAt(node, "SMITHERS5010", "portable conditional requires a boolean condition and equal scalar arm types")
    }
    return { kind: "select", valueType: whenTrue.valueType, condition, whenTrue, whenFalse }
  }
  if (ts.isBinaryExpression(node)) {
    if (assignmentOperator(node.operatorToken.kind) !== undefined) {
      throw diagnosticAt(node, "SMITHERS5064", "portable assignment is only supported as its own statement")
    }
    const left = lowerExpression(node.left, context, depth + 1)
    const right = lowerExpression(node.right, context, depth + 1)
    const numeric = new Map<ts.SyntaxKind, PortableBinaryOperator>([
      [ts.SyntaxKind.PlusToken, "add"],
      [ts.SyntaxKind.MinusToken, "subtract"],
      [ts.SyntaxKind.AsteriskToken, "multiply"],
      [ts.SyntaxKind.SlashToken, "divide"]
    ])
    const comparison = new Map<ts.SyntaxKind, PortableBinaryOperator>([
      [ts.SyntaxKind.LessThanToken, "lt"],
      [ts.SyntaxKind.LessThanEqualsToken, "lte"],
      [ts.SyntaxKind.GreaterThanToken, "gt"],
      [ts.SyntaxKind.GreaterThanEqualsToken, "gte"]
    ])
    const equality = new Map<ts.SyntaxKind, PortableBinaryOperator>([
      [ts.SyntaxKind.EqualsEqualsEqualsToken, "eq"],
      [ts.SyntaxKind.ExclamationEqualsEqualsToken, "neq"]
    ])
    const logical = new Map<ts.SyntaxKind, PortableBinaryOperator>([
      [ts.SyntaxKind.AmpersandAmpersandToken, "and"],
      [ts.SyntaxKind.BarBarToken, "or"]
    ])
    const operator = numeric.get(node.operatorToken.kind)
    if (operator !== undefined) {
      if (operator === "add" && left.valueType === "string" && right.valueType === "string") {
        return { kind: "binary", valueType: "string", operator: "concat", left, right }
      }
      if (left.valueType !== "number" || right.valueType !== "number") {
        throw diagnosticAt(node, "SMITHERS5011", operator === "add"
          ? "portable + requires two numbers or two portable strings"
          : "portable arithmetic requires number operands")
      }
      return { kind: "binary", valueType: "number", operator, left, right }
    }
    const comparisonOperator = comparison.get(node.operatorToken.kind)
    if (comparisonOperator !== undefined) {
      const stringOperands = left.valueType === "string" && right.valueType === "string"
      if (!stringOperands && (left.valueType !== "number" || right.valueType !== "number")) {
        throw diagnosticAt(node, "SMITHERS5012", "portable ordering requires two numbers or two portable strings")
      }
      return { kind: "binary", valueType: "boolean", operator: comparisonOperator, left, right }
    }
    const equalityOperator = equality.get(node.operatorToken.kind)
    if (equalityOperator !== undefined) {
      if (left.valueType !== right.valueType) throw diagnosticAt(node, "SMITHERS5013", "portable equality operands must have equal types")
      return { kind: "binary", valueType: "boolean", operator: equalityOperator, left, right }
    }
    const logicalOperator = logical.get(node.operatorToken.kind)
    if (logicalOperator !== undefined) {
      if (left.valueType !== "boolean" || right.valueType !== "boolean") {
        throw diagnosticAt(node, "SMITHERS5014", "portable logical operators require boolean operands")
      }
      return { kind: "binary", valueType: "boolean", operator: logicalOperator, left, right }
    }
    throw diagnosticAt(node.operatorToken, "SMITHERS5015", "unsupported portable binary operator")
  }
  throw diagnosticAt(node, "SMITHERS5016", `unsupported portable expression kind ${ts.SyntaxKind[node.kind]}`)
}

const assignmentOperator = (kind: ts.SyntaxKind): PortableBinaryOperator | "assign" | undefined => {
  switch (kind) {
    case ts.SyntaxKind.EqualsToken: return "assign"
    case ts.SyntaxKind.PlusEqualsToken: return "add"
    case ts.SyntaxKind.MinusEqualsToken: return "subtract"
    case ts.SyntaxKind.AsteriskEqualsToken: return "multiply"
    case ts.SyntaxKind.SlashEqualsToken: return "divide"
    default: return undefined
  }
}

const statementsOf = (statement: ts.Statement): readonly ts.Statement[] =>
  ts.isBlock(statement) ? statement.statements : [statement]

interface LoweredStatements {
  readonly statements: readonly PortableStatement[]
  /** True when control can fall past the end of the sequence. */
  readonly completes: boolean
}

const requireMutableLocal = (
  node: ts.Node,
  name: ts.Identifier,
  context: LoweringContext
): ValueBinding => {
  const symbol = resolvedSymbol(context.checker, name)
  if (symbol !== undefined && context.capabilityBindings.has(symbol)) {
    throw diagnosticAt(node, "SMITHERS5072", `portable capability binding '${name.text}' cannot be reassigned`)
  }
  const binding = symbol && context.bindings.get(symbol)
  if (binding === undefined) throw diagnosticAt(node, "SMITHERS5064", `portable assignment target '${name.text}' is not a declared local`)
  if (binding.kind === "parameter") throw diagnosticAt(node, "SMITHERS5064", "portable parameters are immutable; copy into a `let` local first")
  if (!binding.mutable) throw diagnosticAt(node, "SMITHERS5064", `portable const local '${name.text}' cannot be reassigned`)
  return binding
}

const declareLocal = (
  node: ts.Node,
  name: ts.Identifier,
  valueType: PortableValueType,
  mutable: boolean,
  context: LoweringContext
): ValueBinding => {
  if (!validPortableName(name.text)) {
    throw diagnosticAt(node, "SMITHERS5063", "portable local names must be plain identifiers without the reserved `__` prefix")
  }
  if (context.locals.length >= MAX_LOCALS) {
    throw diagnosticAt(node, "SMITHERS5063", `portable functions support at most ${MAX_LOCALS} locals`)
  }
  const taken = [...context.bindings.values()].some((binding) => binding.name === name.text) ||
    context.capabilityBindingNames.has(name.text)
  if (taken) throw diagnosticAt(node, "SMITHERS5063", `portable local '${name.text}' duplicates another parameter or local name`)
  const symbol = resolvedSymbol(context.checker, name)
  if (symbol === undefined) throw diagnosticAt(name, "SMITHERS5063", "portable local has no checker identity")
  const binding: ValueBinding = { kind: "local", index: context.locals.length, name: name.text, valueType, mutable }
  context.locals.push({ name: name.text, valueType, mutable })
  context.bindings.set(symbol, binding)
  return binding
}

/** Lower a fallible/optional direct call used in a propagation position. */
const lowerPropagatingCall = (
  node: ts.Expression,
  context: LoweringContext,
  role: "bind" | "tail"
): { readonly contract: FunctionContract; readonly arguments: readonly PortableExpression[] } | undefined => {
  const receiver = unwrapReceiverCall(node)
  const target = receiver === undefined
    ? portableCallee(node, context)
    : portableCallee(receiver, context)
  if (target === undefined) {
    if (receiver !== undefined) {
      throw diagnosticAt(node, "SMITHERS5062", "portable unwrap receivers must be direct calls to declared portable functions")
    }
    return undefined
  }
  const { call, contract } = target
  if (contract.result.kind === "plain") {
    if (receiver !== undefined) {
      throw diagnosticAt(node, "SMITHERS5062", "portable unwrap receivers must return Optional or Result")
    }
    return undefined
  }
  if (role === "bind" && receiver === undefined) {
    throw diagnosticAt(node, "SMITHERS5062", "portable Optional/Result call bindings must unwrap: `const x = f(...).unwrap()`")
  }
  if (contract.name === context.functionName) {
    throw diagnosticAt(node, "SMITHERS5061", "recursive portable calls are rejected in the bounded backend")
  }
  if (contract.result.kind === "optional" && context.result.kind !== "optional") {
    throw diagnosticAt(node, "SMITHERS5062", "portable Optional propagation requires an enclosing Optional-returning function")
  }
  if (contract.result.kind === "result") {
    if (context.result.kind !== "result") {
      throw diagnosticAt(node, "SMITHERS5062", "portable Result propagation requires an enclosing Result-returning function")
    }
    const declared = new Set(context.result.errors.map((error) => error.identity))
    const missing = contract.result.errors.find((error) => !declared.has(error.identity))
    if (missing !== undefined) {
      throw diagnosticAt(node, "SMITHERS5062", `portable caller's Result row must include propagated error ${missing.name}`)
    }
  }
  if (role === "tail" && receiver === undefined && contract.result.kind !== context.result.kind) {
    throw diagnosticAt(node, "SMITHERS5062", "portable tail return requires the callee and caller channels to match")
  }
  const callArguments = lowerCallArguments(call, contract, context, 0)
  context.callEdges.push({ callee: contract.name, node })
  return { contract, arguments: callArguments }
}

const lowerVariableDeclarations = (
  list: ts.VariableDeclarationList,
  context: LoweringContext
): readonly PortableStatement[] => {
  if ((list.flags & ts.NodeFlags.Let) === 0 && (list.flags & ts.NodeFlags.Const) === 0) {
    throw diagnosticAt(list, "SMITHERS5063", "portable locals must use let or const")
  }
  const mutable = (list.flags & ts.NodeFlags.Const) === 0
  const lowered: PortableStatement[] = []
  for (const declaration of list.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      throw diagnosticAt(declaration, "SMITHERS5063", "portable locals must be plain identifiers")
    }
    if (declaration.initializer === undefined || declaration.exclamationToken !== undefined) {
      throw diagnosticAt(declaration, "SMITHERS5063", "portable locals require an initializer")
    }
    const declaredName = declaration.name
    const capability = capabilityReference(declaration.initializer, context)
    if (capability !== undefined) {
      // A capability binding is compile-time only: it names a service, not a
      // value, so it never becomes a Wasm local or an evaluator slot.
      if (list.declarations.length !== 1) {
        throw diagnosticAt(declaration, "SMITHERS5072", "portable capability bindings require a single declarator")
      }
      if (mutable) throw diagnosticAt(declaration, "SMITHERS5072", "portable capability bindings must use `const`")
      if (declaration.type !== undefined) {
        throw diagnosticAt(declaration, "SMITHERS5072", "portable capability bindings cannot carry a type annotation")
      }
      if (!validPortableName(declaredName.text)) {
        throw diagnosticAt(declaration, "SMITHERS5063", "portable capability binding names must be plain identifiers without the reserved `__` prefix")
      }
      const taken = [...context.bindings.values()].some((binding) => binding.name === declaredName.text) ||
        context.capabilityBindingNames.has(declaredName.text)
      if (taken) {
        throw diagnosticAt(declaration, "SMITHERS5063", `portable capability binding '${declaredName.text}' duplicates another parameter, local, or capability name`)
      }
      const symbol = resolvedSymbol(context.checker, declaredName)
      if (symbol === undefined) throw diagnosticAt(declaredName, "SMITHERS5072", "portable capability binding has no checker identity")
      context.capabilityBindings.set(symbol, capability)
      context.capabilityBindingNames.add(declaredName.text)
      continue
    }
    const annotated = declaration.type === undefined ? undefined : valueTypeNode(declaration.type, "local")
    const propagating = lowerPropagatingCall(declaration.initializer, context, "bind")
    if (propagating !== undefined) {
      if (list.declarations.length !== 1) {
        throw diagnosticAt(declaration, "SMITHERS5063", "portable unwrap initializers require a single declarator")
      }
      const valueType = propagating.contract.result.valueType
      if (annotated !== undefined && annotated !== valueType) {
        throw diagnosticAt(declaration, "SMITHERS5063", `portable local annotation must match the callee's ${valueType} result`)
      }
      const binding = declareLocal(declaration, declaration.name, valueType, mutable, context)
      lowered.push({
        kind: "bind-call",
        index: binding.index,
        name: binding.name,
        valueType,
        callee: propagating.contract.name,
        arguments: propagating.arguments
      })
      continue
    }
    const value = lowerExpression(declaration.initializer, context)
    if (annotated !== undefined && annotated !== value.valueType) {
      throw diagnosticAt(declaration, "SMITHERS5063", `portable local annotation must match its ${value.valueType} initializer`)
    }
    const binding = declareLocal(declaration, declaration.name, value.valueType, mutable, context)
    lowered.push({ kind: "let", index: binding.index, name: binding.name, valueType: value.valueType, value })
  }
  return lowered
}

/** Assignment-shaped expression statements: `x = e`, `x += e`, `x++`, `--x`. */
const lowerAssignmentStatement = (
  statementExpression: ts.Expression,
  context: LoweringContext
): PortableStatement => {
  const expression = skipParens(statementExpression)
  if (ts.isBinaryExpression(expression)) {
    const operator = assignmentOperator(expression.operatorToken.kind)
    if (operator === undefined) {
      throw diagnosticAt(statementExpression, "SMITHERS5025", "portable expression statements must be assignments or increments")
    }
    const targetNode = skipParens(expression.left)
    if (!ts.isIdentifier(targetNode)) throw diagnosticAt(expression, "SMITHERS5064", "portable assignment targets must be local identifiers")
    const binding = requireMutableLocal(expression, targetNode, context)
    if (unwrapReceiverCall(expression.right) !== undefined) {
      throw diagnosticAt(expression, "SMITHERS5062", "portable unwrap results must bind through a new `const`/`let` declaration, not reassignment")
    }
    const right = lowerExpression(expression.right, context)
    if (operator === "assign") {
      if (right.valueType !== binding.valueType) {
        throw diagnosticAt(expression, "SMITHERS5064", `portable assignment to '${binding.name}' must produce ${binding.valueType}`)
      }
      return { kind: "assign", index: binding.index, name: binding.name, valueType: binding.valueType, value: right }
    }
    if (operator === "add" && binding.valueType === "string") {
      if (right.valueType !== "string") {
        throw diagnosticAt(expression, "SMITHERS5064", "portable string append (+=) requires a portable string operand")
      }
      return {
        kind: "assign",
        index: binding.index,
        name: binding.name,
        valueType: "string",
        value: {
          kind: "binary",
          valueType: "string",
          operator: "concat",
          left: { kind: "local", valueType: "string", index: binding.index, name: binding.name },
          right
        }
      }
    }
    if (binding.valueType !== "number" || right.valueType !== "number") {
      throw diagnosticAt(expression, "SMITHERS5064", "portable compound assignment requires number operands")
    }
    return {
      kind: "assign",
      index: binding.index,
      name: binding.name,
      valueType: "number",
      value: {
        kind: "binary",
        valueType: "number",
        operator,
        left: { kind: "local", valueType: "number", index: binding.index, name: binding.name },
        right
      }
    }
  }
  if (
    (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) &&
    (expression.operator === ts.SyntaxKind.PlusPlusToken || expression.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    const operand = skipParens(expression.operand)
    if (!ts.isIdentifier(operand)) throw diagnosticAt(expression, "SMITHERS5064", "portable increment targets must be local identifiers")
    const binding = requireMutableLocal(expression, operand, context)
    if (binding.valueType !== "number") throw diagnosticAt(expression, "SMITHERS5064", "portable increment requires a number local")
    return {
      kind: "assign",
      index: binding.index,
      name: binding.name,
      valueType: "number",
      value: {
        kind: "binary",
        valueType: "number",
        operator: expression.operator === ts.SyntaxKind.PlusPlusToken ? "add" : "subtract",
        left: { kind: "local", valueType: "number", index: binding.index, name: binding.name },
        right: { kind: "literal", valueType: "number", value: 1 }
      }
    }
  }
  throw diagnosticAt(statementExpression, "SMITHERS5025", "portable expression statements must be assignments or increments")
}

const lowerForParts = (
  statement: ts.ForStatement,
  context: LoweringContext,
  depth: number
): readonly PortableStatement[] => {
  const lowered: PortableStatement[] = []
  if (statement.initializer !== undefined) {
    if (!ts.isVariableDeclarationList(statement.initializer)) {
      throw diagnosticAt(statement.initializer, "SMITHERS5065", "portable for-loop initializers must be let/const declarations")
    }
    lowered.push(...lowerVariableDeclarations(statement.initializer, context))
  }
  const condition: PortableExpression = statement.condition === undefined
    ? { kind: "literal", valueType: "boolean", value: true }
    : lowerExpression(statement.condition, context)
  if (condition.valueType !== "boolean") {
    throw diagnosticAt(statement.condition ?? statement, "SMITHERS5065", "portable loop conditions must be boolean")
  }
  const update: PortableStatement[] = []
  if (statement.incrementor !== undefined) {
    update.push(lowerAssignmentStatement(statement.incrementor, context))
  }
  const body = lowerStatements(statementsOf(statement.statement), { ...context, loopDepth: context.loopDepth + 1 }, depth + 1)
  lowered.push({ kind: "while", condition, body: body.statements, update })
  return lowered
}

const lowerStatements = (
  statements: readonly ts.Statement[],
  context: LoweringContext,
  depth: number
): LoweredStatements => {
  if (depth > MAX_IR_DEPTH) throw diagnosticAt(statements[0], "SMITHERS5017", "portable body exceeds the lowering depth limit")
  const lowered: PortableStatement[] = []
  let completes = true
  for (const statement of statements) {
    if (!completes) throw diagnosticAt(statement, "SMITHERS5019", "statements after a terminal portable statement are unreachable/unsupported")
    if (ts.isEmptyStatement(statement)) continue
    if (ts.isBlock(statement)) {
      const inner = lowerStatements(statement.statements, context, depth + 1)
      lowered.push(...inner.statements)
      completes = inner.completes
      continue
    }
    if (ts.isVariableStatement(statement)) {
      lowered.push(...lowerVariableDeclarations(statement.declarationList, context))
      continue
    }
    if (ts.isExpressionStatement(statement)) {
      lowered.push(lowerAssignmentStatement(statement.expression, context))
      continue
    }
    if (ts.isIfStatement(statement)) {
      const condition = lowerExpression(statement.expression, context)
      if (condition.valueType !== "boolean") throw diagnosticAt(statement.expression, "SMITHERS5018", "portable if condition must be boolean")
      const whenTrue = lowerStatements(statementsOf(statement.thenStatement), context, depth + 1)
      const whenFalse = statement.elseStatement === undefined
        ? { statements: [], completes: true } as LoweredStatements
        : lowerStatements(statementsOf(statement.elseStatement), context, depth + 1)
      lowered.push({ kind: "if", condition, whenTrue: whenTrue.statements, whenFalse: whenFalse.statements })
      completes = whenTrue.completes || whenFalse.completes
      continue
    }
    if (ts.isWhileStatement(statement)) {
      const condition = lowerExpression(statement.expression, context)
      if (condition.valueType !== "boolean") throw diagnosticAt(statement.expression, "SMITHERS5065", "portable loop conditions must be boolean")
      const body = lowerStatements(statementsOf(statement.statement), { ...context, loopDepth: context.loopDepth + 1 }, depth + 1)
      lowered.push({ kind: "while", condition, body: body.statements, update: [] })
      continue
    }
    if (ts.isForStatement(statement)) {
      lowered.push(...lowerForParts(statement, context, depth))
      continue
    }
    if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) {
      if (statement.label !== undefined) throw diagnosticAt(statement, "SMITHERS5065", "portable loops do not support labels")
      if (context.loopDepth === 0) throw diagnosticAt(statement, "SMITHERS5065", "portable break/continue must appear inside a loop")
      lowered.push({ kind: ts.isBreakStatement(statement) ? "break" : "continue" })
      completes = false
      continue
    }
    if (ts.isReturnStatement(statement)) {
      lowered.push(lowerReturn(statement, context))
      completes = false
      continue
    }
    if (ts.isThrowStatement(statement)) {
      lowered.push(lowerThrow(statement, context))
      completes = false
      continue
    }
    throw diagnosticAt(statement, "SMITHERS5025", `unsupported portable statement ${ts.SyntaxKind[statement.kind]}`)
  }
  return { statements: lowered, completes }
}

const lowerReturn = (statement: ts.ReturnStatement, context: LoweringContext): PortableStatement => {
  if (statement.expression === undefined) throw diagnosticAt(statement, "SMITHERS5020", "portable return requires a value")
  const expression = statement.expression
  const undefinedSymbol = ts.isIdentifier(expression) && expression.text === "undefined"
    ? resolvedSymbol(context.checker, expression)
    : undefined
  if (context.result.kind === "optional" && (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined" &&
      (undefinedSymbol === undefined || !context.bindings.has(undefinedSymbol)))
  )) {
    return { kind: "absent" }
  }
  const propagating = lowerPropagatingCall(expression, context, "tail")
  if (propagating !== undefined) {
    if (propagating.contract.result.valueType !== context.result.valueType) {
      throw diagnosticAt(expression, "SMITHERS5021", `portable tail call must produce ${context.result.valueType}`)
    }
    return { kind: "tail-call", callee: propagating.contract.name, arguments: propagating.arguments }
  }
  const value = lowerExpression(expression, context)
  if (value.valueType !== context.result.valueType) {
    throw diagnosticAt(expression, "SMITHERS5021", `portable return must produce ${context.result.valueType}`)
  }
  return context.result.kind === "optional"
    ? { kind: "present", value }
    : { kind: "return", value }
}

const lowerThrow = (statement: ts.ThrowStatement, context: LoweringContext): PortableStatement => {
  if (context.result.kind !== "result") {
    throw diagnosticAt(statement, "SMITHERS5022", "only a Result-returning portable function may throw a recoverable Error")
  }
  if (!ts.isNewExpression(statement.expression)) {
    throw diagnosticAt(statement.expression, "SMITHERS5023", "portable failures require `throw new DeclaredError(...)`")
  }
  const symbol = resolvedSymbol(context.checker, statement.expression.expression)
  const variant = symbol && context.errorsBySymbol.get(symbol)
  if (variant === undefined || !context.result.errors.some((error) => error.identity === variant.identity)) {
    throw diagnosticAt(statement.expression, "SMITHERS5024", "thrown Error is not in the declared portable Result failure row")
  }
  const callArguments = statement.expression.arguments ?? []
  if (callArguments.length !== variant.fields.length) {
    throw diagnosticAt(statement.expression, "SMITHERS5066", `portable failure ${variant.name} requires exactly ${variant.fields.length} payload arguments`)
  }
  const loweredArguments = callArguments.map((argument, index) => {
    const lowered = lowerExpression(argument, context)
    const field = variant.fields[index]!
    if (lowered.valueType !== field.valueType) {
      throw diagnosticAt(argument, "SMITHERS5066", `portable failure payload ${field.name} must be ${field.valueType}`)
    }
    return lowered
  })
  return { kind: "failure", identity: variant.identity, tag: variant.tag, arguments: loweredArguments }
}

const typeReferenceIdentity = (
  node: ts.TypeReferenceNode,
  checker: ts.TypeChecker,
  expected: "Result" | "Optional"
): boolean => {
  if (!ts.isIdentifier(node.typeName) || node.typeName.text !== expected) return false
  const symbol = resolvedSymbol(checker, node.typeName)
  return Boolean(symbol?.declarations?.some((declaration) => resolve(declaration.getSourceFile().fileName) === PRELUDE_NAME))
}

const errorTypeNodes = (node: ts.TypeNode): readonly ts.TypeNode[] =>
  ts.isUnionTypeNode(node) ? node.types : [node]

interface DeclaredError {
  readonly name: string
  readonly identity: string
  readonly fields: readonly PortableErrorField[]
}

/** Payload fields come from a single `constructor(readonly f: scalar, ...) { super() }`. */
const parseErrorPayloadFields = (statement: ts.ClassDeclaration): readonly PortableErrorField[] => {
  if (statement.members.length === 0) return []
  const constructorMember = statement.members[0]
  if (
    statement.members.length !== 1 || constructorMember === undefined ||
    !ts.isConstructorDeclaration(constructorMember) || constructorMember.body === undefined ||
    constructorMember.typeParameters !== undefined ||
    (ts.canHaveModifiers(constructorMember) && (ts.getModifiers(constructorMember) ?? []).length !== 0) ||
    (ts.canHaveDecorators(constructorMember) && (ts.getDecorators(constructorMember) ?? []).length !== 0)
  ) {
    throw diagnosticAt(statement, "SMITHERS5035", "portable Error classes may only add one plain constructor of readonly scalar parameter properties")
  }
  const bodyStatements = constructorMember.body.statements
  const superCall = bodyStatements[0]
  if (
    bodyStatements.length !== 1 || superCall === undefined || !ts.isExpressionStatement(superCall) ||
    !ts.isCallExpression(superCall.expression) ||
    superCall.expression.expression.kind !== ts.SyntaxKind.SuperKeyword ||
    superCall.expression.arguments.length !== 0
  ) {
    throw diagnosticAt(constructorMember, "SMITHERS5035", "portable Error constructors must contain exactly `super()`")
  }
  if (constructorMember.parameters.length > MAX_ERROR_FIELDS) {
    throw diagnosticAt(constructorMember, "SMITHERS5066", `portable Error payloads support at most ${MAX_ERROR_FIELDS} fields`)
  }
  const fields: PortableErrorField[] = []
  for (const parameter of constructorMember.parameters) {
    const modifiers = ts.canHaveModifiers(parameter) ? ts.getModifiers(parameter) ?? [] : []
    if (
      !ts.isIdentifier(parameter.name) || parameter.type === undefined || parameter.questionToken !== undefined ||
      parameter.dotDotDotToken !== undefined || parameter.initializer !== undefined ||
      modifiers.length !== 1 || modifiers[0]!.kind !== ts.SyntaxKind.ReadonlyKeyword ||
      !validPortableName(parameter.name.text)
    ) {
      throw diagnosticAt(parameter, "SMITHERS5066", "portable Error payload fields must be required `readonly name: number|boolean|string` parameter properties")
    }
    fields.push({ name: parameter.name.text, valueType: valueTypeNode(parameter.type, "Error payload field") })
  }
  if (new Set(fields.map((field) => field.name)).size !== fields.length) {
    throw diagnosticAt(constructorMember, "SMITHERS5066", "portable Error payload field names must be unique")
  }
  return fields
}

const extendsClauseOf = (statement: ts.ClassDeclaration): ts.HeritageClause | undefined =>
  statement.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)

/** True when the class directly extends the compiler-owned `Context` root. */
const extendsPortableContext = (statement: ts.ClassDeclaration, checker: ts.TypeChecker): boolean => {
  const heritageExpression = extendsClauseOf(statement)?.types[0]?.expression
  if (heritageExpression === undefined || !ts.isIdentifier(heritageExpression)) return false
  const symbol = resolvedSymbol(checker, heritageExpression)
  return symbol?.getName() === "Context" &&
    Boolean(symbol.declarations?.some((declaration) => resolve(declaration.getSourceFile().fileName) === CONTEXT_NAME))
}

/**
 * Capability declarations: `abstract class Name extends Context` whose every
 * member is `abstract readonly field: number|boolean|string`. A method,
 * accessor, or constructor means the service needs a host callback, which an
 * import-free module cannot express, so the DECLARATION is rejected rather than
 * some later call site.
 */
const collectDeclaredCapabilities = (
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  moduleId: string
): Map<ts.Symbol, DeclaredCapability> => {
  const capabilities = new Map<ts.Symbol, DeclaredCapability>()
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !extendsPortableContext(statement, checker)) continue
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    const decorators = ts.canHaveDecorators(statement) ? ts.getDecorators(statement) ?? [] : []
    if (
      statement.name === undefined || !validPortableName(statement.name.text) ||
      statement.typeParameters !== undefined || decorators.length !== 0 ||
      !modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword) ||
      modifiers.some((modifier) =>
        modifier.kind !== ts.SyntaxKind.AbstractKeyword && modifier.kind !== ts.SyntaxKind.ExportKeyword) ||
      statement.heritageClauses?.length !== 1 || extendsClauseOf(statement)?.types.length !== 1 ||
      extendsClauseOf(statement)?.types[0]?.typeArguments !== undefined
    ) {
      throw diagnosticAt(statement, "SMITHERS5070", "portable capabilities must be non-generic `abstract class Name extends Context` declarations with no decorators and no other heritage")
    }
    if (capabilities.size >= MAX_CAPABILITIES) {
      throw diagnosticAt(statement, "SMITHERS5070", `portable modules declare at most ${MAX_CAPABILITIES} capabilities`)
    }
    const fields: PortableCapabilityField[] = []
    for (const member of statement.members) {
      if (!ts.isPropertyDeclaration(member)) {
        throw diagnosticAt(member, "SMITHERS5071", "portable capabilities expose value fields only; methods, accessors, and constructors need host effects and cannot be lowered into an import-free module")
      }
      const memberModifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) ?? [] : []
      const memberDecorators = ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []
      const kinds = new Set(memberModifiers.map((modifier) => modifier.kind))
      if (
        !ts.isIdentifier(member.name) || !validPortableName(member.name.text) || member.type === undefined ||
        member.initializer !== undefined || member.questionToken !== undefined ||
        member.exclamationToken !== undefined || memberDecorators.length !== 0 ||
        memberModifiers.length !== 2 || !kinds.has(ts.SyntaxKind.AbstractKeyword) || !kinds.has(ts.SyntaxKind.ReadonlyKeyword)
      ) {
        throw diagnosticAt(member, "SMITHERS5070", "portable capability fields must be `abstract readonly name: number|boolean|string` declarations")
      }
      fields.push({ name: member.name.text, valueType: valueTypeNode(member.type, "capability field") })
    }
    if (fields.length === 0 || fields.length > MAX_CAPABILITY_FIELDS) {
      throw diagnosticAt(statement, "SMITHERS5070", `portable capabilities must declare 1-${MAX_CAPABILITY_FIELDS} value fields`)
    }
    if (new Set(fields.map((field) => field.name)).size !== fields.length) {
      throw diagnosticAt(statement, "SMITHERS5070", "portable capability field names must be unique")
    }
    const symbol = resolvedSymbol(checker, statement.name)
    if (symbol === undefined) throw diagnosticAt(statement.name, "SMITHERS5070", "portable capability class has no checker identity")
    capabilities.set(symbol, {
      name: statement.name.text,
      identity: capabilityIdentity(moduleId, statement.name.text),
      fields: [...fields].sort((left, right) => left.name < right.name ? -1 : 1)
    })
  }
  return capabilities
}

const collectDeclaredErrors = (
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  moduleId: string
): Map<ts.Symbol, DeclaredError> => {
  const declaredErrors = new Map<ts.Symbol, DeclaredError>()
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || extendsPortableContext(statement, checker)) continue
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    const decorators = ts.canHaveDecorators(statement) ? ts.getDecorators(statement) ?? [] : []
    const heritageExpression = statement.heritageClauses?.[0]?.types[0]?.expression
    const heritageSymbol = heritageExpression === undefined ? undefined : resolvedSymbol(checker, heritageExpression)
    if (
      statement.name === undefined ||
      !validPortableName(statement.name.text) ||
      statement.typeParameters !== undefined ||
      decorators.length !== 0 ||
      modifiers.some((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword) ||
      statement.heritageClauses?.length !== 1 ||
      statement.heritageClauses[0]!.token !== ts.SyntaxKind.ExtendsKeyword ||
      statement.heritageClauses[0]!.types.length !== 1 ||
      heritageExpression === undefined ||
      !ts.isIdentifier(heritageExpression) ||
      heritageExpression.text !== "Error" ||
      heritageSymbol === undefined ||
      heritageSymbol.declarations?.some((declaration) => resolve(declaration.getSourceFile().fileName) === SOURCE_NAME)
    ) {
      throw diagnosticAt(statement, "SMITHERS5035", "portable Error classes must be concrete scalar-payload declarations that directly extend the global Error")
    }
    const fields = parseErrorPayloadFields(statement)
    const symbol = resolvedSymbol(checker, statement.name)
    if (symbol === undefined) throw diagnosticAt(statement.name, "SMITHERS5036", "portable Error class has no checker identity")
    declaredErrors.set(symbol, {
      name: statement.name.text,
      identity: errorIdentity(moduleId, statement.name.text),
      fields
    })
  }
  return declaredErrors
}

const parseResultContract = (
  type: ts.TypeNode,
  checker: ts.TypeChecker,
  declaredErrors: ReadonlyMap<ts.Symbol, DeclaredError>
): { readonly result: PortableResultContract; readonly errorsBySymbol: ReadonlyMap<ts.Symbol, PortableErrorVariant> } => {
  if (
    type.kind === ts.SyntaxKind.NumberKeyword || type.kind === ts.SyntaxKind.BooleanKeyword ||
    type.kind === ts.SyntaxKind.StringKeyword
  ) {
    return { result: { kind: "plain", valueType: valueTypeNode(type, "return type") }, errorsBySymbol: new Map() }
  }
  if (!ts.isTypeReferenceNode(type)) {
    throw diagnosticAt(type, "SMITHERS5026", "portable return type must be a portable value, Optional<value>, or Result<value, Error>")
  }
  if (typeReferenceIdentity(type, checker, "Optional")) {
    if (type.typeArguments?.length !== 1) throw diagnosticAt(type, "SMITHERS5027", "Optional requires one portable value argument")
    return {
      result: { kind: "optional", valueType: valueTypeNode(type.typeArguments[0]!, "Optional value") },
      errorsBySymbol: new Map()
    }
  }
  if (!typeReferenceIdentity(type, checker, "Result") || type.typeArguments?.length !== 2) {
    throw diagnosticAt(type, "SMITHERS5028", "portable return type must use the compiler-owned Result/Optional identity")
  }
  const valueType = valueTypeNode(type.typeArguments[0]!, "Result success")
  const resolvedErrors: Array<{ symbol: ts.Symbol } & DeclaredError> = []
  const row = errorTypeNodes(type.typeArguments[1]!)
  if (row.length > MAX_ERRORS) throw diagnosticAt(type, "SMITHERS5029", `portable Result rows support at most ${MAX_ERRORS} errors`)
  for (const errorType of row) {
    if (!ts.isTypeReferenceNode(errorType) || !ts.isIdentifier(errorType.typeName) || errorType.typeArguments) {
      throw diagnosticAt(errorType, "SMITHERS5029", "portable Result failures must be a union of local scalar-payload Error classes")
    }
    const symbol = resolvedSymbol(checker, errorType.typeName)
    const error = symbol && declaredErrors.get(symbol)
    if (symbol === undefined || error === undefined) {
      throw diagnosticAt(errorType, "SMITHERS5029", "portable Result failure is not a local scalar-payload Error class")
    }
    resolvedErrors.push({ symbol, ...error })
  }
  const identities = resolvedErrors.map((error) => error.identity)
  if (new Set(identities).size !== identities.length) throw diagnosticAt(type, "SMITHERS5030", "portable Result failure row has duplicates")
  const sorted = [...resolvedErrors].sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0)
  const variants = sorted.map((error, index) => ({ name: error.name, identity: error.identity, tag: index + 1, fields: error.fields }))
  const byIdentity = new Map(variants.map((variant) => [variant.identity, variant]))
  return {
    result: { kind: "result", valueType, errors: variants },
    errorsBySymbol: new Map(resolvedErrors.map((error) => [error.symbol, byIdentity.get(error.identity)!]))
  }
}

/**
 * With the compiler-owned `Optional<V> = V | null | undefined` alias, the one
 * legal unwrap surface (`<optionalFn>(...).unwrap()`) necessarily trips the
 * checker's possibly-null diagnostics on the receiver. Suppress exactly those
 * diagnostics at exactly that shape; the lowering independently re-validates
 * every unwrap receiver, and all other nullability errors still fail closed.
 */
const NULLABLE_RECEIVER_CODES = new Set([2531, 2532, 2533, 18047, 18048, 18049])

const nodeAtPosition = (sourceFile: ts.SourceFile, position: number): ts.Node => {
  let current: ts.Node = sourceFile
  for (;;) {
    const child: ts.Node | undefined = ts.forEachChild(current, (candidate) =>
      position >= candidate.getStart(sourceFile) && position < candidate.getEnd() ? candidate : undefined)
    if (child === undefined) return current
    current = child
  }
}

const isSuppressedOptionalUnwrapDiagnostic = (
  diagnostic: ts.Diagnostic,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  optionalFunctionSymbols: ReadonlySet<ts.Symbol>
): boolean => {
  if (!NULLABLE_RECEIVER_CODES.has(diagnostic.code) || diagnostic.start === undefined || diagnostic.file !== sourceFile) return false
  for (let node: ts.Node | undefined = nodeAtPosition(sourceFile, diagnostic.start); node !== undefined; node = node.parent) {
    if (
      ts.isPropertyAccessExpression(node) && node.name.text === "unwrap" &&
      ts.isCallExpression(node.parent) && node.parent.expression === node && node.parent.arguments.length === 0
    ) {
      const receiver = skipParens(node.expression)
      // Anchor exactly at the receiver: diagnostics inside call arguments or
      // any other span keep failing compilation.
      if (
        ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) &&
        diagnostic.start === receiver.getStart(sourceFile)
      ) {
        const symbol = resolvedSymbol(checker, receiver.expression)
        if (symbol !== undefined && optionalFunctionSymbols.has(symbol)) return true
      }
    }
  }
  return false
}

const validateFrontendRows = (
  source: string,
  functions: readonly PortableFunctionIR[]
): void => {
  const analysis = analyzeSource(source, { fileName: SOURCE_NAME.replace(/\.ts$/, "") })
  const error = analysis.diagnostics.find((diagnostic) => diagnostic.severity === "error")
  if (error) {
    throw new PortableBackendError({
      code: "SMITHERS5031",
      message: `checked Smithers frontend rejected portable source: ${error.code} ${error.message}`,
      line: error.line,
      column: error.column
    })
  }
  for (const fn of functions) {
    const row = analysis.rows[fn.name]
    if (row === undefined) throw fail("SMITHERS5032", `checked frontend did not expose portable function ${fn.name}`)
    // Two independent analyzers must infer the same R row for the same source.
    if (canonicalJson([...row.requirements].sort()) !== canonicalJson([...fn.requirements])) {
      throw fail(
        "SMITHERS5033",
        `portable function ${fn.name} requirement row disagrees with the checked frontend ` +
        `(frontend: ${row.requirements.join(", ") || "none"}; lowered: ${fn.requirements.join(", ") || "none"})`
      )
    }
    const expectedFailures = fn.result.kind === "result" ? fn.result.errors.map((variant) => variant.name).sort() : []
    if (canonicalJson([...row.failures].sort()) !== canonicalJson(expectedFailures)) {
      throw fail("SMITHERS5034", `portable function ${fn.name} failure row disagrees with checked frontend`)
    }
  }
}

interface CallGraphEdge<NodeRef> {
  readonly callee: string
  readonly node: NodeRef
}

/**
 * Reject recursion (direct and mutual) and over-deep static call chains so the
 * TypeScript-host evaluator and the Wasm engine can never diverge through
 * runtime stack exhaustion.
 */
const checkCallGraph = <NodeRef>(
  edges: ReadonlyMap<string, readonly CallGraphEdge<NodeRef>[]>,
  onCycle: (edge: CallGraphEdge<NodeRef>, path: readonly string[]) => never,
  onDepth: (edge: CallGraphEdge<NodeRef>) => never
): void => {
  const states = new Map<string, "visiting" | "done">()
  const depths = new Map<string, number>()
  const visit = (name: string, path: readonly string[]): number => {
    const state = states.get(name)
    if (state === "done") return depths.get(name) ?? 1
    states.set(name, "visiting")
    let depth = 1
    for (const edge of edges.get(name) ?? []) {
      if (states.get(edge.callee) === "visiting" || edge.callee === name) {
        onCycle(edge, [...path, name, edge.callee])
      }
      const calleeDepth = visit(edge.callee, [...path, name])
      if (calleeDepth + 1 > MAX_CALL_DEPTH) onDepth(edge)
      depth = Math.max(depth, calleeDepth + 1)
    }
    states.set(name, "done")
    depths.set(name, depth)
    return depth
  }
  for (const name of edges.keys()) visit(name, [])
}

/**
 * Requirement inference: a function's row is its own capability reads plus,
 * transitively, every callee's row. Duplicate nominal requirements collapse.
 * The call graph is already known acyclic here (`checkCallGraph` runs first),
 * so memoizing before descending cannot observe a partial row.
 */
const closeRequirements = <NodeRef>(
  direct: ReadonlyMap<string, ReadonlySet<string>>,
  edges: ReadonlyMap<string, readonly CallGraphEdge<NodeRef>[]>
): ReadonlyMap<string, readonly string[]> => {
  const resolved = new Map<string, Set<string>>()
  const visit = (name: string): ReadonlySet<string> => {
    const known = resolved.get(name)
    if (known !== undefined) return known
    const row = new Set(direct.get(name) ?? [])
    resolved.set(name, row)
    for (const edge of edges.get(name) ?? []) {
      for (const requirement of visit(edge.callee)) row.add(requirement)
    }
    return row
  }
  const rows = new Map<string, readonly string[]>()
  for (const name of direct.keys()) rows.set(name, [...visit(name)].sort())
  return rows
}

/**
 * Lowers a deliberately bounded `.sm` function subset through a real
 * TypeScript checker plus the Smithers row checker. It parses source but never
 * imports or evaluates the author module.
 */
export const compilePortableModule = (options: {
  readonly moduleId: string
  readonly source: string
}): PortableModuleIR => {
  if (!validModuleId(options.moduleId)) {
    return fail("SMITHERS5001", "portable module id must be a canonical ASCII package/path identity")
  }
  if (typeof options.source !== "string" || Buffer.byteLength(options.source, "utf8") > MAX_IR_BYTES) {
    return fail("SMITHERS5002", `portable source must be UTF-8 text no larger than ${MAX_IR_BYTES} bytes`)
  }
  const parsedSourceFile = ts.createSourceFile(SOURCE_NAME, options.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assertNoExternalSourceEdges(parsedSourceFile)
  const { sourceFile, program, checker } = createCheckedProgram(options.source, parsedSourceFile)

  const optionalFunctionSymbols = new Set<ts.Symbol>()
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined || statement.type === undefined) continue
    if (!ts.isTypeReferenceNode(statement.type) || !typeReferenceIdentity(statement.type, checker, "Optional")) continue
    const symbol = resolvedSymbol(checker, statement.name)
    if (symbol !== undefined) optionalFunctionSymbols.add(symbol)
  }
  const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile).filter((diagnostic) =>
    !isSuppressedOptionalUnwrapDiagnostic(diagnostic, sourceFile, checker, optionalFunctionSymbols))
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0]!
    const start = diagnostic.start ?? 0
    const position = sourceFile.getLineAndCharacterOfPosition(start)
    throw new PortableBackendError({
      code: "SMITHERS5003",
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      line: position.line + 1,
      column: position.character + 1
    })
  }

  const declaredCapabilities = collectDeclaredCapabilities(sourceFile, checker, options.moduleId)
  const declaredErrors = collectDeclaredErrors(sourceFile, checker, options.moduleId)
  const capabilitiesByName = new Map([...declaredCapabilities.values()].map((capability) => [capability.name, capability]))
  if (capabilitiesByName.size !== declaredCapabilities.size) {
    return fail("SMITHERS5070", "portable capability names must be unique")
  }

  interface StagedFunction {
    readonly statement: ts.FunctionDeclaration
    readonly contract: FunctionContract
    readonly parameterSymbols: ReadonlyMap<ts.Symbol, ValueBinding>
    readonly errorsBySymbol: ReadonlyMap<ts.Symbol, PortableErrorVariant>
  }
  const staged: StagedFunction[] = []
  const contractsBySymbol = new Map<ts.Symbol, FunctionContract>()
  for (const statement of sourceFile.statements) {
    // The canonical Context import was already validated as the module's only
    // external edge; class declarations were classified above.
    if (ts.isClassDeclaration(statement) || ts.isImportDeclaration(statement)) continue
    if (!ts.isFunctionDeclaration(statement)) {
      throw diagnosticAt(statement, "SMITHERS5037", "portable modules may contain only capability classes, scalar-payload Error classes, and exported functions")
    }
    if (
      statement.name === undefined || statement.body === undefined || statement.type === undefined ||
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ||
      hasModifier(statement, ts.SyntaxKind.AsyncKeyword) ||
      statement.asteriskToken !== undefined || statement.typeParameters !== undefined ||
      !validPortableName(statement.name.text)
    ) {
      throw diagnosticAt(statement, "SMITHERS5038", "portable functions must be named non-generic synchronous exported declarations with explicit returns")
    }
    if (staged.length >= MAX_FUNCTIONS) {
      throw diagnosticAt(statement, "SMITHERS5038", `portable modules support at most ${MAX_FUNCTIONS} functions`)
    }
    if (statement.parameters.length > MAX_PARAMETERS) {
      throw diagnosticAt(statement, "SMITHERS5039", `portable functions support at most ${MAX_PARAMETERS} parameters`)
    }
    const parameters: Array<{ name: string; valueType: PortableValueType }> = []
    const parameterSymbols = new Map<ts.Symbol, ValueBinding>()
    for (const [index, parameter] of statement.parameters.entries()) {
      if (
        !ts.isIdentifier(parameter.name) || parameter.name.text === "this" || parameter.type === undefined || parameter.questionToken ||
        parameter.dotDotDotToken || parameter.initializer || !validPortableName(parameter.name.text)
      ) {
        throw diagnosticAt(parameter, "SMITHERS5039", "portable parameters must be required annotated identifiers without defaults")
      }
      const valueType = valueTypeNode(parameter.type, "parameter")
      const symbol = resolvedSymbol(checker, parameter.name)
      if (symbol === undefined) throw diagnosticAt(parameter.name, "SMITHERS5040", "portable parameter has no checker identity")
      const binding: ValueBinding = { kind: "parameter", index, name: parameter.name.text, valueType, mutable: false }
      parameters.push({ name: binding.name, valueType })
      parameterSymbols.set(symbol, binding)
    }
    const parsed = parseResultContract(statement.type, checker, declaredErrors)
    const contract: FunctionContract = { name: statement.name.text, parameters, result: parsed.result }
    const functionSymbol = resolvedSymbol(checker, statement.name)
    if (functionSymbol === undefined) throw diagnosticAt(statement.name, "SMITHERS5038", "portable function has no checker identity")
    contractsBySymbol.set(functionSymbol, contract)
    staged.push({ statement, contract, parameterSymbols, errorsBySymbol: parsed.errorsBySymbol })
  }
  if (staged.length === 0) return fail("SMITHERS5041", "portable module exports no functions")
  if (new Set(staged.map((entry) => entry.contract.name)).size !== staged.length) {
    return fail("SMITHERS5042", "portable function names must be unique")
  }

  const loweringEdges = new Map<string, Array<{ callee: string; node: ts.Node }>>()
  const directRequirements = new Map<string, ReadonlySet<string>>()
  interface LoweredFunction {
    readonly name: string
    readonly parameters: FunctionContract["parameters"]
    readonly result: PortableResultContract
    readonly locals: readonly PortableLocal[]
    readonly body: readonly PortableStatement[]
  }
  const loweredFunctions: LoweredFunction[] = []
  for (const entry of staged) {
    const callEdges: Array<{ callee: string; node: ts.Node }> = []
    const requirements = new Set<string>()
    const context: LoweringContext = {
      checker,
      bindings: new Map(entry.parameterSymbols),
      locals: [],
      result: entry.contract.result,
      errorsBySymbol: entry.errorsBySymbol,
      contractsBySymbol,
      capabilitiesBySymbol: declaredCapabilities,
      capabilityBindings: new Map(),
      capabilityBindingNames: new Set(),
      requirements,
      callEdges,
      functionName: entry.contract.name,
      loopDepth: 0
    }
    const lowered = lowerStatements(entry.statement.body!.statements, context, 0)
    if (lowered.completes) {
      throw diagnosticAt(entry.statement, "SMITHERS5017", "portable control-flow path does not return a value")
    }
    // The IR must be self-describing: a row entry that no `capability`
    // expression backs could never be re-derived from the IR, so an unread
    // `Capability.context()` is rejected rather than recorded.
    const read = new Set<string>()
    walkStatementExpressions(lowered.statements, (expression) => {
      if (expression.kind === "capability") read.add(expression.capability)
    })
    for (const requirement of requirements) {
      if (!read.has(requirement)) {
        throw diagnosticAt(entry.statement, "SMITHERS5072", `portable function ${entry.contract.name} calls ${requirement}.context() but never reads one of its fields; the bounded backend records a requirement only through a field read`)
      }
    }
    loweringEdges.set(entry.contract.name, callEdges)
    directRequirements.set(entry.contract.name, requirements)
    loweredFunctions.push({
      name: entry.contract.name,
      parameters: entry.contract.parameters,
      result: entry.contract.result,
      locals: context.locals,
      body: lowered.statements
    })
  }
  checkCallGraph(
    loweringEdges,
    (edge, path): never => {
      throw diagnosticAt(edge.node, "SMITHERS5061", `recursive portable calls are rejected in the bounded backend (${path.join(" -> ")})`)
    },
    (edge): never => {
      throw diagnosticAt(edge.node, "SMITHERS5061", `portable call chains deeper than ${MAX_CALL_DEPTH} are rejected`)
    }
  )
  // Rows close only after the call graph is known acyclic, so requirement
  // inference terminates and every row is the exact transitive closure.
  const rows = closeRequirements(directRequirements, loweringEdges)
  const functions: PortableFunctionIR[] = loweredFunctions.map((entry) => {
    const contract = {
      name: entry.name,
      parameters: entry.parameters,
      requirements: rows.get(entry.name) ?? [],
      result: entry.result
    }
    const semantic = { ...contract, contractDigest: digest(contract), locals: entry.locals, body: entry.body }
    return { ...semantic, digest: digest(semantic) }
  })
  functions.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  validateFrontendRows(options.source, functions)
  const required = new Set(functions.flatMap((fn) => [...fn.requirements]))
  const capabilities = [...capabilitiesByName.values()]
    .filter((capability) => required.has(capability.name))
    .sort((left, right) => left.name < right.name ? -1 : 1)
    .map((capability) => ({ name: capability.name, identity: capability.identity, fields: capability.fields }))
  const semantic = { formatVersion: 4 as const, moduleId: options.moduleId, capabilities, functions }
  return validatePortableModule({ ...semantic, digest: digest(semantic) })
}

const record = (value: unknown, label: string, keys: readonly string[]): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("SMITHERS5050", `${label} must be an object`)
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) return fail("SMITHERS5050", `${label} has missing or unknown fields`)
  return value as Record<string, unknown>
}

const scalar = (value: unknown, label: string): PortableScalarType => {
  if (value !== "number" && value !== "boolean") return fail("SMITHERS5050", `${label} has invalid scalar type`)
  return value
}

const portableValue = (value: unknown, label: string): PortableValueType => {
  if (value !== "number" && value !== "boolean" && value !== "string") return fail("SMITHERS5050", `${label} has invalid value type`)
  return value
}

const validPortableStringValue = (value: unknown): value is string =>
  typeof value === "string" && PORTABLE_STRING_CONTENT.test(value) && Buffer.byteLength(value, "utf8") <= MAX_STRING_BYTES

interface ValidationContext {
  readonly parameters: readonly PortableFunctionIR["parameters"][number][]
  readonly locals: readonly PortableLocal[]
  readonly result: PortableResultContract
  readonly contracts: ReadonlyMap<string, FunctionContract>
  readonly capabilities: ReadonlyMap<string, PortableCapability>
  /** The function's declared (already validated, sorted) requirement row. */
  readonly requirements: readonly string[]
  /** Capabilities this function actually reads; must close to `requirements`. */
  readonly used: Set<string>
  readonly selfName: string
  readonly edges: Array<CallGraphEdge<string>>
}

interface FlowState {
  /** Definitely-initialized local slots at the current program point. */
  initialized: Set<number>
  /** Slots whose single syntactic `let`/`bind-call` has been seen. */
  readonly declared: Set<number>
  loopDepth: number
}

const validateExpression = (
  value: unknown,
  context: ValidationContext,
  initialized: ReadonlySet<number>,
  label: string,
  depth = 0
): PortableExpression => {
  if (depth > MAX_IR_DEPTH) return fail("SMITHERS5050", `${label} exceeds the expression depth limit`)
  const base = record(value, label, (() => {
    const candidate = value as { kind?: unknown }
    switch (candidate?.kind) {
      case "literal": return ["kind", "value", "valueType"]
      case "parameter": return ["index", "kind", "name", "valueType"]
      case "local": return ["index", "kind", "name", "valueType"]
      case "unary": return ["kind", "operator", "value", "valueType"]
      case "binary": return ["kind", "left", "operator", "right", "valueType"]
      case "select": return ["condition", "kind", "valueType", "whenFalse", "whenTrue"]
      case "string-length": return ["kind", "value", "valueType"]
      case "call": return ["arguments", "callee", "kind", "valueType"]
      case "capability": return ["capability", "field", "kind", "valueType"]
      default: return ["kind"]
    }
  })())
  const valueType = portableValue(base.valueType, `${label}.valueType`)
  if (base.kind === "literal") {
    if (
      (valueType === "number" && (typeof base.value !== "number" || !Number.isFinite(base.value) || Object.is(base.value, -0))) ||
      (valueType === "boolean" && typeof base.value !== "boolean") ||
      (valueType === "string" && !validPortableStringValue(base.value))
    ) return fail("SMITHERS5050", `${label} literal does not match its portable value type`)
    return base as unknown as PortableExpression
  }
  if (base.kind === "string-length") {
    const nested = validateExpression(base.value, context, initialized, `${label}.value`, depth + 1)
    if (valueType !== "number" || nested.valueType !== "string") {
      return fail("SMITHERS5050", `${label} string-length operand/type mismatch`)
    }
    return base as unknown as PortableExpression
  }
  if (base.kind === "parameter") {
    if (!Number.isSafeInteger(base.index) || (base.index as number) < 0 || (base.index as number) >= context.parameters.length) {
      return fail("SMITHERS5050", `${label} parameter index is invalid`)
    }
    const expected = context.parameters[base.index as number]!
    if (base.name !== expected.name || valueType !== expected.valueType) return fail("SMITHERS5050", `${label} parameter identity/type mismatch`)
    return base as unknown as PortableExpression
  }
  if (base.kind === "local") {
    if (!Number.isSafeInteger(base.index) || (base.index as number) < 0 || (base.index as number) >= context.locals.length) {
      return fail("SMITHERS5050", `${label} local index is invalid`)
    }
    const expected = context.locals[base.index as number]!
    if (base.name !== expected.name || valueType !== expected.valueType) return fail("SMITHERS5050", `${label} local identity/type mismatch`)
    if (!initialized.has(base.index as number)) return fail("SMITHERS5050", `${label} reads local '${expected.name}' before initialization`)
    return base as unknown as PortableExpression
  }
  if (base.kind === "unary") {
    const nested = validateExpression(base.value, context, initialized, `${label}.value`, depth + 1)
    if (
      (base.operator === "not" && (valueType !== "boolean" || nested.valueType !== "boolean")) ||
      ((base.operator === "negate" || base.operator === "positive") && (valueType !== "number" || nested.valueType !== "number")) ||
      !["not", "negate", "positive"].includes(base.operator as string)
    ) return fail("SMITHERS5050", `${label} unary operator/type mismatch`)
    return base as unknown as PortableExpression
  }
  if (base.kind === "binary") {
    const left = validateExpression(base.left, context, initialized, `${label}.left`, depth + 1)
    const right = validateExpression(base.right, context, initialized, `${label}.right`, depth + 1)
    const numeric = ["add", "subtract", "multiply", "divide"]
    const order = ["lt", "lte", "gt", "gte"]
    const equality = ["eq", "neq"]
    const logical = ["and", "or"]
    const op = base.operator as string
    const valid =
      (numeric.includes(op) && valueType === "number" && left.valueType === "number" && right.valueType === "number") ||
      (op === "concat" && valueType === "string" && left.valueType === "string" && right.valueType === "string") ||
      (order.includes(op) && valueType === "boolean" && left.valueType === right.valueType &&
        (left.valueType === "number" || left.valueType === "string")) ||
      (equality.includes(op) && valueType === "boolean" && left.valueType === right.valueType) ||
      (logical.includes(op) && valueType === "boolean" && left.valueType === "boolean" && right.valueType === "boolean")
    if (!valid) return fail("SMITHERS5050", `${label} binary operator/type mismatch`)
    return base as unknown as PortableExpression
  }
  if (base.kind === "select") {
    const condition = validateExpression(base.condition, context, initialized, `${label}.condition`, depth + 1)
    const whenTrue = validateExpression(base.whenTrue, context, initialized, `${label}.whenTrue`, depth + 1)
    const whenFalse = validateExpression(base.whenFalse, context, initialized, `${label}.whenFalse`, depth + 1)
    if (condition.valueType !== "boolean" || whenTrue.valueType !== valueType || whenFalse.valueType !== valueType) {
      return fail("SMITHERS5050", `${label} select type mismatch`)
    }
    return base as unknown as PortableExpression
  }
  if (base.kind === "call") {
    validateCallShape(base, context, initialized, label, depth, "plain")
    const contract = context.contracts.get(base.callee as string)!
    if (valueType !== contract.result.valueType) return fail("SMITHERS5050", `${label} call result type mismatch`)
    return base as unknown as PortableExpression
  }
  if (base.kind === "capability") {
    if (typeof base.capability !== "string" || typeof base.field !== "string") {
      return fail("SMITHERS5050", `${label} capability reference must name a capability and a field`)
    }
    const capability = context.capabilities.get(base.capability)
    if (capability === undefined) return fail("SMITHERS5050", `${label} reads undeclared capability '${base.capability}'`)
    // Forged IR cannot widen a function's authority: a capability read that the
    // function's declared row does not cover is rejected outright.
    if (!context.requirements.includes(base.capability)) {
      return fail("SMITHERS5050", `${label} reads capability '${base.capability}' outside the function's declared requirement row`)
    }
    const field = capability.fields.find((candidate) => candidate.name === base.field)
    if (field === undefined) return fail("SMITHERS5050", `${label} reads unknown field '${base.field}' of capability '${base.capability}'`)
    if (field.valueType !== valueType) return fail("SMITHERS5050", `${label} capability field type mismatch`)
    context.used.add(base.capability)
    return base as unknown as PortableExpression
  }
  return fail("SMITHERS5050", `${label} has unsupported expression kind`)
}

/** Shared checks for call/bind-call/tail-call callees and arguments. */
const validateCallShape = (
  base: Record<string, unknown>,
  context: ValidationContext,
  initialized: ReadonlySet<number>,
  label: string,
  depth: number,
  expectedKind: "plain" | "propagating"
): FunctionContract => {
  if (typeof base.callee !== "string") return fail("SMITHERS5050", `${label} callee must be a function name`)
  const contract = context.contracts.get(base.callee)
  if (contract === undefined) return fail("SMITHERS5050", `${label} calls unknown function '${base.callee}'`)
  if (contract.name === context.selfName) return fail("SMITHERS5050", `${label} is a rejected recursive call`)
  if (expectedKind === "plain" && contract.result.kind !== "plain") {
    return fail("SMITHERS5050", `${label} expression calls must target plain functions`)
  }
  if (expectedKind === "propagating" && contract.result.kind === "plain") {
    return fail("SMITHERS5050", `${label} propagating calls must target Optional/Result functions`)
  }
  if (!Array.isArray(base.arguments) || base.arguments.length !== contract.parameters.length) {
    return fail("SMITHERS5050", `${label} call arity mismatch`)
  }
  base.arguments.forEach((argument, index) => {
    const lowered = validateExpression(argument, context, initialized, `${label}.arguments[${index}]`, depth + 1)
    if (lowered.valueType !== contract.parameters[index]!.valueType) {
      return fail("SMITHERS5050", `${label} call argument type mismatch`)
    }
  })
  context.edges.push({ callee: contract.name, node: label })
  return contract
}

/** Callee errors must map into the caller's declared row by exact identity. */
const validatePropagatedRow = (
  contract: FunctionContract,
  context: ValidationContext,
  label: string
): void => {
  if (contract.result.kind === "optional") {
    if (context.result.kind !== "optional") return fail("SMITHERS5050", `${label} Optional propagation requires an Optional caller`)
    return
  }
  if (contract.result.kind !== "result" || context.result.kind !== "result") {
    return fail("SMITHERS5050", `${label} Result propagation requires a Result caller`)
  }
  const declared = new Map(context.result.errors.map((error) => [error.identity, error]))
  for (const error of contract.result.errors) {
    const target = declared.get(error.identity)
    if (target === undefined) return fail("SMITHERS5050", `${label} propagates undeclared error ${error.name}`)
    if (canonicalJson({ name: target.name, fields: target.fields }) !== canonicalJson({ name: error.name, fields: error.fields })) {
      return fail("SMITHERS5050", `${label} propagated error ${error.name} disagrees between caller and callee rows`)
    }
  }
}

const cloneSet = (values: ReadonlySet<number>): Set<number> => new Set(values)

const intersect = (left: ReadonlySet<number>, right: ReadonlySet<number>): Set<number> =>
  new Set([...left].filter((value) => right.has(value)))

const validateStatements = (
  value: unknown,
  context: ValidationContext,
  state: FlowState,
  label: string,
  depth = 0
): { readonly statements: readonly PortableStatement[]; readonly completes: boolean } => {
  if (depth > MAX_IR_DEPTH) return fail("SMITHERS5050", `${label} exceeds the control-flow depth limit`)
  if (!Array.isArray(value)) return fail("SMITHERS5050", `${label} must be a statement array`)
  let completes = true
  for (const [index, raw] of value.entries()) {
    if (!completes) return fail("SMITHERS5050", `${label}[${index}] is unreachable after a terminal statement`)
    completes = validateStatement(raw, context, state, `${label}[${index}]`, depth)
  }
  return { statements: value as readonly PortableStatement[], completes }
}

const validateSlotTarget = (
  base: Record<string, unknown>,
  context: ValidationContext,
  label: string
): { readonly index: number; readonly local: PortableLocal } => {
  if (!Number.isSafeInteger(base.index) || (base.index as number) < 0 || (base.index as number) >= context.locals.length) {
    return fail("SMITHERS5050", `${label} local slot index is invalid`)
  }
  const local = context.locals[base.index as number]!
  if (base.name !== local.name || base.valueType !== local.valueType) {
    return fail("SMITHERS5050", `${label} local slot identity/type mismatch`)
  }
  return { index: base.index as number, local }
}

const validateStatement = (
  value: unknown,
  context: ValidationContext,
  state: FlowState,
  label: string,
  depth: number
): boolean => {
  const kind = (value as { kind?: unknown })?.kind
  const keys = kind === "let" || kind === "assign" ? ["index", "kind", "name", "value", "valueType"]
    : kind === "bind-call" ? ["arguments", "callee", "index", "kind", "name", "valueType"]
      : kind === "if" ? ["condition", "kind", "whenFalse", "whenTrue"]
        : kind === "while" ? ["body", "condition", "kind", "update"]
          : kind === "return" || kind === "present" ? ["kind", "value"]
            : kind === "failure" ? ["arguments", "identity", "kind", "tag"]
              : kind === "tail-call" ? ["arguments", "callee", "kind"]
                : ["kind"]
  const base = record(value, label, keys)
  if (kind === "let" || kind === "assign") {
    const { index, local } = validateSlotTarget(base, context, label)
    const expression = validateExpression(base.value, context, state.initialized, `${label}.value`, depth + 1)
    if (expression.valueType !== local.valueType) return fail("SMITHERS5050", `${label} slot value type mismatch`)
    if (kind === "let") {
      if (state.declared.has(index)) return fail("SMITHERS5050", `${label} re-declares local slot ${index}`)
      state.declared.add(index)
    } else {
      if (!local.mutable) return fail("SMITHERS5050", `${label} assigns to immutable local '${local.name}'`)
      if (!state.initialized.has(index)) return fail("SMITHERS5050", `${label} assigns to local '${local.name}' before its declaration`)
    }
    state.initialized.add(index)
    return true
  }
  if (kind === "bind-call") {
    const { index, local } = validateSlotTarget(base, context, label)
    const contract = validateCallShape(base, context, state.initialized, label, depth, "propagating")
    validatePropagatedRow(contract, context, label)
    if (local.valueType !== contract.result.valueType) return fail("SMITHERS5050", `${label} bind-call slot type mismatch`)
    if (state.declared.has(index)) return fail("SMITHERS5050", `${label} re-declares local slot ${index}`)
    state.declared.add(index)
    state.initialized.add(index)
    return true
  }
  if (kind === "if") {
    const condition = validateExpression(base.condition, context, state.initialized, `${label}.condition`, depth + 1)
    if (condition.valueType !== "boolean") return fail("SMITHERS5050", `${label} condition must be boolean`)
    const trueState: FlowState = { ...state, initialized: cloneSet(state.initialized) }
    const falseState: FlowState = { ...state, initialized: cloneSet(state.initialized) }
    const whenTrue = validateStatements(base.whenTrue, context, trueState, `${label}.whenTrue`, depth + 1)
    const whenFalse = validateStatements(base.whenFalse, context, falseState, `${label}.whenFalse`, depth + 1)
    if (whenTrue.completes && whenFalse.completes) {
      state.initialized = intersect(trueState.initialized, falseState.initialized)
    } else if (whenTrue.completes) {
      state.initialized = trueState.initialized
    } else if (whenFalse.completes) {
      state.initialized = falseState.initialized
    }
    return whenTrue.completes || whenFalse.completes
  }
  if (kind === "while") {
    const condition = validateExpression(base.condition, context, state.initialized, `${label}.condition`, depth + 1)
    if (condition.valueType !== "boolean") return fail("SMITHERS5050", `${label} condition must be boolean`)
    const bodyState: FlowState = { ...state, initialized: cloneSet(state.initialized), loopDepth: state.loopDepth + 1 }
    validateStatements(base.body, context, bodyState, `${label}.body`, depth + 1)
    if (!Array.isArray(base.update)) return fail("SMITHERS5050", `${label}.update must be a statement array`)
    const updateState: FlowState = { ...state, initialized: cloneSet(state.initialized), loopDepth: state.loopDepth }
    base.update.forEach((raw, index) => {
      if ((raw as { kind?: unknown })?.kind !== "assign") return fail("SMITHERS5050", `${label}.update[${index}] must be an assignment`)
      validateStatement(raw, context, updateState, `${label}.update[${index}]`, depth + 1)
    })
    return true
  }
  if (kind === "break" || kind === "continue") {
    if (state.loopDepth === 0) return fail("SMITHERS5050", `${label} break/continue must appear inside a loop`)
    return false
  }
  if (kind === "return" || kind === "present") {
    if (kind === "present" ? context.result.kind !== "optional" : context.result.kind === "optional") {
      return fail("SMITHERS5050", `${label} exit kind does not match function contract`)
    }
    const expression = validateExpression(base.value, context, state.initialized, `${label}.value`, depth + 1)
    if (expression.valueType !== context.result.valueType) return fail("SMITHERS5050", `${label} exit scalar type mismatch`)
    return false
  }
  if (kind === "absent") {
    if (context.result.kind !== "optional") return fail("SMITHERS5050", `${label} absence requires Optional contract`)
    return false
  }
  if (kind === "failure") {
    if (context.result.kind !== "result") return fail("SMITHERS5050", `${label} failure requires Result contract`)
    const variant = context.result.errors.find((error) => error.identity === base.identity)
    if (variant === undefined || base.tag !== variant.tag) return fail("SMITHERS5050", `${label} failure identity/tag mismatch`)
    if (!Array.isArray(base.arguments) || base.arguments.length !== variant.fields.length) {
      return fail("SMITHERS5050", `${label} failure payload arity mismatch`)
    }
    base.arguments.forEach((argument, index) => {
      const expression = validateExpression(argument, context, state.initialized, `${label}.arguments[${index}]`, depth + 1)
      if (expression.valueType !== variant.fields[index]!.valueType) {
        return fail("SMITHERS5050", `${label} failure payload type mismatch`)
      }
    })
    return false
  }
  if (kind === "tail-call") {
    const contract = validateCallShape(base, context, state.initialized, label, depth, "propagating")
    validatePropagatedRow(contract, context, label)
    if (contract.result.kind !== context.result.kind) return fail("SMITHERS5050", `${label} tail call channel mismatch`)
    if (contract.result.valueType !== context.result.valueType) return fail("SMITHERS5050", `${label} tail call scalar type mismatch`)
    return false
  }
  return fail("SMITHERS5050", `${label} has unsupported statement kind`)
}

const validateErrorRow = (
  rawErrors: unknown,
  moduleId: string,
  label: string
): readonly PortableErrorVariant[] => {
  if (!Array.isArray(rawErrors) || rawErrors.length === 0 || rawErrors.length > MAX_ERRORS) {
    return fail("SMITHERS5050", `${label} needs 1-${MAX_ERRORS} errors`)
  }
  const errors = rawErrors.map((rawError, errorIndex) => {
    const error = record(rawError, `${label}[${errorIndex}]`, ["fields", "identity", "name", "tag"])
    if (
      typeof error.name !== "string" || !validPortableName(error.name) ||
      error.identity !== errorIdentity(moduleId, error.name) ||
      error.tag !== errorIndex + 1
    ) return fail("SMITHERS5050", "portable result error identity/tag is invalid")
    if (!Array.isArray(error.fields) || error.fields.length > MAX_ERROR_FIELDS) {
      return fail("SMITHERS5050", `portable result error fields must be an array of at most ${MAX_ERROR_FIELDS} entries`)
    }
    const fields = error.fields.map((rawField, fieldIndex) => {
      const field = record(rawField, `${label}[${errorIndex}].fields[${fieldIndex}]`, ["name", "valueType"])
      if (typeof field.name !== "string" || !validPortableName(field.name)) return fail("SMITHERS5050", "portable error field name is invalid")
      return { name: field.name, valueType: portableValue(field.valueType, "portable error field type") }
    })
    if (new Set(fields.map((field) => field.name)).size !== fields.length) {
      return fail("SMITHERS5050", "portable error field names must be unique")
    }
    return { name: error.name, identity: error.identity, tag: error.tag as number, fields }
  })
  if (
    new Set(errors.map((error) => error.name)).size !== errors.length ||
    new Set(errors.map((error) => error.identity)).size !== errors.length
  ) return fail("SMITHERS5050", "portable Result error names and identities must be unique")
  if (canonicalJson([...errors].sort((left, right) => left.identity < right.identity ? -1 : 1)) !== canonicalJson(errors)) {
    return fail("SMITHERS5050", "portable result errors must be sorted by identity")
  }
  return errors
}

const validateCapabilityRow = (
  rawCapabilities: unknown,
  moduleId: string
): readonly PortableCapability[] => {
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length > MAX_CAPABILITIES) {
    return fail("SMITHERS5050", `portable module capabilities must be an array of at most ${MAX_CAPABILITIES} entries`)
  }
  const capabilities = rawCapabilities.map((rawCapability, index) => {
    const capability = record(rawCapability, `portable capability[${index}]`, ["fields", "identity", "name"])
    if (
      typeof capability.name !== "string" || !validPortableName(capability.name) ||
      capability.identity !== capabilityIdentity(moduleId, capability.name)
    ) return fail("SMITHERS5050", "portable capability identity is invalid")
    if (!Array.isArray(capability.fields) || capability.fields.length === 0 || capability.fields.length > MAX_CAPABILITY_FIELDS) {
      return fail("SMITHERS5050", `portable capability ${capability.name} must declare 1-${MAX_CAPABILITY_FIELDS} fields`)
    }
    const fields = capability.fields.map((rawField, fieldIndex) => {
      const field = record(rawField, `portable capability[${index}].fields[${fieldIndex}]`, ["name", "valueType"])
      if (typeof field.name !== "string" || !validPortableName(field.name)) return fail("SMITHERS5050", "portable capability field name is invalid")
      return { name: field.name, valueType: portableValue(field.valueType, "portable capability field type") }
    })
    if (new Set(fields.map((field) => field.name)).size !== fields.length) {
      return fail("SMITHERS5050", `portable capability ${capability.name} field names must be unique`)
    }
    if (canonicalJson([...fields].sort((left, right) => left.name < right.name ? -1 : 1)) !== canonicalJson(fields)) {
      return fail("SMITHERS5050", `portable capability ${capability.name} fields must be sorted by name`)
    }
    return { name: capability.name, identity: capability.identity, fields }
  })
  if (new Set(capabilities.map((capability) => capability.name)).size !== capabilities.length) {
    return fail("SMITHERS5050", "portable capability names must be unique")
  }
  if (canonicalJson([...capabilities].sort((left, right) => left.name < right.name ? -1 : 1)) !== canonicalJson(capabilities)) {
    return fail("SMITHERS5050", "portable capabilities must be sorted by name")
  }
  return capabilities
}

export const validatePortableModule = (value: unknown): PortableModuleIR => {
  const normalized = assertJson(value, "portable module IR")
  if (Buffer.byteLength(canonicalJson(normalized), "utf8") > MAX_IR_BYTES) {
    return fail("SMITHERS5050", `portable module IR exceeds ${MAX_IR_BYTES} bytes`)
  }
  // Version is read before the exact-key check so a genuinely older artifact
  // gets the version diagnostic instead of "missing or unknown fields".
  const declaredVersion = normalized !== null && typeof normalized === "object" && !Array.isArray(normalized)
    ? (normalized as { formatVersion?: unknown }).formatVersion
    : undefined
  if (declaredVersion === 2) {
    return fail("SMITHERS5050", "portable module formatVersion 2 predates the format 3 string ABI (memcmp equality, exported memory, defect tags) and cannot be loaded; recompile the source with this backend")
  }
  if (declaredVersion === 3) {
    return fail("SMITHERS5050", "portable module formatVersion 3 predates the format 4 capability environment ABI (requirement rows in contract digests, capability descriptors, environment slots) and cannot be loaded; recompile the source with this backend")
  }
  const module = record(normalized, "portable module IR", ["capabilities", "digest", "formatVersion", "functions", "moduleId"])
  if (module.formatVersion !== 4 || !validModuleId(module.moduleId)) {
    return fail("SMITHERS5050", "portable module identity/version is invalid")
  }
  if (!Array.isArray(module.functions) || module.functions.length === 0 || module.functions.length > MAX_FUNCTIONS) {
    return fail("SMITHERS5050", `portable module must contain 1-${MAX_FUNCTIONS} functions`)
  }
  const capabilities = validateCapabilityRow(module.capabilities, module.moduleId as string)
  const capabilitiesByName = new Map(capabilities.map((capability) => [capability.name, capability]))

  interface StagedValidation {
    readonly fn: Record<string, unknown>
    readonly contract: FunctionContract
    readonly requirements: readonly string[]
    readonly locals: readonly PortableLocal[]
    readonly label: string
  }
  const stagedFunctions: StagedValidation[] = []
  const contracts = new Map<string, FunctionContract>()
  const identityShapes = new Map<string, string>()
  for (const [index, raw] of module.functions.entries()) {
    const label = `portable function[${index}]`
    const fn = record(raw, label, ["body", "contractDigest", "digest", "locals", "name", "parameters", "requirements", "result"])
    if (typeof fn.name !== "string" || !validPortableName(fn.name)) return fail("SMITHERS5050", `${label} name is invalid`)
    if (!Array.isArray(fn.requirements) || fn.requirements.length > MAX_CAPABILITIES) {
      return fail("SMITHERS5050", `${label} requirements must be an array of at most ${MAX_CAPABILITIES} entries`)
    }
    const requirements = fn.requirements.map((requirement) => {
      if (typeof requirement !== "string" || !capabilitiesByName.has(requirement)) {
        return fail("SMITHERS5050", `${label} requires a capability the module does not declare`)
      }
      return requirement
    })
    if (new Set(requirements).size !== requirements.length) return fail("SMITHERS5050", `${label} requirement row has duplicates`)
    if (canonicalJson([...requirements].sort()) !== canonicalJson(requirements)) {
      return fail("SMITHERS5050", `${label} requirement row must be sorted by capability name`)
    }
    if (!Array.isArray(fn.parameters) || fn.parameters.length > MAX_PARAMETERS) {
      return fail("SMITHERS5050", `${label} parameters must be an array of at most ${MAX_PARAMETERS} entries`)
    }
    const parameters = fn.parameters.map((rawParameter, parameterIndex) => {
      const parameter = record(rawParameter, `${label}.parameters[${parameterIndex}]`, ["name", "valueType"])
      if (typeof parameter.name !== "string" || !validPortableName(parameter.name)) return fail("SMITHERS5050", "portable parameter name is invalid")
      return { name: parameter.name, valueType: portableValue(parameter.valueType, "portable parameter type") }
    })
    if (!Array.isArray(fn.locals) || fn.locals.length > MAX_LOCALS) {
      return fail("SMITHERS5050", `${label} locals must be an array of at most ${MAX_LOCALS} entries`)
    }
    const locals = fn.locals.map((rawLocal, localIndex) => {
      const local = record(rawLocal, `${label}.locals[${localIndex}]`, ["mutable", "name", "valueType"])
      if (typeof local.name !== "string" || !validPortableName(local.name) || typeof local.mutable !== "boolean") {
        return fail("SMITHERS5050", "portable local declaration is invalid")
      }
      return { name: local.name, valueType: portableValue(local.valueType, "portable local type"), mutable: local.mutable }
    })
    const names = [...parameters.map((parameter) => parameter.name), ...locals.map((local) => local.name)]
    if (new Set(names).size !== names.length) return fail("SMITHERS5050", `${label} parameter/local names must be unique`)
    const rawResultKind = fn.result !== null && typeof fn.result === "object"
      ? (fn.result as { kind?: unknown }).kind
      : undefined
    const resultRecord = record(fn.result, `${label}.result`, rawResultKind === "result"
      ? ["errors", "kind", "valueType"]
      : ["kind", "valueType"])
    const valueType = portableValue(resultRecord.valueType, "portable result value type")
    let result: PortableResultContract
    if (resultRecord.kind === "plain" || resultRecord.kind === "optional") {
      result = { kind: resultRecord.kind, valueType }
    } else if (resultRecord.kind === "result") {
      const errors = validateErrorRow(resultRecord.errors, module.moduleId as string, `${label}.result.errors`)
      for (const error of errors) {
        const shape = canonicalJson({ name: error.name, fields: error.fields })
        const existing = identityShapes.get(error.identity)
        if (existing !== undefined && existing !== shape) {
          return fail("SMITHERS5050", `portable error ${error.name} has conflicting payload shapes across rows`)
        }
        identityShapes.set(error.identity, shape)
      }
      result = { kind: "result", valueType, errors }
    } else {
      return fail("SMITHERS5050", "portable result contract kind is invalid")
    }
    const contract: FunctionContract = { name: fn.name, parameters, result }
    // The requirement row is part of the function's static type, so it is
    // inside the contract digest a wire exit is bound to.
    if (typeof fn.contractDigest !== "string" || fn.contractDigest !== digest({ ...contract, requirements })) {
      return fail("SMITHERS5050", "portable contract digest mismatch")
    }
    if (contracts.has(fn.name)) return fail("SMITHERS5050", "portable function names must be unique")
    contracts.set(fn.name, contract)
    stagedFunctions.push({ fn, contract, requirements, locals, label })
  }

  const edgesByFunction = new Map<string, readonly CallGraphEdge<string>[]>()
  const directUse = new Map<string, ReadonlySet<string>>()
  const functions: PortableFunctionIR[] = []
  for (const staged of stagedFunctions) {
    const edges: Array<CallGraphEdge<string>> = []
    const used = new Set<string>()
    const context: ValidationContext = {
      parameters: staged.contract.parameters,
      locals: staged.locals,
      result: staged.contract.result,
      contracts,
      capabilities: capabilitiesByName,
      requirements: staged.requirements,
      used,
      selfName: staged.contract.name,
      edges
    }
    const state: FlowState = { initialized: new Set(), declared: new Set(), loopDepth: 0 }
    const body = validateStatements(staged.fn.body, context, state, `${staged.label}.body`)
    if (body.completes) return fail("SMITHERS5050", `${staged.label} control flow can fall off the function end`)
    for (const [slot] of staged.locals.entries()) {
      if (!state.declared.has(slot)) return fail("SMITHERS5050", `${staged.label} local slot ${slot} is never declared`)
    }
    edgesByFunction.set(staged.contract.name, edges)
    directUse.set(staged.contract.name, used)
    const semantic = {
      name: staged.contract.name,
      parameters: staged.contract.parameters,
      requirements: staged.requirements,
      result: staged.contract.result,
      contractDigest: staged.fn.contractDigest as string,
      locals: staged.locals,
      body: body.statements
    }
    if (typeof staged.fn.digest !== "string" || staged.fn.digest !== digest(semantic)) {
      return fail("SMITHERS5050", "portable function digest mismatch")
    }
    functions.push({ ...semantic, digest: staged.fn.digest })
  }
  checkCallGraph(
    edgesByFunction,
    (edge): never => fail("SMITHERS5050", `${edge.node} participates in a rejected recursive call cycle`),
    (edge): never => fail("SMITHERS5050", `${edge.node} exceeds the portable call depth limit of ${MAX_CALL_DEPTH}`)
  )
  // Every declared row must be EXACTLY the closure of its own reads and its
  // callees' rows: no capability claimed that the closure does not contain
  // (authority inflation), and none missing (authority laundering through an
  // undeclared callee).
  const closedRows = closeRequirements(directUse, edgesByFunction)
  for (const fn of functions) {
    const expected = closedRows.get(fn.name) ?? []
    if (canonicalJson([...fn.requirements]) !== canonicalJson([...expected])) {
      return fail(
        "SMITHERS5050",
        `portable function ${fn.name} declares requirement row ${JSON.stringify(fn.requirements)} ` +
        `but its transitive closure is ${JSON.stringify(expected)}`
      )
    }
  }
  const required = new Set(functions.flatMap((fn) => [...fn.requirements]))
  for (const capability of capabilities) {
    if (!required.has(capability.name)) {
      return fail("SMITHERS5050", `portable module declares capability ${capability.name} that no function requires`)
    }
  }
  if (canonicalJson([...functions].sort((left, right) => left.name < right.name ? -1 : 1)) !== canonicalJson(functions)) {
    return fail("SMITHERS5050", "portable functions must be sorted by name")
  }
  if (moduleStringFacts(functions, capabilities).poolBytes > MAX_STRING_POOL_BYTES) {
    return fail("SMITHERS5050", `portable string pool exceeds ${MAX_STRING_POOL_BYTES} bytes`)
  }
  const semantic = { formatVersion: 4 as const, moduleId: module.moduleId, capabilities, functions }
  if (typeof module.digest !== "string" || !HEX_DIGEST.test(module.digest) || module.digest !== digest(semantic)) {
    return fail("SMITHERS5050", "portable module digest mismatch")
  }
  return deepFreeze({ ...semantic, digest: module.digest })
}

export const encodePortableModuleArtifact = (moduleValue: PortableModuleIR): Uint8Array => {
  const module = validatePortableModule(moduleValue)
  const identity = { artifactVersion: 1 as const, kind: "smithers.portable-ir" as const, module }
  const bytes = encodeCanonicalJson({ ...identity, digest: digest(identity) })
  if (bytes.byteLength > MAX_IR_BYTES) return fail("SMITHERS5051", `portable IR artifact exceeds ${MAX_IR_BYTES} bytes`)
  return bytes
}

export const decodePortableModuleArtifact = (bytes: Uint8Array | string): PortableModuleIR => {
  const byteLength = typeof bytes === "string" ? Buffer.byteLength(bytes, "utf8") : bytes.byteLength
  if (byteLength > MAX_IR_BYTES) return fail("SMITHERS5051", `portable IR artifact exceeds ${MAX_IR_BYTES} bytes`)
  const value = decodeCanonicalJson(bytes, "portable IR artifact")
  const artifact = record(value, "portable IR artifact", ["artifactVersion", "digest", "kind", "module"])
  if (artifact.artifactVersion !== 1 || artifact.kind !== "smithers.portable-ir") return fail("SMITHERS5051", "portable IR artifact kind/version is invalid")
  const module = validatePortableModule(artifact.module)
  const identity = { artifactVersion: 1 as const, kind: "smithers.portable-ir" as const, module }
  if (artifact.digest !== digest(identity)) return fail("SMITHERS5051", "portable IR artifact digest mismatch")
  return module
}

interface StatementFactsAccumulator {
  callees: string[]
  hasLoop: boolean
  hasConcat: boolean
}

const expressionFacts = (expression: PortableExpression, facts: StatementFactsAccumulator): void => {
  switch (expression.kind) {
    case "literal":
    case "parameter":
    case "capability":
    case "local": return
    case "unary":
    case "string-length": return expressionFacts(expression.value, facts)
    case "binary":
      if (expression.operator === "concat") facts.hasConcat = true
      expressionFacts(expression.left, facts)
      return expressionFacts(expression.right, facts)
    case "select":
      expressionFacts(expression.condition, facts)
      expressionFacts(expression.whenTrue, facts)
      return expressionFacts(expression.whenFalse, facts)
    case "call":
      facts.callees.push(expression.callee)
      for (const argument of expression.arguments) expressionFacts(argument, facts)
      return
  }
}

const statementFacts = (
  statements: readonly PortableStatement[],
  facts: StatementFactsAccumulator
): void => {
  for (const statement of statements) {
    switch (statement.kind) {
      case "let":
      case "assign":
        expressionFacts(statement.value, facts)
        break
      case "bind-call":
      case "tail-call":
        facts.callees.push(statement.callee)
        for (const argument of statement.arguments) expressionFacts(argument, facts)
        break
      case "if":
        expressionFacts(statement.condition, facts)
        statementFacts(statement.whenTrue, facts)
        statementFacts(statement.whenFalse, facts)
        break
      case "while":
        facts.hasLoop = true
        expressionFacts(statement.condition, facts)
        statementFacts(statement.body, facts)
        statementFacts(statement.update, facts)
        break
      case "return":
      case "present":
        expressionFacts(statement.value, facts)
        break
      case "failure":
        for (const argument of statement.arguments) expressionFacts(argument, facts)
        break
      case "break":
      case "continue":
      case "absent":
        break
    }
  }
}

/** Which canonical defect exits a function can produce, per defect kind. */
interface PortableDefectFacts {
  /** Contains a loop or (transitively) calls a function that does. */
  readonly fuel: boolean
  /** Contains a concat or (transitively) calls a function that does. */
  readonly string: boolean
}

const NO_DEFECTS: PortableDefectFacts = { fuel: false, string: false }

const canAnyDefect = (facts: PortableDefectFacts | undefined): boolean =>
  facts !== undefined && (facts.fuel || facts.string)

/**
 * A function can produce the fuel-exhausted defect exit when it contains a
 * loop, and the string-memory-exhausted defect when it concatenates — in both
 * cases transitively through callees. Both the Wasm ABI and the host decoder
 * derive this identically from validated IR.
 */
const moduleDefectMap = (module: PortableModuleIR): ReadonlyMap<string, PortableDefectFacts> => {
  const byName = new Map(module.functions.map((fn) => [fn.name, fn]))
  const resolved = new Map<string, PortableDefectFacts>()
  const visit = (name: string): PortableDefectFacts => {
    const known = resolved.get(name)
    if (known !== undefined) return known
    const fn = byName.get(name)!
    const facts: StatementFactsAccumulator = { callees: [], hasLoop: false, hasConcat: false }
    statementFacts(fn.body, facts)
    resolved.set(name, NO_DEFECTS)
    let fuel = facts.hasLoop
    let string = facts.hasConcat
    for (const callee of facts.callees) {
      const nested = visit(callee)
      fuel = fuel || nested.fuel
      string = string || nested.string
    }
    const defects: PortableDefectFacts = { fuel, string }
    resolved.set(name, defects)
    return defects
  }
  for (const fn of module.functions) visit(fn.name)
  return resolved
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

const walkStatementExpressions = (
  statements: readonly PortableStatement[],
  visit: (expression: PortableExpression) => void
): void => {
  for (const statement of statements) {
    switch (statement.kind) {
      case "let":
      case "assign":
      case "return":
      case "present":
        walkExpression(statement.value, visit)
        break
      case "bind-call":
      case "tail-call":
      case "failure":
        for (const argument of statement.arguments) walkExpression(argument, visit)
        break
      case "if":
        walkExpression(statement.condition, visit)
        walkStatementExpressions(statement.whenTrue, visit)
        walkStatementExpressions(statement.whenFalse, visit)
        break
      case "while":
        walkExpression(statement.condition, visit)
        walkStatementExpressions(statement.body, visit)
        walkStatementExpressions(statement.update, visit)
        break
      case "break":
      case "continue":
      case "absent":
        break
    }
  }
}

interface PortableStringFacts {
  /** True when the module needs linear memory (any string value or `.length`). */
  readonly used: boolean
  /** Pool entries in canonical order: "" at offset 0, then sorted literals. */
  readonly entries: readonly string[]
  readonly offsets: ReadonlyMap<string, number>
  readonly poolBytes: number
  /** Any string concatenation anywhere in the module (needs the bump heap). */
  readonly usesConcat: boolean
  /** Any string `===`/`!==` (needs the $__str_eq memcmp helper). */
  readonly usesEq: boolean
  /** Any string `<`/`<=`/`>`/`>=` (needs the $__str_cmp helper). */
  readonly usesOrder: boolean
  /** Widest per-function count of string parameters (sizes the input region). */
  readonly maxStringParams: number
}

/**
 * Canonical interned literal pool plus the module's string-feature facts.
 * The pool is deduplicated by content and sorted; the empty string always
 * sits at offset 0 so a zero-initialized Wasm i32 local and the evaluator's
 * zero value ("") agree even outside validated control flow. Interned-pointer
 * equality is only an optimization fast path: runtime strings (parameters and
 * concat results) are NOT interned, so equality is always length+bytes.
 */
const moduleStringFacts = (
  functions: readonly PortableFunctionIR[],
  capabilities: readonly PortableCapability[]
): PortableStringFacts => {
  const literals = new Set<string>()
  let used = false
  let usesConcat = false
  let usesEq = false
  let usesOrder = false
  let maxStringParams = 0
  // A string-typed capability field needs its environment record in memory even
  // when no function happens to read that particular field.
  for (const capability of capabilities) {
    if (capability.fields.some((field) => field.valueType === "string")) used = true
  }
  for (const fn of functions) {
    const stringParams = fn.parameters.filter((parameter) => parameter.valueType === "string").length
    maxStringParams = Math.max(maxStringParams, stringParams)
    if (stringParams > 0) used = true
    if (fn.result.valueType === "string") used = true
    if (fn.result.kind === "result" && fn.result.errors.some((error) => error.fields.some((field) => field.valueType === "string"))) {
      used = true
    }
    if (fn.locals.some((local) => local.valueType === "string")) used = true
    walkStatementExpressions(fn.body, (expression) => {
      if (expression.kind === "string-length") used = true
      if (expression.kind === "capability" && expression.valueType === "string") used = true
      if (expression.kind === "literal" && expression.valueType === "string") {
        used = true
        literals.add(expression.value as string)
      }
      if (expression.kind === "binary" && expression.left.valueType === "string") {
        used = true
        if (expression.operator === "concat") usesConcat = true
        if (expression.operator === "eq" || expression.operator === "neq") usesEq = true
        if (["lt", "lte", "gt", "gte"].includes(expression.operator)) usesOrder = true
      }
    })
  }
  const entries = ["", ...[...literals].filter((value) => value !== "").sort()]
  const offsets = new Map<string, number>()
  let cursor = 0
  for (const entry of entries) {
    offsets.set(entry, cursor)
    cursor += 4 + Buffer.byteLength(entry, "utf8")
  }
  return { used, entries, offsets, poolBytes: cursor, usesConcat, usesEq, usesOrder, maxStringParams }
}

/**
 * One host-supplied environment slot. Scalars become exported mutable globals
 * (`__smithers_env_<globalIndex>`); strings become a fixed record in the reserved
 * environment region at `envBase + stringIndex * (4 + MAX_STRING_BYTES)`, which
 * Wasm reads through a compile-time constant pointer.
 */
interface PortableEnvSlot {
  readonly capability: string
  readonly field: string
  readonly valueType: PortableValueType
  /** `"<Capability>.<field>"`: the canonical environment key in both runtimes. */
  readonly key: string
  /** Exported-global ordinal for scalars; -1 for string fields. */
  readonly globalIndex: number
  /** Environment string-region ordinal for strings; -1 for scalars. */
  readonly stringIndex: number
}

interface PortableEnvLayout {
  readonly slots: readonly PortableEnvSlot[]
  readonly byKey: ReadonlyMap<string, PortableEnvSlot>
  readonly globalCount: number
  readonly stringCount: number
}

/**
 * Canonical environment slot assignment, derived identically by WAT emission,
 * export-surface inspection, and both runtimes: capabilities in name order,
 * fields in name order, scalars and strings numbered independently.
 */
const moduleEnvLayout = (capabilities: readonly PortableCapability[]): PortableEnvLayout => {
  const slots: PortableEnvSlot[] = []
  let globalCount = 0
  let stringCount = 0
  for (const capability of capabilities) {
    for (const field of capability.fields) {
      const isString = field.valueType === "string"
      slots.push({
        capability: capability.name,
        field: field.name,
        valueType: field.valueType,
        key: `${capability.name}.${field.name}`,
        globalIndex: isString ? -1 : globalCount++,
        stringIndex: isString ? stringCount++ : -1
      })
    }
  }
  return { slots, byKey: new Map(slots.map((slot) => [slot.key, slot])), globalCount, stringCount }
}

interface PortableMemoryLayout {
  /** Host-written string-argument region base ([u32 len][bytes], packed). */
  readonly inputBase: number
  readonly inputBytes: number
  /** inputBase + inputBytes: the exclusive upper bound of the input region. */
  readonly inputLimit: number
  /** Host-written environment string region base (one packed record per slot). */
  readonly envBase: number
  readonly envBytes: number
  /** Bump-allocated concat heap base; `$__heap` resets here per invocation. */
  readonly heapBase: number
  readonly heapBytes: number
  /** heapBase + heapBytes: the exclusive upper bound the allocator enforces. */
  readonly heapLimit: number
  readonly memoryBytes: number
  readonly pages: number
}

/** Deterministic layout shared by WAT emission and the host executor. */
const moduleMemoryLayout = (facts: PortableStringFacts, env: PortableEnvLayout): PortableMemoryLayout => {
  const inputBase = (facts.poolBytes + 3) & ~3
  const inputBytes = facts.maxStringParams * (4 + MAX_STRING_BYTES)
  const inputLimit = inputBase + inputBytes
  // Every region stride is a multiple of 4, so inputLimit stays 4-aligned and
  // the environment records land on aligned addresses without extra padding.
  const envBase = inputLimit
  const envBytes = env.stringCount * (4 + MAX_STRING_BYTES)
  const heapBase = envBase + envBytes
  const heapBytes = facts.usesConcat ? PORTABLE_STRING_HEAP_BYTES : 0
  const heapLimit = heapBase + heapBytes
  const memoryBytes = heapLimit
  const pages = Math.max(1, Math.ceil(memoryBytes / WASM_PAGE_BYTES))
  return { inputBase, inputBytes, inputLimit, envBase, envBytes, heapBase, heapBytes, heapLimit, memoryBytes, pages }
}

/** Byte offset of one environment string record. */
const envStringOffset = (layout: PortableMemoryLayout, stringIndex: number): number =>
  layout.envBase + stringIndex * (4 + MAX_STRING_BYTES)

/** Exported f64 payload globals needed to carry the widest declared failure. */
const modulePayloadSlots = (module: PortableModuleIR): number => {
  let slots = 0
  for (const fn of module.functions) {
    if (fn.result.kind !== "result") continue
    for (const error of fn.result.errors) slots = Math.max(slots, error.fields.length)
  }
  return slots
}

/**
 * Wire-boundary input validation shared verbatim by both runtimes, so a
 * rejected argument (wrong type, non-finite, -0, non-ASCII string, oversized
 * string) is rejected identically before either runtime executes.
 */
const inputValues = (
  fn: PortableFunctionIR,
  input: Readonly<Record<string, unknown>>
): readonly (number | boolean | string)[] => {
  const normalized = assertJson(input, `portable input for ${fn.name}`)
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) return fail("SMITHERS5052", "portable input must be an object")
  if (canonicalJson(Object.keys(normalized).sort()) !== canonicalJson(fn.parameters.map((parameter) => parameter.name).sort())) {
    return fail("SMITHERS5052", `portable input for ${fn.name} has missing or unknown fields`)
  }
  return fn.parameters.map((parameter) => {
    const value = normalized[parameter.name]
    if (
      (parameter.valueType === "number" && (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0))) ||
      (parameter.valueType === "boolean" && typeof value !== "boolean") ||
      (parameter.valueType === "string" && !validPortableStringValue(value))
    ) {
      return fail("SMITHERS5052", `portable input ${parameter.name} must be ${parameter.valueType === "string"
        ? `a printable ASCII string of at most ${MAX_STRING_BYTES} bytes`
        : parameter.valueType}`)
    }
    return value as number | boolean | string
  })
}

/** Shared, exact value-domain check for one supplied environment field. */
const environmentField = (
  capability: string,
  field: PortableCapabilityField,
  value: unknown
): number | boolean | string => {
  if (
    (field.valueType === "number" && (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0))) ||
    (field.valueType === "boolean" && typeof value !== "boolean") ||
    (field.valueType === "string" && !validPortableStringValue(value))
  ) {
    return fail("SMITHERS5073", `portable environment ${capability}.${field.name} must be ${field.valueType === "string"
      ? `a printable ASCII string of at most ${MAX_STRING_BYTES} bytes`
      : field.valueType}`)
  }
  return value as number | boolean | string
}

/**
 * Validate the host-supplied environment against the SELECTED function's
 * declared requirement row before either runtime executes a single operation.
 * Exact rows both ways: an unknown or extra capability is as fatal as a missing
 * one, and so is an unknown or missing field. Because rows are transitively
 * closed, the resulting map is total for the whole invocation.
 */
const environmentValues = (
  fn: PortableFunctionIR,
  capabilities: readonly PortableCapability[],
  environment: unknown
): ReadonlyMap<string, number | boolean | string> => {
  const normalized = assertJson(environment, `portable environment for ${fn.name}`)
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) {
    return fail("SMITHERS5073", "portable environment must be an object of capability records")
  }
  const supplied = Object.keys(normalized).sort()
  if (canonicalJson(supplied) !== canonicalJson([...fn.requirements])) {
    const missing = fn.requirements.filter((requirement) => !supplied.includes(requirement))
    const unknown = supplied.filter((name) => !fn.requirements.includes(name))
    return fail(
      "SMITHERS5073",
      `portable environment for ${fn.name} does not match its requirement row ${JSON.stringify([...fn.requirements])}` +
      `${missing.length > 0 ? `; missing ${JSON.stringify(missing)}` : ""}` +
      `${unknown.length > 0 ? `; unknown ${JSON.stringify(unknown)}` : ""}`
    )
  }
  const byName = new Map(capabilities.map((capability) => [capability.name, capability]))
  const values = new Map<string, number | boolean | string>()
  for (const name of fn.requirements) {
    const capability = byName.get(name)
    if (capability === undefined) return fail("SMITHERS5073", `portable environment names capability ${name} the module does not declare`)
    const record = (normalized as Record<string, unknown>)[name]
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      return fail("SMITHERS5073", `portable environment entry ${name} must be an object of its declared fields`)
    }
    const fields = capability.fields.map((field) => field.name).sort()
    if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(fields)) {
      return fail("SMITHERS5073", `portable environment entry ${name} has missing or unknown fields; it must supply exactly ${JSON.stringify(fields)}`)
    }
    for (const field of capability.fields) {
      values.set(`${name}.${field.name}`, environmentField(name, field, (record as Record<string, unknown>)[field.name]))
    }
  }
  return values
}

type InternalExit =
  | { readonly kind: "value"; readonly value: number | boolean | string }
  | { readonly kind: "absent" }
  | { readonly kind: "failure"; readonly identity: string; readonly payload: Readonly<Record<string, number | boolean | string>> }
  | { readonly kind: "defect"; readonly defect: PortableDefect }

/** Aborts expression evaluation when a budget (fuel or string heap) ran out. */
class PortableDefectSignal {
  constructor(readonly defect: PortableDefect) {}
}

interface EvaluationScope {
  readonly module: PortableModuleIR
  readonly functionsByName: ReadonlyMap<string, PortableFunctionIR>
  /** Validated environment, keyed `"<Capability>.<field>"`, total for the row. */
  readonly environment: ReadonlyMap<string, number | boolean | string>
  fuel: number
  /** Concat heap bytes consumed this exported invocation (4 + content each). */
  heapUsed: number
}

interface EvaluationFrame {
  readonly parameters: readonly (number | boolean | string)[]
  readonly locals: (number | boolean | string)[]
}

type StatementOutcome =
  | { readonly kind: "normal" }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "exit"; readonly exit: InternalExit }

const NORMAL: StatementOutcome = { kind: "normal" }

const callPortableFunction = (
  scope: EvaluationScope,
  name: string,
  callArguments: readonly (number | boolean | string)[]
): InternalExit => {
  const fn = scope.functionsByName.get(name)
  if (fn === undefined) return fail("SMITHERS5053", `portable evaluator has no function ${name}`)
  // Wasm locals are zero-initialized; mirror that exactly so a validator gap
  // can never let the two runtimes observe different uninitialized values.
  // The string zero value "" matches the pool entry pinned at Wasm offset 0.
  const locals = fn.locals.map((local): number | boolean | string =>
    local.valueType === "number" ? 0 : local.valueType === "boolean" ? false : "")
  const frame: EvaluationFrame = { parameters: callArguments, locals }
  const outcome = evaluateStatements(fn.body, frame, scope)
  if (outcome.kind !== "exit") return fail("SMITHERS5053", `portable function ${name} did not terminate with an exit`)
  return outcome.exit
}

const evaluateStatements = (
  statements: readonly PortableStatement[],
  frame: EvaluationFrame,
  scope: EvaluationScope
): StatementOutcome => {
  for (const statement of statements) {
    const outcome = evaluateStatement(statement, frame, scope)
    if (outcome.kind !== "normal") return outcome
  }
  return NORMAL
}

const evaluateStatement = (
  statement: PortableStatement,
  frame: EvaluationFrame,
  scope: EvaluationScope
): StatementOutcome => {
  switch (statement.kind) {
    case "let":
    case "assign":
      frame.locals[statement.index] = evaluateExpression(statement.value, frame, scope)
      return NORMAL
    case "bind-call": {
      const exit = callPortableFunction(scope, statement.callee, statement.arguments.map((argument) => evaluateExpression(argument, frame, scope)))
      if (exit.kind === "value") {
        frame.locals[statement.index] = exit.value
        return NORMAL
      }
      return { kind: "exit", exit }
    }
    case "tail-call": {
      const exit = callPortableFunction(scope, statement.callee, statement.arguments.map((argument) => evaluateExpression(argument, frame, scope)))
      return { kind: "exit", exit }
    }
    case "if":
      return evaluateExpression(statement.condition, frame, scope)
        ? evaluateStatements(statement.whenTrue, frame, scope)
        : evaluateStatements(statement.whenFalse, frame, scope)
    case "while": {
      for (;;) {
        if (scope.fuel < 1) return { kind: "exit", exit: { kind: "defect", defect: "fuel-exhausted" } }
        scope.fuel -= 1
        if (!evaluateExpression(statement.condition, frame, scope)) return NORMAL
        const outcome = evaluateStatements(statement.body, frame, scope)
        if (outcome.kind === "exit") return outcome
        if (outcome.kind === "break") return NORMAL
        for (const update of statement.update) evaluateStatement(update, frame, scope)
      }
    }
    case "break": return { kind: "break" }
    case "continue": return { kind: "continue" }
    case "return":
    case "present":
      return { kind: "exit", exit: { kind: "value", value: evaluateExpression(statement.value, frame, scope) } }
    case "absent": return { kind: "exit", exit: { kind: "absent" } }
    case "failure": {
      const payload: Record<string, number | boolean | string> = {}
      statement.arguments.forEach((argument, index) => {
        payload[failureFieldName(scope, statement, index)] = evaluateExpression(argument, frame, scope)
      })
      return { kind: "exit", exit: { kind: "failure", identity: statement.identity, payload } }
    }
  }
}

/** Field names come from the (validated) variant declaration, not the wire. */
const failureFieldName = (scope: EvaluationScope, statement: Extract<PortableStatement, { kind: "failure" }>, index: number): string => {
  for (const fn of scope.module.functions) {
    if (fn.result.kind !== "result") continue
    const variant = fn.result.errors.find((error) => error.identity === statement.identity)
    if (variant !== undefined) return variant.fields[index]!.name
  }
  return fail("SMITHERS5053", `portable failure ${statement.identity} has no declaring row`)
}

const evaluateExpression = (
  expression: PortableExpression,
  frame: EvaluationFrame,
  scope: EvaluationScope
): number | boolean | string => {
  switch (expression.kind) {
    case "literal": return expression.value
    case "parameter": return frame.parameters[expression.index]!
    case "local": return frame.locals[expression.index]!
    case "capability": {
      // Validated rows are transitively closed, so every slot a reachable
      // function can read was already supplied and checked.
      const value = scope.environment.get(`${expression.capability}.${expression.field}`)
      if (value === undefined) {
        return fail("SMITHERS5053", `portable evaluator has no environment value for ${expression.capability}.${expression.field}`)
      }
      return value
    }
    case "string-length": return (evaluateExpression(expression.value, frame, scope) as string).length
    case "call": {
      const exit = callPortableFunction(scope, expression.callee, expression.arguments.map((argument) => evaluateExpression(argument, frame, scope)))
      if (exit.kind === "value") return exit.value
      if (exit.kind === "defect") throw new PortableDefectSignal(exit.defect)
      return fail("SMITHERS5053", "portable plain callee produced a non-value exit")
    }
    case "unary": {
      const value = evaluateExpression(expression.value, frame, scope)
      if (expression.operator === "not") return !(value as boolean)
      if (expression.operator === "positive") return +(value as number)
      return -(value as number)
    }
    case "select": return evaluateExpression(expression.condition, frame, scope)
      ? evaluateExpression(expression.whenTrue, frame, scope)
      : evaluateExpression(expression.whenFalse, frame, scope)
    case "binary": {
      const left = evaluateExpression(expression.left, frame, scope)
      if (expression.operator === "and") return (left as boolean) && (evaluateExpression(expression.right, frame, scope) as boolean)
      if (expression.operator === "or") return (left as boolean) || (evaluateExpression(expression.right, frame, scope) as boolean)
      const right = evaluateExpression(expression.right, frame, scope)
      // Portable strings are printable ASCII (one byte per UTF-16 unit), so
      // JS relational/equality operators coincide exactly with the Wasm
      // byte-lexicographic $__str_cmp / length+bytes $__str_eq helpers.
      const strings = expression.left.valueType === "string"
      switch (expression.operator) {
        case "add": return (left as number) + (right as number)
        case "subtract": return (left as number) - (right as number)
        case "multiply": return (left as number) * (right as number)
        case "divide": return (left as number) / (right as number)
        case "concat": {
          // Mirror the Wasm bump allocator: operands evaluate first, then the
          // allocation of [u32 len][bytes] is charged before the copy.
          const needed = 4 + (left as string).length + (right as string).length
          if (scope.heapUsed + needed > PORTABLE_STRING_HEAP_BYTES) {
            throw new PortableDefectSignal("string-memory-exhausted")
          }
          scope.heapUsed += needed
          return (left as string) + (right as string)
        }
        case "eq": return left === right
        case "neq": return left !== right
        case "lt": return strings ? (left as string) < (right as string) : (left as number) < (right as number)
        case "lte": return strings ? (left as string) <= (right as string) : (left as number) <= (right as number)
        case "gt": return strings ? (left as string) > (right as string) : (left as number) > (right as number)
        case "gte": return strings ? (left as string) >= (right as string) : (left as number) >= (right as number)
      }
    }
  }
}

const canonicalWireValue = (valueType: PortableValueType, value: unknown, label: string): number | boolean | string => {
  if (
    (valueType === "number" && (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0))) ||
    (valueType === "boolean" && typeof value !== "boolean") ||
    (valueType === "string" && !validPortableStringValue(value))
  ) return fail("SMITHERS5053", `${label} is outside the canonical scalar wire domain`)
  return value as number | boolean | string
}

const wireExit = (fn: PortableFunctionIR, exit: InternalExit): PortableExecution => {
  let wire: PortableWireExit
  if (exit.kind === "absent") {
    if (fn.result.kind !== "optional") return fail("SMITHERS5053", "backend produced absence for non-Optional function")
    wire = { kind: "absent" }
  } else if (exit.kind === "defect") {
    wire = { kind: "defect", defect: exit.defect }
  } else if (exit.kind === "failure") {
    const variant = fn.result.kind === "result"
      ? fn.result.errors.find((error) => error.identity === exit.identity)
      : undefined
    if (variant === undefined) return fail("SMITHERS5053", "backend produced undeclared failure")
    const payloadKeys = Object.keys(exit.payload).sort()
    if (canonicalJson(payloadKeys) !== canonicalJson(variant.fields.map((field) => field.name).sort())) {
      return fail("SMITHERS5053", "portable failure payload fields do not match the declared variant")
    }
    const payload: Record<string, number | boolean | string> = {}
    for (const field of variant.fields) {
      payload[field.name] = canonicalWireValue(field.valueType, exit.payload[field.name], `portable failure payload ${field.name}`)
    }
    wire = { kind: "failure", error: { identity: exit.identity, payload } }
  } else {
    wire = {
      kind: "success",
      value: canonicalWireValue(fn.result.valueType, exit.value, "portable output")
    }
  }
  const frozen = deepFreeze(wire)
  return deepFreeze({
    contractDigest: fn.contractDigest,
    exit: frozen,
    wireDigest: digest({ wireVersion: 1, contractDigest: fn.contractDigest, exit: frozen })
  })
}

const selectedFunction = (module: PortableModuleIR, name: string): PortableFunctionIR =>
  module.functions.find((fn) => fn.name === name) ?? fail("SMITHERS5054", `portable module has no function ${name}`)

export const executePortableTypeScript = (
  moduleValue: PortableModuleIR,
  functionName: string,
  input: Readonly<Record<string, unknown>>,
  environment: PortableEnvironment = {}
): PortableExecution => {
  const module = validatePortableModule(moduleValue)
  const fn = selectedFunction(module, functionName)
  const scope: EvaluationScope = {
    module,
    functionsByName: new Map(module.functions.map((entry) => [entry.name, entry])),
    environment: environmentValues(fn, module.capabilities, environment),
    fuel: PORTABLE_LOOP_FUEL,
    heapUsed: 0
  }
  let exit: InternalExit
  try {
    exit = callPortableFunction(scope, fn.name, inputValues(fn, input))
  } catch (error) {
    if (!(error instanceof PortableDefectSignal)) throw error
    exit = { kind: "defect", defect: error.defect }
  }
  return wireExit(fn, exit)
}

/** Strings lower to i32 offsets into linear memory (pool, input, or heap). */
const wasmType = (type: PortableValueType): "f64" | "i32" => type === "number" ? "f64" : "i32"

const watFloat = (value: number): string => {
  if (!Number.isFinite(value) || Object.is(value, -0)) return fail("SMITHERS5055", "Wasm numeric literal is outside the portable wire domain")
  return value.toString()
}

const dummyValue = (type: PortableValueType): string => type === "number" ? "(f64.const 0)" : "(i32.const 0)"

interface WatContext {
  readonly fn: PortableFunctionIR
  readonly defects: ReadonlyMap<string, PortableDefectFacts>
  readonly functionsByName: ReadonlyMap<string, PortableFunctionIR>
  readonly strings: PortableStringFacts
  readonly env: PortableEnvLayout
  readonly layout: PortableMemoryLayout
  readonly loopDepth: number
}

/** Whether the function's Wasm ABI carries a leading i32 exit tag. */
const taggedAbi = (fn: PortableFunctionIR, defects: ReadonlyMap<string, PortableDefectFacts>): boolean =>
  fn.result.kind !== "plain" || canAnyDefect(defects.get(fn.name))

const watResults = (fn: PortableFunctionIR, defects: ReadonlyMap<string, PortableDefectFacts>): string =>
  taggedAbi(fn, defects) ? `(result i32 ${wasmType(fn.result.valueType)})` : `(result ${wasmType(fn.result.valueType)})`

/**
 * Early-return of a defect out of the current (tagged) caller. Origination
 * sites pass the concrete negative tag; propagation sites pass
 * `(local.get $__tag)` so the originating defect kind is preserved.
 */
const watDefectReturn = (context: WatContext, tag: string): string =>
  `(return ${tag} ${dummyValue(context.fn.result.valueType)})`

const scratchValue = (type: PortableValueType): string => type === "number" ? "$__val_f64" : "$__val_i32"

/** Call a tagged callee, leaving its tag in $__tag and value in a scratch local. */
const watTaggedCall = (callee: PortableFunctionIR, callArguments: readonly string[]): string =>
  `(call $__impl_${callee.name} ${callArguments.join(" ")}) (local.set ${scratchValue(callee.result.valueType)}) (local.set $__tag)`

const watExpression = (expression: PortableExpression, context: WatContext): string => {
  switch (expression.kind) {
    case "literal": {
      if (expression.valueType === "number") return `(f64.const ${watFloat(expression.value as number)})`
      if (expression.valueType === "string") {
        const offset = context.strings.offsets.get(expression.value as string)
        if (offset === undefined) return fail("SMITHERS5055", "portable string literal is missing from the interned pool")
        return `(i32.const ${offset})`
      }
      return `(i32.const ${expression.value ? 1 : 0})`
    }
    case "string-length": return `(f64.convert_i32_u (i32.load ${watExpression(expression.value, context)}))`
    case "parameter":
    case "local": return `(local.get $${expression.name})`
    case "capability": {
      const slot = context.env.byKey.get(`${expression.capability}.${expression.field}`)
      if (slot === undefined || slot.valueType !== expression.valueType) {
        return fail("SMITHERS5055", `portable capability read ${expression.capability}.${expression.field} has no environment slot`)
      }
      // Scalars live in host-written exported globals; string records live at a
      // fixed environment offset, so the pointer itself is a constant.
      return slot.valueType === "string"
        ? `(i32.const ${envStringOffset(context.layout, slot.stringIndex)})`
        : `(global.get $__smithers_env_${slot.globalIndex})`
    }
    case "call": {
      const callee = context.functionsByName.get(expression.callee)!
      const callArguments = expression.arguments.map((argument) => watExpression(argument, context))
      if (!taggedAbi(callee, context.defects)) return `(call $__impl_${callee.name} ${callArguments.join(" ")})`
      // A plain callee with a tagged ABI can only report success (0) or a
      // negative defect tag; thread that exact tag through the caller's own
      // tagged ABI so the defect kind survives propagation.
      const valueLocal = scratchValue(callee.result.valueType)
      return `(block (result ${wasmType(expression.valueType)}) ${watTaggedCall(callee, callArguments)} ` +
        `(if (i32.ne (local.get $__tag) (i32.const 0)) (then ${watDefectReturn(context, "(local.get $__tag)")})) (local.get ${valueLocal}))`
    }
    case "unary": {
      const value = watExpression(expression.value, context)
      if (expression.operator === "positive") return value
      if (expression.operator === "not") return `(i32.eqz ${value})`
      return `(f64.neg ${value})`
    }
    case "select": return `(if (result ${wasmType(expression.valueType)}) ${watExpression(expression.condition, context)} (then ${watExpression(expression.whenTrue, context)}) (else ${watExpression(expression.whenFalse, context)}))`
    case "binary": {
      const left = watExpression(expression.left, context)
      if (expression.operator === "and") return `(if (result i32) ${left} (then ${watExpression(expression.right, context)}) (else (i32.const 0)))`
      if (expression.operator === "or") return `(if (result i32) ${left} (then (i32.const 1)) (else ${watExpression(expression.right, context)}))`
      const right = watExpression(expression.right, context)
      if (expression.operator === "concat") {
        // $__concat returns the new offset, or -1 when the allocation would
        // exceed the heap budget; the containing function is always tagged.
        return `(block (result i32) (local.set $__val_i32 (call $__concat ${left} ${right})) ` +
          `(if (i32.lt_s (local.get $__val_i32) (i32.const 0)) (then ${watDefectReturn(context, `(i32.const ${STRING_DEFECT_TAG})`)})) ` +
          `(local.get $__val_i32))`
      }
      if (expression.left.valueType === "string") {
        // Content comparison: interned-pointer identity is only a fast path
        // inside the helpers because runtime strings are not interned.
        switch (expression.operator) {
          case "eq": return `(call $__str_eq ${left} ${right})`
          case "neq": return `(i32.eqz (call $__str_eq ${left} ${right}))`
          case "lt": return `(i32.lt_s (call $__str_cmp ${left} ${right}) (i32.const 0))`
          case "lte": return `(i32.le_s (call $__str_cmp ${left} ${right}) (i32.const 0))`
          case "gt": return `(i32.gt_s (call $__str_cmp ${left} ${right}) (i32.const 0))`
          case "gte": return `(i32.ge_s (call $__str_cmp ${left} ${right}) (i32.const 0))`
          default: return fail("SMITHERS5055", "portable string operands reached a non-string operator")
        }
      }
      const prefix = expression.left.valueType === "number" ? "f64" : "i32"
      const operation = ({
        add: "add", subtract: "sub", multiply: "mul", divide: "div",
        eq: "eq", neq: "ne", lt: "lt", lte: "le", gt: "gt", gte: "ge"
      } as const)[expression.operator]
      return `(${prefix}.${operation} ${left} ${right})`
    }
  }
}

/** Propagate a fallible/optional callee's non-success exits out of the caller. */
const watPropagation = (
  callee: PortableFunctionIR,
  context: WatContext
): string => {
  const parts: string[] = []
  if (canAnyDefect(context.defects.get(callee.name))) {
    // Negative tags are defects; forward the callee's own tag so the defect
    // kind (fuel vs string memory) survives every propagation hop unchanged.
    parts.push(`(if (i32.lt_s (local.get $__tag) (i32.const 0)) (then ${watDefectReturn(context, "(local.get $__tag)")}))`)
  }
  if (callee.result.kind === "optional") {
    parts.push(`(if (i32.eqz (local.get $__tag)) (then (return (i32.const 0) ${dummyValue(context.fn.result.valueType)})))`)
    parts.push(`(if (i32.ne (local.get $__tag) (i32.const 1)) (then (unreachable)))`)
    return parts.join(" ")
  }
  const callerErrors = context.fn.result.kind === "result" ? context.fn.result.errors : []
  const callerTagByIdentity = new Map(callerErrors.map((error) => [error.identity, error.tag]))
  if (callee.result.kind === "result") {
    for (const error of callee.result.errors) {
      const callerTag = callerTagByIdentity.get(error.identity)!
      parts.push(`(if (i32.eq (local.get $__tag) (i32.const ${error.tag})) (then (return (i32.const ${callerTag}) ${dummyValue(context.fn.result.valueType)})))`)
    }
  }
  parts.push(`(if (i32.ne (local.get $__tag) (i32.const 0)) (then (unreachable)))`)
  return parts.join(" ")
}

const watStatements = (
  statements: readonly PortableStatement[],
  context: WatContext,
  indent: string
): string => statements.map((statement) => indent + watStatement(statement, context, indent)).join("\n")

const watStatement = (statement: PortableStatement, context: WatContext, indent: string): string => {
  switch (statement.kind) {
    case "let":
    case "assign":
      return `(local.set $${statement.name} ${watExpression(statement.value, context)})`
    case "bind-call": {
      const callee = context.functionsByName.get(statement.callee)!
      const callArguments = statement.arguments.map((argument) => watExpression(argument, context))
      return `${watTaggedCall(callee, callArguments)} ${watPropagation(callee, context)} ` +
        `(local.set $${statement.name} (local.get ${scratchValue(callee.result.valueType)}))`
    }
    case "tail-call": {
      const callee = context.functionsByName.get(statement.callee)!
      const callArguments = statement.arguments.map((argument) => watExpression(argument, context))
      const successTag = callee.result.kind === "optional" ? 1 : 0
      return `${watTaggedCall(callee, callArguments)} ${watPropagation(callee, context)} ` +
        `(return (i32.const ${successTag}) (local.get ${scratchValue(callee.result.valueType)}))`
    }
    case "if": {
      const inner = indent + "  "
      const whenTrue = statement.whenTrue.length === 0 ? `${inner}(nop)` : watStatements(statement.whenTrue, context, inner)
      const whenFalse = statement.whenFalse.length === 0 ? `${inner}(nop)` : watStatements(statement.whenFalse, context, inner)
      return `(if ${watExpression(statement.condition, context)}\n${indent}(then\n${whenTrue}\n${indent})\n${indent}(else\n${whenFalse}\n${indent}))`
    }
    case "while": {
      const depth = context.loopDepth
      const loopContext: WatContext = { ...context, loopDepth: depth + 1 }
      const inner = indent + "    "
      const body = statement.body.length === 0 ? `${inner}(nop)` : watStatements(statement.body, loopContext, inner)
      const update = statement.update.length === 0 ? "" : "\n" + watStatements(statement.update, loopContext, indent + "  ")
      return [
        `(block $__break_${depth}`,
        `${indent}  (loop $__loop_${depth}`,
        `${indent}    (if (i32.lt_s (global.get $__fuel) (i32.const 1)) (then ${watDefectReturn(context, `(i32.const ${FUEL_DEFECT_TAG})`)}))`,
        `${indent}    (global.set $__fuel (i32.sub (global.get $__fuel) (i32.const 1)))`,
        `${indent}    (br_if $__break_${depth} (i32.eqz ${watExpression(statement.condition, context)}))`,
        `${indent}    (block $__continue_${depth}`,
        body,
        `${indent}    )${update}`,
        `${indent}    (br $__loop_${depth})`,
        `${indent}  )`,
        `${indent})`
      ].join("\n")
    }
    case "break": return `(br $__break_${context.loopDepth - 1})`
    case "continue": return `(br $__continue_${context.loopDepth - 1})`
    case "return": {
      const value = watExpression(statement.value, context)
      return taggedAbi(context.fn, context.defects) ? `(return (i32.const 0) ${value})` : `(return ${value})`
    }
    case "present": return `(return (i32.const 1) ${watExpression(statement.value, context)})`
    case "absent": return `(return (i32.const 0) ${dummyValue(context.fn.result.valueType)})`
    case "failure": {
      const variant = context.fn.result.kind === "result"
        ? context.fn.result.errors.find((error) => error.identity === statement.identity)!
        : fail("SMITHERS5055", "portable failure outside a Result function")
      const writes = statement.arguments.map((argument, index) => {
        const field = variant.fields[index]!
        const value = watExpression(argument, context)
        return `(global.set $__smithers_payload_${index} ${field.valueType === "number" ? value : `(f64.convert_i32_u ${value})`})`
      })
      return `${writes.join(" ")}${writes.length > 0 ? " " : ""}(return (i32.const ${statement.tag}) ${dummyValue(context.fn.result.valueType)})`
    }
  }
}

/** Pool bytes as an exact WAT data string: [u32 length LE][ASCII bytes] per entry. */
const watDataSegment = (strings: PortableStringFacts): string => {
  const bytes: number[] = []
  for (const entry of strings.entries) {
    const encoded = Buffer.from(entry, "utf8")
    bytes.push(encoded.byteLength & 0xff, (encoded.byteLength >>> 8) & 0xff, (encoded.byteLength >>> 16) & 0xff, (encoded.byteLength >>> 24) & 0xff)
    bytes.push(...encoded)
  }
  return bytes.map((byte) => `\\${byte.toString(16).padStart(2, "0")}`).join("")
}

/** `p + 4 + i`: the i-th content byte of the string record at pointer `p`. */
const watByteAt = (pointer: string, index: string): string =>
  `(i32.load8_u (i32.add (i32.add ${pointer} (i32.const 4)) ${index}))`

/**
 * Byte-for-byte string equality (`$__str_eq`) and byte-lexicographic ordering
 * (`$__str_cmp`, returning -1/0/1), plus the bump allocator (`$__concat`) and
 * its byte copier (`$__copy`, spelled as an explicit loop so the emitted module
 * never depends on the bulk-memory proposal being enabled in the toolchain).
 *
 * Pointer identity is only a fast path inside the comparison helpers: computed
 * strings (parameters written by the host, concat results) are NOT interned, so
 * equal content at different offsets must still compare equal. None of these
 * loops charge fuel — fuel measures author loop-condition evaluations only, and
 * the TypeScript evaluator's `===`/`<`/`+` are likewise uncharged, so both
 * runtimes exhaust their budgets at exactly the same operation.
 */
const watStringHelpers = (strings: PortableStringFacts, layout: PortableMemoryLayout): readonly string[] => [
  ...(strings.usesEq ? [
    `  (func $__str_eq (param $a i32) (param $b i32) (result i32) (local $n i32) (local $i i32)`,
    `    (if (i32.eq (local.get $a) (local.get $b)) (then (return (i32.const 1))))`,
    `    (local.set $n (i32.load (local.get $a)))`,
    `    (if (i32.ne (local.get $n) (i32.load (local.get $b))) (then (return (i32.const 0))))`,
    `    (block $__eq_done (loop $__eq_next`,
    `      (br_if $__eq_done (i32.ge_u (local.get $i) (local.get $n)))`,
    `      (if (i32.ne ${watByteAt("(local.get $a)", "(local.get $i)")} ${watByteAt("(local.get $b)", "(local.get $i)")})`,
    `        (then (return (i32.const 0))))`,
    `      (local.set $i (i32.add (local.get $i) (i32.const 1)))`,
    `      (br $__eq_next)))`,
    `    (i32.const 1)`,
    `  )`
  ] : []),
  ...(strings.usesOrder ? [
    `  (func $__str_cmp (param $a i32) (param $b i32) (result i32)`,
    `    (local $na i32) (local $nb i32) (local $n i32) (local $i i32) (local $ca i32) (local $cb i32)`,
    `    (if (i32.eq (local.get $a) (local.get $b)) (then (return (i32.const 0))))`,
    `    (local.set $na (i32.load (local.get $a)))`,
    `    (local.set $nb (i32.load (local.get $b)))`,
    `    (local.set $n (select (local.get $na) (local.get $nb) (i32.lt_u (local.get $na) (local.get $nb))))`,
    `    (block $__cmp_done (loop $__cmp_next`,
    `      (br_if $__cmp_done (i32.ge_u (local.get $i) (local.get $n)))`,
    `      (local.set $ca ${watByteAt("(local.get $a)", "(local.get $i)")})`,
    `      (local.set $cb ${watByteAt("(local.get $b)", "(local.get $i)")})`,
    `      (if (i32.lt_u (local.get $ca) (local.get $cb)) (then (return (i32.const -1))))`,
    `      (if (i32.gt_u (local.get $ca) (local.get $cb)) (then (return (i32.const 1))))`,
    `      (local.set $i (i32.add (local.get $i) (i32.const 1)))`,
    `      (br $__cmp_next)))`,
    `    (if (i32.lt_u (local.get $na) (local.get $nb)) (then (return (i32.const -1))))`,
    `    (if (i32.gt_u (local.get $na) (local.get $nb)) (then (return (i32.const 1))))`,
    `    (i32.const 0)`,
    `  )`
  ] : []),
  ...(strings.usesConcat ? [
    `  (func $__copy (param $dst i32) (param $src i32) (param $n i32) (local $i i32)`,
    `    (block $__copy_done (loop $__copy_next`,
    `      (br_if $__copy_done (i32.ge_u (local.get $i) (local.get $n)))`,
    `      (i32.store8 (i32.add (local.get $dst) (local.get $i))`,
    `        (i32.load8_u (i32.add (local.get $src) (local.get $i))))`,
    `      (local.set $i (i32.add (local.get $i) (i32.const 1)))`,
    `      (br $__copy_next)))`,
    `  )`,
    // Returns the new record's offset, or -1 when the allocation would push
    // past the per-invocation budget. Charged bytes are exactly
    // `4 + leftBytes + rightBytes`, matching the evaluator byte for byte.
    `  (func $__concat (param $a i32) (param $b i32) (result i32)`,
    `    (local $na i32) (local $nb i32) (local $need i32) (local $out i32)`,
    `    (local.set $na (i32.load (local.get $a)))`,
    `    (local.set $nb (i32.load (local.get $b)))`,
    `    (local.set $need (i32.add (i32.const 4) (i32.add (local.get $na) (local.get $nb))))`,
    `    (if (i32.gt_u (i32.add (global.get $__heap) (local.get $need)) (i32.const ${layout.heapLimit}))`,
    `      (then (return (i32.const -1))))`,
    `    (local.set $out (global.get $__heap))`,
    `    (global.set $__heap (i32.add (global.get $__heap) (local.get $need)))`,
    `    (i32.store (local.get $out) (i32.add (local.get $na) (local.get $nb)))`,
    `    (call $__copy (i32.add (local.get $out) (i32.const 4)) (i32.add (local.get $a) (i32.const 4)) (local.get $na))`,
    `    (call $__copy (i32.add (i32.add (local.get $out) (i32.const 4)) (local.get $na))`,
    `      (i32.add (local.get $b) (i32.const 4)) (local.get $nb))`,
    `    (local.get $out)`,
    `  )`
  ] : [])
]

export const emitPortableWat = (moduleValue: PortableModuleIR): string => {
  const module = validatePortableModule(moduleValue)
  const defects = moduleDefectMap(module)
  const functionsByName = new Map(module.functions.map((fn) => [fn.name, fn]))
  const payloadSlots = modulePayloadSlots(module)
  const strings = moduleStringFacts(module.functions, module.capabilities)
  const env = moduleEnvLayout(module.capabilities)
  const layout = moduleMemoryLayout(strings, env)
  const globals = [
    `  (global $__fuel (mut i32) (i32.const 0))`,
    ...(strings.usesConcat ? [`  (global $__heap (mut i32) (i32.const ${layout.heapBase}))`] : []),
    ...Array.from({ length: payloadSlots }, (_, index) =>
      `  (global $__smithers_payload_${index} (export "__smithers_payload_${index}") (mut f64) (f64.const 0))`),
    // Scalar environment slots: written by the HOST before each invocation and
    // only ever read by compiled code, exactly like the input string region.
    ...env.slots.filter((slot) => slot.globalIndex >= 0).map((slot) =>
      `  (global $__smithers_env_${slot.globalIndex} (export "__smithers_env_${slot.globalIndex}") (mut ${wasmType(slot.valueType)}) ` +
      `(${wasmType(slot.valueType)}.const 0))`),
    ...(strings.used ? [
      // Memory is exported so the host can write string arguments into the
      // reserved input region and decode computed string results back out.
      `  (memory (export "__memory") ${layout.pages})`,
      `  (data (i32.const 0) "${watDataSegment(strings)}")`
    ] : [])
  ]
  const functions = module.functions.map((fn) => {
    const context: WatContext = { fn, defects, functionsByName, strings, env, layout, loopDepth: 0 }
    const parameters = fn.parameters.map((parameter) => `(param $${parameter.name} ${wasmType(parameter.valueType)})`).join(" ")
    const locals = [
      `(local $__tag i32)`,
      `(local $__val_f64 f64)`,
      `(local $__val_i32 i32)`,
      ...fn.locals.map((local) => `(local $${local.name} ${wasmType(local.valueType)})`)
    ].join(" ")
    const results = watResults(fn, defects)
    const forwarded = fn.parameters.map((parameter) => `(local.get $${parameter.name})`).join(" ")
    return [
      `  (func $__impl_${fn.name} ${parameters} ${results} ${locals}`,
      watStatements(fn.body, context, "    "),
      `    (unreachable)`,
      `  )`,
      `  (func (export ${JSON.stringify(fn.name)}) ${parameters} ${results}`,
      `    (global.set $__fuel (i32.const ${PORTABLE_LOOP_FUEL}))`,
      // Both budgets belong to the exported invocation, never to the instance:
      // the concat heap is rewound to its base exactly where fuel is refilled.
      ...(strings.usesConcat ? [`    (global.set $__heap (i32.const ${layout.heapBase}))`] : []),
      `    (call $__impl_${fn.name}${forwarded.length > 0 ? ` ${forwarded}` : ""})`,
      `  )`
    ].join("\n")
  }).join("\n")
  const helpers = watStringHelpers(strings, layout)
  const wat = `(module\n${globals.join("\n")}\n${helpers.length > 0 ? `${helpers.join("\n")}\n` : ""}${functions}\n)\n`
  if (Buffer.byteLength(wat, "utf8") > MAX_WAT_BYTES) return fail("SMITHERS5056", `portable WAT exceeds ${MAX_WAT_BYTES} bytes`)
  return wat
}

const binaryDigest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

const validToolIdentity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value, "utf8") <= MAX_TOOL_IDENTITY_BYTES &&
  !/[\u0000-\u001f\u007f]/.test(value)

const inspectPortableWasm = (wasm: Uint8Array, module: PortableModuleIR, code: "SMITHERS5058" | "SMITHERS5059"): WebAssembly.Module => {
  let compiled: WebAssembly.Module
  try {
    const moduleBytes = Uint8Array.from(wasm)
    compiled = new WebAssembly.Module(moduleBytes.buffer as ArrayBuffer)
  } catch (error) {
    return fail(code, `portable Wasm is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (WebAssembly.Module.imports(compiled).length !== 0) return fail(code, "portable Wasm unexpectedly imports host authority")
  const exports = WebAssembly.Module.exports(compiled).map((entry) => `${entry.kind}:${entry.name}`).sort()
  const expected = [
    ...module.functions.map((fn) => `function:${fn.name}`),
    ...Array.from({ length: modulePayloadSlots(module) }, (_, index) => `global:__smithers_payload_${index}`),
    // The environment surface is the module's requirement descriptor: exactly
    // one exported global per declared scalar capability field, no more and no
    // fewer. A module that opens an environment slot it never declared — or
    // hides one it did — is a forged ABI and never reaches execution.
    ...Array.from(
      { length: moduleEnvLayout(module.capabilities).globalCount },
      (_, index) => `global:__smithers_env_${index}`
    ),
    // Memory is exported exactly when the checked IR uses strings; a module
    // that exports memory without needing it (or hides it while needing it)
    // is a forged ABI and never reaches execution.
    ...(moduleStringFacts(module.functions, module.capabilities).used ? ["memory:__memory"] : [])
  ].sort()
  if (canonicalJson(exports) !== canonicalJson(expected)) return fail(code, "portable Wasm exports do not match checked IR")
  return compiled
}

const runTool = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number
): Promise<{ readonly stdout: string; readonly stderr: string }> => new Promise((resolveResult, reject) => {
  const grouped = process.platform !== "win32"
  const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], detached: grouped })
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
  child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk))
  child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk))
  child.once("error", (error) => { failure ??= error; kill() })
  const timer = setTimeout(() => {
    // `close`, rather than leader exit, is the completion boundary. A child
    // can leave descendants holding our pipes open; the deadline must still
    // kill the entire process group instead of waiting forever.
    timedOut = true
    kill()
  }, timeoutMs)
  timer.unref()
  child.once("close", (code, signal) => {
    clearTimeout(timer)
    if (grouped && child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL") } catch { /* already gone */ }
    }
    if (timedOut) return reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    if (failure) return reject(failure)
    const out = Buffer.concat(stdout).toString("utf8")
    const err = Buffer.concat(stderr).toString("utf8")
    if (code !== 0) return reject(new Error(`${command} failed (code ${String(code)}, signal ${String(signal)}): ${err}`))
    resolveResult({ stdout: out, stderr: err })
  })
})

export const compilePortableWasm = async (
  moduleValue: PortableModuleIR,
  options: PortableWasmOptions = {}
): Promise<PortableWasmBuild> => {
  const module = validatePortableModule(moduleValue)
  const command = options.wat2wasm ?? "wat2wasm"
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024
  if (typeof command !== "string" || command.length === 0 || command.length > 4_096 || command.includes("\0")) {
    return fail("SMITHERS5057", "portable Wasm tool command is invalid")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) return fail("SMITHERS5057", "portable Wasm timeout is invalid")
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 8 * 1024 * 1024) return fail("SMITHERS5057", "portable Wasm output limit is invalid")
  const wat = emitPortableWat(module)
  const toolVersion = (await runTool(command, ["--version"], timeoutMs, maxOutputBytes)).stdout.trim()
  if (!validToolIdentity(toolVersion)) return fail("SMITHERS5057", "wat2wasm returned an invalid tool identity")
  const directory = await mkdtemp(join(tmpdir(), "smithers-portable-wasm-"))
  const sourcePath = join(directory, "module.wat")
  const outputPath = join(directory, "module.wasm")
  let wasm: Uint8Array
  try {
    await writeFile(sourcePath, wat, "utf8")
    await runTool(command, [sourcePath, "-o", outputPath], timeoutMs, maxOutputBytes)
    let outputStat
    try {
      outputStat = await lstat(outputPath)
    } catch (error) {
      return fail("SMITHERS5058", `wat2wasm did not produce its output file: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!outputStat.isFile() || outputStat.size > MAX_WASM_BYTES) {
      return fail("SMITHERS5058", `portable Wasm output must be a regular file no larger than ${MAX_WASM_BYTES} bytes`)
    }
    const bytes = await readFile(outputPath)
    if (bytes.byteLength > MAX_WASM_BYTES) return fail("SMITHERS5058", `portable Wasm exceeds ${MAX_WASM_BYTES} bytes`)
    wasm = Uint8Array.from(bytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  inspectPortableWasm(wasm, module, "SMITHERS5058")
  const watDigest = digest(wat)
  const wasmDigest = binaryDigest(wasm)
  const semantic = {
    formatVersion: 4 as const,
    module,
    tool: "wat2wasm" as const,
    toolVersion,
    wat,
    watDigest,
    wasmDigest
  }
  return Object.freeze({ ...semantic, wasm, digest: digest({
    formatVersion: semantic.formatVersion,
    moduleDigest: module.digest,
    tool: semantic.tool,
    toolVersion,
    watDigest,
    wasmDigest
  }) })
}

const WASM_BUILD_KEYS = [
  "digest", "formatVersion", "module", "tool", "toolVersion", "wasm", "wasmDigest", "wat", "watDigest"
] as const

const validateBuild = (value: unknown): { readonly module: PortableModuleIR; readonly wasm: Uint8Array } => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail("SMITHERS5059", "portable Wasm build must be a plain object")
  }
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    canonicalJson((ownKeys as string[]).sort()) !== canonicalJson([...WASM_BUILD_KEYS].sort())
  ) return fail("SMITHERS5059", "portable Wasm build has missing or unknown fields")
  for (const key of WASM_BUILD_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return fail("SMITHERS5059", "portable Wasm build cannot contain accessors or hidden fields")
    }
  }
  const build = value as PortableWasmBuild
  const module = validatePortableModule(build.module)
  if (!(build.wasm instanceof Uint8Array) || build.wasm.byteLength === 0 || build.wasm.byteLength > MAX_WASM_BYTES) {
    return fail("SMITHERS5059", "portable Wasm build binary is invalid")
  }
  // Snapshot mutable ArrayBuffer-backed bytes once, then hash, inspect, and
  // execute this same copy so concurrent mutation cannot cross validation.
  const wasm = Uint8Array.from(build.wasm)
  if (
    build.formatVersion !== 4 || build.tool !== "wat2wasm" || !validToolIdentity(build.toolVersion) ||
    typeof build.wat !== "string" || Buffer.byteLength(build.wat, "utf8") > MAX_WAT_BYTES ||
    build.wat !== emitPortableWat(module) || build.watDigest !== digest(build.wat) ||
    typeof build.wasmDigest !== "string" || !HEX_DIGEST.test(build.wasmDigest) || build.wasmDigest !== binaryDigest(wasm)
  ) return fail("SMITHERS5059", "portable Wasm build identity/content mismatch")
  const expected = digest({
    formatVersion: 4,
    moduleDigest: module.digest,
    tool: "wat2wasm",
    toolVersion: build.toolVersion,
    watDigest: build.watDigest,
    wasmDigest: build.wasmDigest
  })
  if (build.digest !== expected) return fail("SMITHERS5059", "portable Wasm build digest mismatch")
  inspectPortableWasm(wasm, module, "SMITHERS5059")
  return { module, wasm }
}

const decodeWasmScalar = (type: PortableScalarType, value: unknown, label: string): number | boolean => {
  if (type === "number") {
    if (typeof value !== "number") return fail("SMITHERS5060", `${label} is not an f64 value`)
    return value
  }
  if (value !== 0 && value !== 1) return fail("SMITHERS5060", `${label} is not a canonical i32 boolean`)
  return value === 1
}

/**
 * The exported memory view, checked against the IR-derived layout, or
 * `undefined` for modules that use no string feature at all (those export no
 * memory). A module that exports the wrong shape never reaches execution.
 */
const wasmMemoryView = (
  instance: WebAssembly.Instance,
  strings: PortableStringFacts,
  layout: PortableMemoryLayout
): Uint8Array | undefined => {
  if (!strings.used) return undefined
  const exported = instance.exports.__memory
  if (!(exported instanceof WebAssembly.Memory)) return fail("SMITHERS5060", "portable Wasm does not export its string memory")
  const bytes = new Uint8Array(exported.buffer)
  if (bytes.byteLength < layout.memoryBytes) {
    return fail("SMITHERS5060", "portable Wasm memory is smaller than the checked layout requires")
  }
  return bytes
}

/**
 * Decode one `[u32 length LE][bytes]` record from exported memory. Nothing
 * about the offset is trusted: it must be a non-negative integer whose whole
 * record lies inside the IR-derived layout bound, so a forged Wasm returning an
 * arbitrary or out-of-range pointer is rejected here instead of reading
 * whatever bytes happen to follow. The interned pool is no longer the validity
 * oracle — computed strings legitimately live in the input and heap regions —
 * so content itself is re-checked against the canonical wire domain by
 * `canonicalWireValue` afterwards, exactly as in the TypeScript runtime.
 */
const readWasmString = (
  memory: Uint8Array,
  layout: PortableMemoryLayout,
  value: unknown,
  label: string
): string => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail("SMITHERS5060", `${label} is not an i32 string offset`)
  }
  if (value + 4 > layout.memoryBytes) return fail("SMITHERS5060", `${label} string offset is outside exported memory`)
  // Reconstruct the u32 with arithmetic, never bitwise `|`: a forged high byte
  // (>= 0x80) in the top position would make an int32 length negative and slip
  // past the bounds check below.
  const length = memory[value]! + memory[value + 1]! * 0x100 + memory[value + 2]! * 0x1_0000 + memory[value + 3]! * 0x100_0000
  if (length < 0 || value + 4 + length > layout.memoryBytes) {
    return fail("SMITHERS5060", `${label} string length is outside exported memory`)
  }
  // latin1 keeps every forged byte distinguishable (no U+FFFD folding) so a
  // non-ASCII byte fails the canonical wire-domain check rather than silently
  // decoding into some other character.
  return Buffer.from(memory.buffer, memory.byteOffset + value + 4, length).toString("latin1")
}

const decodeWasmValue = (
  type: PortableValueType,
  value: unknown,
  memory: Uint8Array | undefined,
  layout: PortableMemoryLayout,
  label: string
): number | boolean | string => {
  if (type !== "string") return decodeWasmScalar(type, value, label)
  if (memory === undefined) return fail("SMITHERS5060", `${label} needs exported memory this module does not declare`)
  return readWasmString(memory, layout, value, label)
}

const decodeWasmPayload = (
  instance: WebAssembly.Instance,
  variant: PortableErrorVariant,
  memory: Uint8Array | undefined,
  layout: PortableMemoryLayout,
  label: string
): Readonly<Record<string, number | boolean | string>> => {
  const payload: Record<string, number | boolean | string> = {}
  for (const [index, field] of variant.fields.entries()) {
    const exported = instance.exports[`__smithers_payload_${index}`]
    if (!(exported instanceof WebAssembly.Global) || typeof exported.value !== "number") {
      return fail("SMITHERS5060", `${label} payload global ${index} is absent`)
    }
    const fieldLabel = `${label} payload field ${field.name}`
    // String fields travel as exact integral offsets widened by
    // f64.convert_i32_u, so they decode through the same bounds-checked reader.
    payload[field.name] = field.valueType === "number"
      ? exported.value
      : field.valueType === "boolean"
        ? decodeWasmScalar("boolean", exported.value, fieldLabel)
        : decodeWasmValue("string", exported.value, memory, layout, fieldLabel)
  }
  return payload
}

/**
 * Marshal validated inputs into the Wasm ABI: numbers as f64, booleans as
 * 0/1, and strings written by the HOST into the reserved input region — the
 * i-th string parameter (in declaration order) at
 * `inputBase + i * (4 + MAX_STRING_BYTES)` — with its offset passed as the i32
 * argument. `inputValues` has already bounded every string to printable ASCII
 * of at most MAX_STRING_BYTES, so each slot always fits. Wasm code never
 * writes this region, so the arguments cannot be disturbed mid-invocation.
 */
const wasmArguments = (
  fn: PortableFunctionIR,
  parameters: readonly (number | boolean | string)[],
  memory: Uint8Array | undefined,
  layout: PortableMemoryLayout
): readonly number[] => {
  let slot = 0
  return parameters.map((value, index) => {
    const parameter = fn.parameters[index]!
    if (parameter.valueType === "number") return value as number
    if (parameter.valueType === "boolean") return value === true ? 1 : 0
    if (memory === undefined) return fail("SMITHERS5060", `portable Wasm string argument ${parameter.name} needs exported memory`)
    const offset = layout.inputBase + slot * (4 + MAX_STRING_BYTES)
    slot += 1
    if (offset + 4 + Buffer.byteLength(value as string, "utf8") > layout.inputLimit) {
      return fail("SMITHERS5060", `portable Wasm string argument ${parameter.name} does not fit its input slot`)
    }
    writeStringRecord(memory, offset, value as string, `portable Wasm string argument ${parameter.name}`)
    return offset
  })
}

/** Write one packed `[u32 length LE][bytes]` record at `offset`. */
const writeStringRecord = (memory: Uint8Array, offset: number, value: string, label: string): void => {
  const encoded = Buffer.from(value, "utf8")
  if (offset + 4 + encoded.byteLength > memory.byteLength) return fail("SMITHERS5060", `${label} does not fit its memory slot`)
  memory[offset] = encoded.byteLength & 0xff
  memory[offset + 1] = (encoded.byteLength >>> 8) & 0xff
  memory[offset + 2] = (encoded.byteLength >>> 16) & 0xff
  memory[offset + 3] = (encoded.byteLength >>> 24) & 0xff
  memory.set(encoded, offset + 4)
}

/**
 * Install the validated environment into the instance before the call: scalar
 * fields into their exported mutable globals, string fields as packed records
 * in the reserved environment region. Every slot is written, including the ones
 * outside the selected function's row — those get the canonical zero value, so
 * a slot can never carry a stale or fabricated value into an invocation.
 */
const writeWasmEnvironment = (
  instance: WebAssembly.Instance,
  env: PortableEnvLayout,
  layout: PortableMemoryLayout,
  memory: Uint8Array | undefined,
  values: ReadonlyMap<string, number | boolean | string>
): void => {
  for (const slot of env.slots) {
    const supplied = values.get(slot.key)
    if (slot.valueType === "string") {
      if (memory === undefined) return fail("SMITHERS5060", `portable Wasm environment ${slot.key} needs exported memory`)
      writeStringRecord(memory, envStringOffset(layout, slot.stringIndex), (supplied ?? "") as string, `portable Wasm environment ${slot.key}`)
      continue
    }
    const exported = instance.exports[`__smithers_env_${slot.globalIndex}`]
    if (!(exported instanceof WebAssembly.Global)) {
      return fail("SMITHERS5060", `portable Wasm environment slot ${slot.key} is absent`)
    }
    exported.value = slot.valueType === "number"
      ? (supplied ?? 0) as number
      : supplied === true ? 1 : 0
  }
}

/** Negative Wasm tags are canonical defects; the tag names which one. */
const decodeWasmDefect = (tag: number, facts: PortableDefectFacts | undefined): PortableDefect => {
  if (tag === FUEL_DEFECT_TAG) {
    if (facts?.fuel !== true) return fail("SMITHERS5060", "portable Wasm returned a fuel defect tag for a loop-free function")
    return "fuel-exhausted"
  }
  if (tag === STRING_DEFECT_TAG) {
    if (facts?.string !== true) return fail("SMITHERS5060", "portable Wasm returned a string-memory defect tag for a concat-free function")
    return "string-memory-exhausted"
  }
  return fail("SMITHERS5060", "portable Wasm returned an unknown defect tag")
}

export const executePortableWasm = async (
  build: PortableWasmBuild,
  functionName: string,
  input: Readonly<Record<string, unknown>>,
  environment: PortableEnvironment = {}
): Promise<PortableExecution> => {
  const validated = validateBuild(build)
  const module = validated.module
  const fn = selectedFunction(module, functionName)
  const defects = moduleDefectMap(module)
  const strings = moduleStringFacts(module.functions, module.capabilities)
  const env = moduleEnvLayout(module.capabilities)
  const layout = moduleMemoryLayout(strings, env)
  const parameters = inputValues(fn, input)
  // The environment is validated against the declared row before instantiation,
  // so a bad environment fails identically in both runtimes with nothing run.
  const environmentSlots = environmentValues(fn, module.capabilities, environment)
  let instance: WebAssembly.Instance
  try {
    const instantiated = await WebAssembly.instantiate(validated.wasm, {})
    instance = "instance" in instantiated ? instantiated.instance : instantiated
  } catch (error) {
    return fail("SMITHERS5060", `portable Wasm instantiation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const exported = instance.exports[fn.name]
  if (typeof exported !== "function") return fail("SMITHERS5060", `portable Wasm function ${fn.name} is absent`)
  const memory = wasmMemoryView(instance, strings, layout)
  writeWasmEnvironment(instance, env, layout, memory, environmentSlots)
  const callArguments = wasmArguments(fn, parameters, memory, layout)
  let raw: unknown
  try {
    raw = Reflect.apply(exported, undefined, callArguments) as unknown
  } catch (error) {
    return fail("SMITHERS5060", `portable Wasm invocation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const decode = (value: unknown, label: string): number | boolean | string =>
    decodeWasmValue(fn.result.valueType, value, memory, layout, label)
  if (!taggedAbi(fn, defects)) {
    return wireExit(fn, { kind: "value", value: decode(raw, `portable Wasm result for ${fn.name}`) })
  }
  if (!Array.isArray(raw) || raw.length !== 2 || !Number.isInteger(raw[0])) return fail("SMITHERS5060", "portable Wasm returned an invalid tagged ABI value")
  const tag = raw[0] as number
  if (tag < 0) {
    return wireExit(fn, { kind: "defect", defect: decodeWasmDefect(tag, defects.get(fn.name)) })
  }
  if (fn.result.kind === "plain") {
    if (tag !== 0) return fail("SMITHERS5060", "portable Wasm returned an invalid plain-function tag")
    return wireExit(fn, { kind: "value", value: decode(raw[1], `portable Wasm result for ${fn.name}`) })
  }
  if (fn.result.kind === "optional") {
    if (tag === 0) return wireExit(fn, { kind: "absent" })
    if (tag !== 1) return fail("SMITHERS5060", "portable Wasm returned an invalid Optional tag")
    return wireExit(fn, { kind: "value", value: decode(raw[1], `portable Wasm Optional value for ${fn.name}`) })
  }
  if (tag === 0) {
    return wireExit(fn, { kind: "value", value: decode(raw[1], `portable Wasm Result value for ${fn.name}`) })
  }
  const variant = fn.result.errors.find((error) => error.tag === tag)
  if (variant === undefined) return fail("SMITHERS5060", "portable Wasm returned an undeclared Result tag")
  return wireExit(fn, {
    kind: "failure",
    identity: variant.identity,
    payload: decodeWasmPayload(instance, variant, memory, layout, `portable Wasm failure for ${fn.name}`)
  })
}

export const PortableBackend = Object.freeze({
  compile: compilePortableModule,
  compileWasm: compilePortableWasm,
  decodeArtifact: decodePortableModuleArtifact,
  emitWat: emitPortableWat,
  encodeArtifact: encodePortableModuleArtifact,
  executeTypeScript: executePortableTypeScript,
  executeWasm: executePortableWasm,
  validate: validatePortableModule
})










