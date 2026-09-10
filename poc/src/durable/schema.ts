/**
 * Standalone Action contract compilation uses the pinned native Go compiler.
 * Data validation lives in schema-runtime.ts. No JavaScript compiler library
 * or compiler AST is loaded by this API.
 */
import { getNativeCompiler } from "../compiler/native.ts"
import { identityFileName } from "./site-id.ts"
import type { ActionDescriptor } from "./value.ts"
import { actionDeclarationFromDescriptor, validateActionContractDescriptor } from "./schema-runtime.ts"

export * from "./schema-runtime.ts"

const MAX_SOURCE_BYTES = 2 * 1024 * 1024

export interface ActionContractDiagnostic {
  readonly code: "VIBE4200" | "VIBE4201" | "VIBE4202" | "VIBE4203"
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly length: number
}

export interface CompileActionContractOptions {
  readonly fileName?: string
  readonly exportName: string
  readonly id: string
  readonly version: number
}

export type CompileActionContractResult =
  | {
    readonly ok: true
    readonly diagnostics: readonly []
    readonly descriptor: ActionDescriptor
    /** Checked declaration used by the durable source compiler's virtual module. */
    readonly declaration: string
  }
  | { readonly ok: false; readonly diagnostics: readonly ActionContractDiagnostic[] }


/**
 * The portable spelling of this compilation unit's file name.
 *
 * There used to be a second, weaker rule here — `logicalFileName`, which only
 * dropped empty/`.`/`..` path segments — and it fed `stableIdentity` directly.
 * An absolute `fileName` therefore minted a nominal failure identity like
 * `vibelang:Users/someone/checkout/orders.vibe#Failed@1`: machine-specific, so
 * not an identity at all, and not something two backends could ever agree on.
 * `compileActionContract` compiles exactly ONE source, which is precisely the
 * case {@link identityFileName} answers with the basename, so the rule needed
 * here was already written; it was only in the wrong module to be reached.
 *
 * The other caller path was already clean: the durable source compiler takes
 * identities from its own `logicalNameForSource` (`source-compiler.ts`), which
 * is root-relative.
 */
const contractFileName = (fileName: string | undefined): string => {
  const named = fileName === undefined || fileName.trim() === "" ? undefined : identityFileName(fileName)
  return named === undefined || named === "" || named === "." || named === ".." ? "actions.vibe" : named
}


const identifier = (value: string, label: string): string => {
  if (!/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(value)) throw new TypeError(`${label} must be an identifier`)
  return value
}


export const compileActionContract = (
  source: string,
  options: CompileActionContractOptions
): CompileActionContractResult => {
  const fileName = contractFileName(options?.fileName)
  const invalid = (message: string): CompileActionContractResult => ({ ok: false, diagnostics: [{
    code: "VIBE4201", message, file: fileName, line: 1, column: 1, length: 1,
  }] })
  try {
    if (typeof source !== "string") throw new TypeError("Action contract source must be a string")
    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
      return invalid("Action contract source exceeds the input size limit")
    }
    const exportName = identifier(options.exportName, "Action export name")
    if (typeof options.id !== "string" || options.id.trim() === "") throw new TypeError("Action id must be non-empty")
    if (!Number.isSafeInteger(options.version) || options.version < 1) throw new TypeError("Action version must be a positive safe integer")
    const result = getNativeCompiler().actionContract({ source, fileName, exportName, id: options.id, version: options.version })
    if (!result.ok) return { ok: false, diagnostics: result.diagnostics.map(issue => {
      const prefix = source.slice(0, issue.span!.start).split(/\r\n|[\n\r\u2028\u2029]/)
      return Object.freeze({ code: issue.code as ActionContractDiagnostic["code"], message: issue.message,
        file: fileName, line: prefix.length, column: prefix.at(-1)!.length + 1, length: issue.span!.length })
    }) }
    const descriptor = validateActionContractDescriptor(JSON.parse(result.contractJson))
    return Object.freeze({
      ok: true,
      diagnostics: [] as const,
      descriptor,
      declaration: actionDeclarationFromDescriptor(exportName, descriptor)
    })
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error))
  }
}


export const DurableContractCompiler = Object.freeze({ compile: compileActionContract })
