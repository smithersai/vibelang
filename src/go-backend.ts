import { NativeCompiler } from "../poc/dist/compiler/native.js";
import { NativeCompilerError } from "../poc/dist/compiler/protocol.js";

// Runtime compilation uses the shared identity-checked native binding. The
// CLI carries no separate checkout lookup/build implementation; an installed
// package runs its bundled executable without Go or a source checkout.
export interface GoBackendSourceFile {
  readonly path: string;
  /**
   * `"vibelang"` is authored `.vibe`; `"typescript"` is a foreign `.ts`/`.js`
   * dependency the checker must see; `"asset"` is a non-code project file the
   * backend's own asset pass reads. All three are declared by `compiler/api.go`
   * and accepted by the bridge.
   */
  readonly kind: "vibelang" | "typescript" | "asset";
  readonly text: string;
}

export interface GoBackendDiagnostic {
  readonly code: string;
  readonly category: "error" | "warning" | "suggestion" | "message";
  readonly message: string;
  readonly file?: string;
  readonly span?: {
    readonly start: number;
    readonly length: number;
  };
  readonly phase?: "parse" | "bind" | "check" | "lower" | "emit" | "comptime";
}

export interface GoBackendArtifact {
  readonly path: string;
  readonly content: string;
}

export interface GoBackendCompileResult {
  readonly diagnostics: readonly GoBackendDiagnostic[];
  readonly artifacts: readonly GoBackendArtifact[];
  readonly emitSkipped: boolean;
}

export interface GoBackendRequest {
  readonly rootNames: readonly string[];
  readonly files: readonly GoBackendSourceFile[];
  readonly options: Readonly<Record<string, boolean | string>>;
  readonly lowering: "internal";
  /**
   * The project's `tsconfig.json`, by path and text, when the caller has one.
   *
   * Text rather than a parsed bag: compatibility.mdx §Forbidden requires the
   * offending option to be REJECTED, and the fork parses the JSON itself so its
   * VIBE6002 lands on the option the author wrote. Both backends run the
   * same table; see poc/src/language/compiler-options.ts.
   */
  readonly configFile?: { readonly path: string; readonly text: string };
}

/** A stable product-facing failure code plus the command that repairs it. */
export class GoBackendFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoBackendFailure";
    this.code = code;
  }
}

/**
 * Decide which request source a Go diagnostic belongs to.
 *
 * Three cases, and only one of them used to be handled. A diagnostic that
 * names a file in the request belongs to that file. A diagnostic that names no
 * file at all is a project-level diagnostic and stays unattached — the caller
 * reports it without claiming it came from any particular source. A diagnostic
 * that names a file the request never sent is neither: it is a protocol
 * violation, because the backend is describing a source the CLI did not give
 * it and cannot map a position into.
 *
 * The CLI used to fall back to the *first* source file for both of the last two
 * cases, so an unknown file name silently became "an error in your first
 * file", at a line and column computed from nothing. A diagnostic pointing at
 * the wrong file is worse than one pointing nowhere: it sends a reader to
 * correct source. This fails closed instead, with the same
 * `VIBELANG_GO_PROTOCOL` code the rest of this module uses for a backend whose
 * answer does not fit the request that was sent.
 *
 * @returns the request's logical name for the diagnostic, or `undefined` when
 *          the diagnostic is project-level and belongs to no single file.
 */
export function resolveGoDiagnosticFile(
  file: string | undefined,
  requestSources: ReadonlySet<string>,
): string | undefined {
  if (file === undefined || file === "") return undefined;
  if (requestSources.has(file)) return file;
  const known = [...requestSources].sort().map((name) => JSON.stringify(name)).join(", ");
  throw new GoBackendFailure(
    "VIBELANG_GO_PROTOCOL",
    `The Go compiler reported a diagnostic against ${JSON.stringify(file)}, which is not one of the ` +
    `${requestSources.size} source file(s) the request sent (${known || "none"}). ` +
    "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
  );
}


let compiler: NativeCompiler | undefined;

/** Native tooling can fail during source discovery, before project emission. */
export function asGoBackendFailure(error: unknown): GoBackendFailure | undefined {
  if (error instanceof GoBackendFailure) return error;
  if (!(error instanceof NativeCompilerError)) return undefined;
  return new GoBackendFailure(error.code, error.message +
    " Remedy: install a matching VibeLang native package or rebuild it with npm run build. " +
    "An explicit VIBELANG_NATIVE_COMPILER must match this package's compiler identity.");
}

/** All project bytes are supplied explicitly; no ambient source hydration.
 * This binding uses the same native protocol as installed generated-program
 * compilation. It preserves the CLI's stable infrastructure-error surface. */
export function invokeGoBackend(request: GoBackendRequest): GoBackendCompileResult {
  try {
    compiler ??= new NativeCompiler({ timeoutMs: 300_000 });
    return compiler.compile(request);
  } catch (error) {
    throw asGoBackendFailure(error) ?? error;
  }
}
