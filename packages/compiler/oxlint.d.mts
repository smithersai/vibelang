export interface Span { start: number; length: number }
/** Virtual start/length, source start/length, and segment kind. */
export type Segment = readonly [number, number, number, number, number]
export interface DiagnosticLabel {
  span: { offset: number; length: number; line?: number; column?: number }
  [key: string]: unknown
}
export interface Diagnostic {
  message: string
  code?: string
  severity?: string
  filename?: string
  labels?: DiagnosticLabel[]
  [key: string]: unknown
}
export type MappedDiagnostic<D extends Diagnostic = Diagnostic> = Omit<D, "filename" | "labels"> & {
  filename: string
  labels: Array<DiagnosticLabel & { span: { offset: number; length: number; line: number; column: number } }>
}
export type RuleSetting = string | number | readonly unknown[]
export interface OxlintConfig {
  rules?: Record<string, RuleSetting>
  options?: { typeAware?: boolean; [key: string]: unknown }
  ignorePatterns?: string[]
  overrides?: Array<{ files: string[]; rules?: Record<string, RuleSetting>; [key: string]: unknown }>
  extends?: string[]
  [key: string]: unknown
}
/** The Buffer operations used by the byte-oriented projection helpers. */
export interface SourceBytes extends Uint8Array {
  subarray(start?: number, end?: number): SourceBytes
  toString(encoding?: string): string
}
export function sourceSpan(segments: readonly Segment[], start: number, length: number): Span | undefined
export function lineAndColumn(source: Uint8Array, offset: number): { line: number; column: number }
export function isProjectionArtifact(code: string, source: SourceBytes, span: Span): boolean
export function mapDiagnostic<D extends Diagnostic>(diagnostic: D, segments: readonly Segment[], source: SourceBytes, filename: string): MappedDiagnostic<D> | undefined
export function oxlintBinary(root: string): string
export function virtualConfig(config: OxlintConfig, elsewhere?: ReadonlySet<string>): OxlintConfig
export function canonicalRule(name: string): string
export interface ProjectedOptions {
  config: OxlintConfig
  base: string
  cwd?: string
  paths?: string[]
  forward?: string[]
  elsewhere?: Iterable<string>
  binary?: string
  compiler?: string
}
export function lintProjected(options: ProjectedOptions): Promise<{
  status: 0 | 1
  output: {
    diagnostics: MappedDiagnostic[]
    number_of_files: number
    number_of_rules: number
    threads_count: number
    dropped: Record<string, number>
  }
}>
export function printProjectedConfig(options: Pick<ProjectedOptions, "config" | "base" | "elsewhere" | "binary">): string
export function formatUnix(diagnostics: readonly MappedDiagnostic[]): string
