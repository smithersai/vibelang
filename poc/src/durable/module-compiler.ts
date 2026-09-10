import { getNativeCompiler } from "../compiler/native.ts"
import { createOffsetSourceMap } from "../language/source-map.ts"
import { compileDurableFlow, type DurableFlowDescriptor, type DurableSourceCompileFailure, type DurableSourceCompileOptions } from "./source-compiler.ts"

export type DurableModuleCompileResult = DurableSourceCompileFailure | {
  readonly ok: true
  readonly diagnostics: readonly []
  readonly code: string
  readonly sourceMap?: string
  readonly flow?: DurableFlowDescriptor
}

/**
 * Materialize compiler-owned Flow declarations before ordinary project emission.
 * The checked body compiler owns the descriptor; this pass only places its data
 * into the host module and maps surviving tokens back to the authored module.
 * Neither phase invokes a Flow callback or Action implementation.
 */
export function compileDurableModule(source: string, options: DurableSourceCompileOptions): DurableModuleCompileResult {
  const native = getNativeCompiler()
  if (!native.inspect([{ path: "durable-module.ts", text: source, scriptKind: "typescript" }]).files[0]!
    .moduleSyntax.some(edge => edge.specifier === "vibelang:flows")) {
    return { ok: true, diagnostics: [], code: source }
  }
  const fileName = options.fileName ?? "flow.vibe"
  // Imports and unresolved declarations still go through the durable compiler's
  // diagnostic path. A spelling match alone never supplies a replacement span.
  const compiled = compileDurableFlow(source, options)
  if (!compiled.ok) return compiled
  const facts = native.durableModule(source)
  if (facts.diagnostics.length !== 0) {
    return { ok: false, diagnostics: facts.diagnostics.map(issue => {
      const prefix = source.slice(0, issue.span?.start ?? 0).split(/\r\n|[\n\r\u2028\u2029]/)
      return { code: issue.code, message: issue.message, file: fileName,
        line: prefix.length, column: prefix.at(-1)!.length + 1, length: issue.span?.length ?? 1 }
    }) }
  }
  const call = facts.calls[0]
  if (facts.calls.length !== 1 || !call) throw new TypeError("durable compilation did not identify exactly one native-bound call")

  const replacements = [
    ...[...facts.imports, ...facts.removals].map(span => ({ start: span.start, end: span.start + span.length, text: "" })),
    ...compiled.derivedActions.map(action => ({ start: action.start, end: action.end, text: "" })),
    // JSON quotes inside string values are escaped, so this exact unescaped
    // property token cannot occur inside a string. Computed spelling prevents
    // JavaScript's special object-literal __proto__ setter from changing data.
    { start: call.start, end: call.start + call.length,
      text: `(${JSON.stringify(compiled.flow).replaceAll('"__proto__":', '["__proto__"]:')} as const)` },
  ].sort((left, right) => left.start - right.start || left.end - right.end)
  const runs: { derivedStart: number; authoredStart: number; length: number }[] = []
  let cursor = 0
  let code = ""
  for (const replacement of replacements) {
    if (replacement.start < cursor || replacement.end < replacement.start || replacement.end > source.length) {
      throw new TypeError(`durable module replacements overlap or exceed ${fileName}`)
    }
    if (replacement.start > cursor) {
      runs.push({ derivedStart: code.length, authoredStart: cursor, length: replacement.start - cursor })
      code += source.slice(cursor, replacement.start)
    }
    code += replacement.text
    cursor = replacement.end
  }
  if (cursor < source.length) {
    runs.push({ derivedStart: code.length, authoredStart: cursor, length: source.length - cursor })
    code += source.slice(cursor)
  }
  return { ok: true, diagnostics: [], code, flow: compiled.flow,
    sourceMap: createOffsetSourceMap({ derivedText: code, authoredText: source, runs,
      sourceName: fileName, fileName: `${fileName}.durable.ts` }) }
}
