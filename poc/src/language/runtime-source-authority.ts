/**
 * A checker-only runtime module supplied by another compiler phase. Structural
 * callers may still provide modules for ordinary foreign analysis, but only
 * objects issued here receive compiler-owned value provenance.
 */
export interface AdditionalRuntimeSource {
  readonly sourceFileName: string
  readonly resolutionAliases?: readonly string[]
  readonly source: string
}

const compilerIssuedRuntimeSources = new WeakSet<object>()

/** @internal Used by compiler phases such as the source-asset graph. */
export const issueCompilerRuntimeSource = <Value extends AdditionalRuntimeSource>(value: Value): Value => {
  const issued = Object.freeze({
    ...value,
    ...(value.resolutionAliases === undefined
      ? {}
      : { resolutionAliases: Object.freeze([...value.resolutionAliases]) })
  }) as Value
  compilerIssuedRuntimeSources.add(issued)
  return issued
}

/** @internal Identity check; spreading or reconstructing an issued object removes authority. */
export const isCompilerIssuedRuntimeSource = (value: AdditionalRuntimeSource): boolean =>
  compilerIssuedRuntimeSources.has(value)
