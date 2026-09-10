import { resolve } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import type { NativeDiagnostic, NativeDependencyTrace } from "../compiler/protocol.ts";

export const DEFAULT_RUNTIME_IMPORT = "vibelang/runtime";

export interface EmittedModuleResolutionOptions {
  /** Receives the native resolver's disk read/probe inventory, including failures. */
  readonly onDependencies?: (dependencies: NativeDependencyTrace) => void;
  /** Exact compiler-written bare imports; native resolution finds .js siblings' declarations. */
  readonly moduleOverrides?: Readonly<Record<string, string>>;
}

/** Plain diagnostics, not TypeScript compiler objects. Positions are zero-based UTF-16. */
export interface EmittedDiagnostic extends NativeDiagnostic {
  readonly position?: { readonly line: number; readonly character: number };
}

/**
 * Check the emitted bytes with the native Go compiler. Supplied text overlays
 * disk without writes. Upstream owns dependency/package resolution; exact
 * module mappings never rewrite an authored string literal or literal type.
 * Only supplied roots and global diagnostics are returned. Imported sources
 * contribute types but are not charged the language's mandatory configuration.
 */
export function checkEmittedProject(
  sources: readonly { readonly fileName: string; readonly code: string; readonly configuration?: "language" | "typescript" }[],
  resolution?: EmittedModuleResolutionOptions,
): readonly EmittedDiagnostic[] {
  const files = sources.map(source => {
    const path = resolve(source.fileName).replaceAll("\\", "/"), text = source.code, configuration = source.configuration;
    return { path, text, ...(configuration === undefined ? {} : { configuration }) };
  });
  const byPath = new Map(files.map(file => [file.path, file.text]));
  if (byPath.size !== files.length) throw new TypeError("duplicate emitted project file");
  const overrides = resolution?.moduleOverrides;
  const moduleOverrides = overrides === undefined ? undefined : Object.fromEntries(
    Object.entries(overrides).map(([name, target]) => [name, resolve(target).replaceAll("\\", "/")]),
  );
  const checked = getNativeCompiler().checkGeneratedProject({
    traceDependencies: resolution?.onDependencies !== undefined,
    files,
    currentDirectory: process.cwd().replaceAll("\\", "/"),
    diskDependencies: true,
    ...(moduleOverrides === undefined ? {} : { moduleOverrides }),
  });
  if (resolution?.onDependencies) {
    if (!checked.dependencies) throw new TypeError("native generated checking omitted its dependency trace");
    resolution.onDependencies(checked.dependencies);
  }
  return withGeneratedPositions(checked.diagnostics, byPath);
}

/** Presentation only: native spans already use authored UTF-16 offsets. */
export function withGeneratedPositions(
  diagnostics: readonly NativeDiagnostic[],
  byPath: ReadonlyMap<string, string>,
): readonly EmittedDiagnostic[] {
  // Index each affected source once, including every TS line terminator.
  const indexes = new Map<string, readonly number[]>();
  return diagnostics.map(issue => {
    if (issue.file === undefined || issue.span === undefined) return issue;
    let starts = indexes.get(issue.file);
    if (starts === undefined) {
      const text = byPath.get(issue.file)!;
      const lines = [0];
      for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code === 13 && text.charCodeAt(index + 1) === 10) index++;
        if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) lines.push(index + 1);
      }
      indexes.set(issue.file, starts = lines);
    }
    let lower = 0, upper = starts.length;
    while (lower + 1 < upper) {
      const middle = (lower + upper) >>> 1;
      if (starts[middle]! <= issue.span.start) lower = middle;
      else upper = middle;
    }
    return { ...issue, position: { line: lower, character: issue.span.start - starts[lower]! } };
  });
}

export function checkEmittedTypeScript(code: string, fileName: string): readonly EmittedDiagnostic[] {
  return checkEmittedProject([{ fileName, code }]);
}
