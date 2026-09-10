import { getNativeCompiler } from "../compiler/native.ts"
import { digest } from "./stable.ts"

/* --------------------------------------------------------------------------
 * Provisional source-level loader registration
 *
 * docs/ASSET_LOADERS.md leaves open question 2 ("loader declaration and
 * registration APIs, including conflict precedence") unanswered and shows
 * `comptime.loader(...)` only as a proposed spelling. Everything in this module
 * is a labelled-**provisional** candidate for that slot: a project file whose
 * DEFAULT export is `comptime.loader(<type literal>, <function>)` registers a
 * loader for one import-attribute `type`.
 *
 * Two rules are not provisional and are enforced here:
 *
 *   - `comptime` is recognized by TypeScript checker identity against the
 *     compiler-owned `"vibelang:comptime"` declaration, never by spelling. An
 *     unrelated local object with a `loader` method never gains authority.
 *   - Recognition is purely AST/checker level. The loader file is NEVER
 *     imported or executed in this process; it only ever runs inside the
 *     existing no-permission Deno sandbox.
 *
 * Because the sandbox cannot resolve `"vibelang:comptime"` (it has no imports
 * at all), recognition also produces the compiler-lowered module the sandbox
 * receives: the compiler-owned import is erased and the registration call is
 * replaced by the loader function itself. The authored bytes still enter the
 * loader's implementation digest, so editing the loader file invalidates every
 * asset it produced.
 * -------------------------------------------------------------------------- */

/** `VCT13xx` is the loader-registration family; `VCT10xx`/`VCT12xx` are taken. */
export const LoaderRegistrationDiagnosticCode = Object.freeze({
  Syntax: "VCT1300",
  ModuleShape: "VCT1301",
  RegistrationShape: "VCT1302",
  UnrelatedIdentity: "VCT1303",
  MissingIdentity: "VCT1304",
  CallShape: "VCT1305",
  InternalIdentity: "VCT1306",
  LoaderType: "VCT1307",
  LoaderFunction: "VCT1308",
  EscapingRegistration: "VCT1309",
  BuiltinPrecedence: "VCT1310",
  DuplicateRegistration: "VCT1311",
  RegistrationFailure: "VCT1312",
  SourceMismatch: "VCT1313",
} as const)

export type LoaderRegistrationDiagnosticCodeValue =
  typeof LoaderRegistrationDiagnosticCode[keyof typeof LoaderRegistrationDiagnosticCode]

export interface LoaderRegistrationDiagnostic {
  readonly code: LoaderRegistrationDiagnosticCodeValue
  readonly severity: "error" | "warning"
  readonly message: string
  /** The file name exactly as it was supplied to recognition. */
  readonly fileName: string
  /** One-based. */
  readonly line: number
  /** One-based. */
  readonly column: number
}

export interface LoaderRegistration {
  readonly fileName: string
  /** Import-attribute `type` this file registers. */
  readonly type: string
  /**
   * Compiler-lowered module handed to the sandbox. The compiler-owned import
   * is erased and `export default comptime.loader(type, fn)` becomes
   * `export default fn`, which is the shape `loader-runner.js` invokes.
   */
  readonly sandboxSource: string
  readonly authoredDigest: string
  readonly sandboxDigest: string
  /** One-based authored line and UTF-16 column of the registration call. */
  readonly line: number
  readonly column: number
}

export interface LoaderRegistrationAnalysis {
  readonly ok: boolean
  readonly registration?: LoaderRegistration
  /**
   * The default export resolved, by checker identity, to the compiler-owned
   * `comptime.loader`. Until that holds, the file has not claimed to be a
   * loader at all and a caller that only *guessed* it might be one — the
   * spelling trigger below — must treat a failure as "not a loader" rather
   * than as a broken loader. Once it holds, every later failure is the
   * author's, and is a hard error for discovered and declared files alike.
   */
  readonly identified: boolean
  readonly diagnostics: readonly LoaderRegistrationDiagnostic[]
}

export interface RecognizeLoaderRegistrationOptions {
  /** Reported verbatim in diagnostics; also selects the script kind. */
  readonly fileName: string
  readonly source: string
}

/** A cheap prefilter is not authority; native parsing selects the candidate. */
export const looksLikeLoaderRegistration = (source: string, fileName = "candidate.ts"): boolean => {
  if (typeof source !== "string" || !source.includes("vibelang:comptime") || Buffer.byteLength(source, "utf8") > 1024 * 1024) return false
  return getNativeCompiler().loaderRegistration({ mode: "discover", fileName, source }).candidate
}

/**
 * Checked recognition and source extraction belong entirely to Go. This host
 * only marshals immutable source and adds content digests; it never imports or
 * executes a loader. Execution stays in the no-permission sandbox.
 */
export const recognizeLoaderRegistration = (options: RecognizeLoaderRegistrationOptions): LoaderRegistrationAnalysis => {
  const { fileName, source } = options
  if (typeof fileName !== "string" || typeof source !== "string") {
    throw new TypeError("loader registration recognition requires fileName and source strings")
  }
  const result = getNativeCompiler().loaderRegistration({ mode: "recognize", fileName, source })
  return Object.freeze({
    ok: result.ok,
    identified: result.identified,
    registration: result.registration === undefined ? undefined : Object.freeze({
      ...result.registration,
      authoredDigest: digest(source),
      sandboxDigest: digest(result.registration.sandboxSource),
    }),
    diagnostics: Object.freeze(result.diagnostics.map(item => Object.freeze(item))),
  })
}
