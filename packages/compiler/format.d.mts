export type QuoteStyle = "alwaysDouble" | "alwaysSingle" | "preferDouble" | "preferSingle"
export interface FormatStyle {
  quoteStyle: QuoteStyle
  lineWidth: number
  globals?: { indentWidth?: number; useTabs?: boolean; newLineKind?: "auto" | "lf" | "crlf" | "system" }
  /** Additional dprint TypeScript options, passed through to the installed plugin. */
  typescript?: Record<string, unknown>
}
export const typescriptPlugin: string
export const defaultStyle: FormatStyle
export function repositoryStyle(filePath: string): FormatStyle
export function formatSource(text: string, filePath?: string, style?: FormatStyle): string
/** Format or check selected files; return 1 when a check finds changes. */
export function formatFiles(args: string[], command?: string): 0 | 1
