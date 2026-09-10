import { getNativeCompiler } from "../compiler/native.ts"
import type {
  NativeFormatDiagnostic, NativeFormatDiagnosticCode, NativeFormatResult, NativeSourceToken,
} from "../compiler/protocol.ts"

export type FormatDiagnosticCode = NativeFormatDiagnosticCode
export type FormatDiagnostic = NativeFormatDiagnostic
export type FormatResult = NativeFormatResult

export interface FormatOptions {
  /** Diagnostic label. The current language formatter accepts TypeScript, not JSX. */
  readonly fileName?: string
  /** Spaces per indentation level. Defaults to 2. */
  readonly indentSize?: number
  /** Inserted newline; defaults to the source's own LF/CRLF convention. */
  readonly newLine?: "\n" | "\r\n"
}

/**
 * Thin host binding to the pinned Go formatter. Upstream computes whitespace
 * edits; native token/comment, literal/AST-structure and conditional-mask
 * checks prove preservation before any changed source crosses this boundary.
 * A refused format returns the authored source byte-identically. There is no
 * JavaScript parser, printer, formatter or compiler-library fallback here.
 */
export function formatVibeLangSource(source: string, options: FormatOptions = {}): FormatResult {
  if (options.indentSize !== undefined && (!Number.isInteger(options.indentSize) || options.indentSize < 1 || options.indentSize > 8)) {
    throw new TypeError("formatVibeLangSource indentSize must be an integer between 1 and 8")
  }
  if (options.newLine !== undefined && options.newLine !== "\n" && options.newLine !== "\r\n") {
    throw new TypeError("formatVibeLangSource newLine must be LF or CRLF")
  }
  return getNativeCompiler().format({ text: source,
    ...(options.fileName === undefined ? {} : { fileName: options.fileName }),
    ...(options.indentSize === undefined ? {} : { indentSize: options.indentSize }),
    ...(options.newLine === undefined ? {} : { newLine: options.newLine }),
  })
}

/** Symbolic native token kinds replace the retired compiler's SyntaxKind enum. */
export type VibeLangToken = NativeSourceToken

/**
 * The token covering a UTF-16 caret, or ending exactly at it. Trivia is skipped;
 * template/regex-aware tokenization and all source positions come from Go.
 */
export function vibelangTokenAt(source: string, offset: number): VibeLangToken | undefined {
  if (!Number.isSafeInteger(offset)) throw new TypeError("vibelangTokenAt offset must be an integer")
  return getNativeCompiler().tokenAt({ text: source, offset }).token ?? undefined
}

export function isFormattedVibeLangSource(source: string, options: FormatOptions = {}): boolean {
  const result = formatVibeLangSource(source, options)
  return result.ok && !result.changed
}
